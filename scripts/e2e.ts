/**
 * One real specification, end to end, against a real PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run e2e -- fixtures/<spec>.txt --location "Ottawa"
 *
 * Runs the live extraction, persists the mandate, stands in for the recruiter's
 * confirmation, builds the search plan, checks compensation, then drives a
 * SYNTHETIC candidate through the sequence, every gate and the approval queue.
 *
 * The candidate is synthetic on purpose. Discovery on the open web rarely hands
 * back a named person with a verified hook, and when it does not, the honest
 * end of the chain is the personalisation gate refusing to draft. A synthetic
 * candidate exercises everything after that point without attributing invented
 * facts to a real person. Its evidence cites example.org and says so.
 */
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { Searchical } from '@/db/client';
import { migrate } from '@/db/migrate';
import * as schema from '@/db/schema';
import { Ledger } from '@/ledger';
import { recruiterManualEntry } from '@/connectors';
import { LlmGateway } from '@/llm/gateway';
import { claudeCliModel } from '@/llm/claude-cli';
import { claudeModel } from '@/llm/anthropic';
import { MandateService, seedChannelRatings, type TermDecision } from '@/mandate';
import { CompensationService } from '@/compensation';
import { EngagementService, MESSAGE_TEMPLATES, type EvidenceFact } from '@/engagement';
import { PolicyViolation } from '@/policy';

const stage = (n: number, title: string) =>
  console.log(`\n${'='.repeat(74)}\nSTAGE ${n}  ${title}\n${'='.repeat(74)}`);
const ok = (s: string) => console.log(`  ok    ${s}`);
const refused = (s: string) => console.log(`  held  ${s}`);
const note = (s: string) => console.log(`        ${s}`);

const causeMessage = (e: unknown): string => {
  let c: unknown = e;
  const parts: string[] = [];
  for (let i = 0; i < 6 && c instanceof Error; i += 1) { parts.push(c.message); c = (c as { cause?: unknown }).cause; }
  return parts[parts.length - 1] ?? String(e);
};

