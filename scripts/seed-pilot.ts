/** Seeds a real Postgres with one mandate, one prospect and three queued drafts. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { Searchical } from '@/db/client';
import { migrate } from '@/db/migrate';
import * as schema from '@/db/schema';
import { Ledger } from '@/ledger';
import { recruiterManualEntry } from '@/connectors';
import { EngagementService, MESSAGE_TEMPLATES, type EvidenceFact } from '@/engagement';

const url = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString: url });
const db = drizzle(pool, { schema });
const app = new Searchical(db);
const START = new Date();

const hooksFor = (code: string, evidenceId: string, citation: string) =>
  (MESSAGE_TEMPLATES.find((t) => t.code === code)?.hookTokens ?? []).map((token) => ({
    token, evidenceId, citation,
    value: token === 'company' ? 'Shopify' : 'their KubeCon talk on multi-cluster failover',
  }));

async function main() {
  await migrate(db, 'migrations', (script) => db.execute(sql.raw(script)).then(() => undefined));
  const tenant = await app.createTenant('CDW Canada Consulting Services', 'cdw-ca');

  await app.withTenant(tenant.id, async (tx) => {
    const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
    const sourceId = await ledger.registerSource(recruiterManualEntry);
    const one = (r: unknown) => (r as { rows: { id: string }[] }).rows[0]!.id;

    const people: [string, string, string, Date | undefined][] = [
      ['Ada Okafor', 'https://www.usenix.org/conference/srecon26/presentation/okafor', 'VP Engineering', undefined],
      ['Ravi Menon', 'https://kubecon.io/2026/talks/multi-cluster-failover', 'VP Engineering', undefined],
      ['Chantal Roy', 'https://archive.example.org/2021/legacy-talk', 'VP Engineering', new Date(Date.now() - 86_400_000)],
    ];

    const mandateId = one(await tx.execute(sql`
      INSERT INTO mandates (tenant_id, title, segment, function_domain, location, status, created_by, confirmed_by, confirmed_at)
      VALUES (${tenant.id}::uuid, 'Vice President, Engineering', 'senior_executive',
              'Application and software engineering leadership', 'Toronto, Ontario',
              'live', 'emil', 'emil', now())
      RETURNING id`));

    for (const [name, citation, , expiresAt] of people) {
      const evidenceId = await ledger.recordEvidence({
        sourceId, collectionMethod: 'public_evidence', collectedAt: new Date(Date.now() - 5 * 86_400_000),
        lawfulBasis: 'publicly_available_exemption', jurisdiction: 'CA', confidence: 0.85, citation,
        ...(expiresAt ? { expiresAt } : {}),
      });
      const personId = one(await tx.execute(sql`
        INSERT INTO persons (tenant_id, display_name) VALUES (${tenant.id}::uuid, ${name}) RETURNING id`));
      const prospectId = one(await tx.execute(sql`
        INSERT INTO prospects (tenant_id, mandate_id, person_id)
        VALUES (${tenant.id}::uuid, ${mandateId}::uuid, ${personId}::uuid) RETURNING id`));

      const svc = new EngagementService(tx, tenant.id, { id: 'emil' });
      const { sequenceId } = await svc.startSequence({
        prospectId, segment: 'senior_executive', startedAt: START,
      });
      const step = ((await tx.execute(sql`
        SELECT id, template_code FROM sequence_steps WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch LIMIT 1
      `)) as unknown as { rows: { id: string; template_code: string }[] }).rows[0]!;

      const first = name.split(' ')[0];
      await svc.queueMessage({
        sequenceStepId: step.id,
        body: `Hi ${first}, your KubeCon talk on multi-cluster failover stood out. I lead senior ` +
          `engineering searches for Canadian lenders and fintechs. Would you be open to a short, ` +
          `confidential conversation to see whether something we are building could be a genuine ` +
          `career move, even if the timing is only someday? Happy to work around your schedule. Emil`,
        hooks: hooksFor(step.template_code, evidenceId, citation),
        evidence: new Map<string, EvidenceFact>([[evidenceId, {
          id: evidenceId, live: true, aboutThisPerson: true, citation,
        }]]),
      });
    }
  });

  console.log(`SEARCHICAL_TENANT_ID=${tenant.id}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