async function expectRefusal(label: string, p: Promise<unknown>) {
  try {
    await p;
    console.log(`  FAIL  ${label}: expected a refusal and got none`);
    process.exitCode = 1;
  } catch (e) {
    let c: unknown = e;
    while (c instanceof Error && !(c instanceof PolicyViolation) && (c as { cause?: unknown }).cause) c = (c as { cause?: unknown }).cause;
    refused(`${label}\n        ${(c instanceof Error ? c.message : causeMessage(e)).slice(0, 260)}`);
  }
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) throw new Error('usage: npm run e2e -- <spec.txt> [--location "City"] [--via-api]');
  const locIndex = process.argv.indexOf('--location');
  const operatorLocation = locIndex > -1 ? process.argv[locIndex + 1] ?? null : null;
  const jobSpec = readFileSync(specPath, 'utf8');

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const db = drizzle(pool, { schema });
  const app = new Searchical(db);
  await migrate(db, 'migrations', (script) => db.execute(sql.raw(script)).then(() => undefined));
  const tenant = await app.createTenant('E2E Practice', `e2e-${Date.now()}`);
  const actor = { id: 'emil' };
  const gateway = new LlmGateway(process.argv.includes('--via-api') ? claudeModel() : claudeCliModel());

  stage(1, 'MANDATE: live extraction, persisted');
  const drafted = await app.withTenant(tenant.id, async (tx) => {
    await seedChannelRatings(tx, tenant.id);
    return new MandateService(tx, gateway).draftFromJobSpec({ jobSpec, actor, tenantId: tenant.id });
  });
  ok(`"${drafted.draft.title}" as ${drafted.draft.segment}, status ${drafted.status}`);
  note(`location stated: ${drafted.draft.location ?? 'none'}`);
  for (const g of drafted.gaps) note(`gap [${g.field}] ${g.question.slice(0, 120)}...`);
  if (drafted.status === 'out_of_scope') { note('Out of scope: the chain ends here by design.'); await pool.end(); return; }

  stage(2, 'CONFIRMATION: standing in for the recruiter');
  const decisions: TermDecision[] = drafted.vocabulary.terms.map((t) => ({
    kind: t.kind, term: t.term,
    decision: t.kind === 'exclusion' || (t.extractionConfidence ?? 0) >= 0.4 ? 'confirm' : 'reject',
  }));
  for (const d of decisions) note(`${d.decision.padEnd(7)} ${d.kind.padEnd(16)} ${d.term}`);
  await app.withTenant(tenant.id, (tx) => new MandateService(tx, gateway).confirmVocabulary({
    mandateId: drafted.mandateId, decisions, actor, tenantId: tenant.id,
  }));
  if (operatorLocation) {
    await app.withTenant(tenant.id, (tx) => tx.execute(sql`
      UPDATE mandates SET location = ${operatorLocation} WHERE id = ${drafted.mandateId}::uuid`));
    ok(`location answered by the operator, not inferred: ${operatorLocation}`);
  }

  stage(3, 'SEARCH PLAN');
  const plan = await app.withTenant(tenant.id, (tx) =>
    new MandateService(tx, gateway).buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant.id }));
  ok(`${plan.strings.strings.length} search string(s), ${plan.channels.recommended.length} channel(s) recommended`);
  for (const c of plan.channels.recommended) note(`${c.fit}/5 ${c.name}`);

  stage(4, 'COMPENSATION');
  const quote = await app.withTenant(tenant.id, (tx) =>
    new CompensationService(tx, tenant.id, actor).quotableRange(drafted.mandateId));
  quote.quotable ? ok(`quotable: ${quote.text}`) : refused(`no quotable range: ${quote.reason}`);

  stage(5, 'A SYNTHETIC CANDIDATE, through every gate');
  const citation = 'https://example.org/synthetic-test-candidate';
  const { prospectId, evidenceId } = await app.withTenant(tenant.id, async (tx) => {
    const ledger = new Ledger(tx, { type: 'user', id: actor.id });
    const sourceId = await ledger.registerSource(recruiterManualEntry);
    const evidenceId = await ledger.recordEvidence({
      sourceId, collectionMethod: 'recruiter_entered', collectedAt: new Date(),
      lawfulBasis: 'publicly_available_exemption', jurisdiction: 'CA', confidence: 0.8, citation,
    });
    const one = (r: unknown) => (r as { rows: { id: string }[] }).rows[0]!.id;
    const personId = one(await tx.execute(sql`
      INSERT INTO persons (tenant_id, display_name) VALUES (${tenant.id}::uuid, 'Synthetic Candidate (test)') RETURNING id`));
    await ledger.recordConsent({
      personId, basis: 'implied_conspicuous_publication', capturedAt: new Date(), evidenceId,
      conspicuousPublication: { publishedBySubject: true, noRefusalNotice: true, relevantToRole: true, sourceUrl: citation },
    });
    const prospectId = one(await tx.execute(sql`
      INSERT INTO prospects (tenant_id, mandate_id, person_id)
      VALUES (${tenant.id}::uuid, ${drafted.mandateId}::uuid, ${personId}::uuid) RETURNING id`));
    return { prospectId, evidenceId };
  });
  ok('synthetic candidate recorded through manual entry, with a consent basis');

  const steps = await app.withTenant(tenant.id, async (tx) => {
    const svc = new EngagementService(tx, tenant.id, actor);
    const { sequenceId } = await svc.startSequence({
      prospectId, segment: drafted.draft.segment as 'senior_it_consultant', startedAt: new Date(),
    });
    return ((await tx.execute(sql`
      SELECT id, touch, template_code, channel::text AS channel, scheduled_for FROM sequence_steps
       WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch`)) as unknown as
      { rows: { id: string; touch: number; template_code: string; channel: string; scheduled_for: string }[] }).rows;
  });
  for (const s of steps) note(`touch ${s.touch}  ${s.scheduled_for}  ${s.channel.padEnd(20)} ${s.template_code}`);

  const evidence = new Map<string, EvidenceFact>([[evidenceId, { id: evidenceId, live: true, aboutThisPerson: true, citation }]]);
  const hooks = (code: string, values: Record<string, string>) =>
    (MESSAGE_TEMPLATES.find((t) => t.code === code)?.hookTokens ?? [])
      .filter((token) => values[token] !== undefined)
      .map((token) => ({ token, value: values[token]!, evidenceId, citation }));
  const first = steps[0]!;
  const note300 = 'Hi Sam, I follow the Saviynt identity governance rollout your team has been shipping at ' +
    'Example University, and I work with identity leaders across Ottawa on senior roles. Not pitching; ' +
    'I would value connecting. Emil Simms, CDW Canada Consulting Services.';

  await expectRefusal('a connection note over 300 characters', app.withTenant(tenant.id, (tx) =>
    new EngagementService(tx, tenant.id, actor).queueMessage({
      sequenceStepId: first.id, body: note300 + ' '.repeat(10) + 'x'.repeat(120),
      hooks: hooks(first.template_code, { 'platform or migration': 'Saviynt identity governance rollout', company: 'Example University' }),
      evidence,
    })));
  await expectRefusal('a connection note with one of its two hooks missing', app.withTenant(tenant.id, (tx) =>
    new EngagementService(tx, tenant.id, actor).queueMessage({
      sequenceStepId: first.id, body: note300,
      hooks: hooks(first.template_code, { 'platform or migration': 'Saviynt identity governance rollout' }),
      evidence,
    })));
  await expectRefusal('a draft that quotes money', app.withTenant(tenant.id, (tx) =>
    new EngagementService(tx, tenant.id, actor).queueMessage({
      sequenceStepId: first.id, body: 'Hi Sam, Saviynt work at Example University. Base is $140k. Emil Simms.',
      hooks: hooks(first.template_code, { 'platform or migration': 'Saviynt', company: 'Example University' }),
      evidence,
    })));
  const queued = await app.withTenant(tenant.id, (tx) =>
    new EngagementService(tx, tenant.id, actor).queueMessage({
      sequenceStepId: first.id, body: note300,
      hooks: hooks(first.template_code, { 'platform or migration': 'Saviynt identity governance rollout', company: 'Example University' }),
      evidence,
    }));
  ok(`touch 1 queued for approval (${note300.length} characters): ${queued.messageId}`);

  stage(6, 'APPROVAL QUEUE');
  const queue = await app.withTenant(tenant.id, (tx) => new EngagementService(tx, tenant.id, actor).pendingQueue());
  for (const q of queue) ok(`${q.personName} · ${q.mandateTitle} · touch ${q.touch} · ${q.channel} · ${q.hookCount} hook(s)`);
  const audit = await app.withTenant(tenant.id, async (tx) => ((await tx.execute(sql`
    SELECT action, count(*)::int AS n FROM audit_log WHERE action LIKE 'policy.%' GROUP BY action ORDER BY action
  `)) as unknown as { rows: { action: string; n: number }[] }).rows);
  for (const a of audit) note(`${a.action}: ${a.n} decision(s) audited`);

  console.log(`\nSEARCHICAL_TENANT_ID=${tenant.id}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
