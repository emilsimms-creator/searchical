import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { fakeModel, SENIOR_DBA_EXTRACTION, VP_INFRASTRUCTURE_EXTRACTION } from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import {
  MandateService, deriveIntakeGaps, generateSearchStrings, jobSpecExtraction,
  projectPipeline, seedChannelRatings, toDraft, type MandateConstraint, type MandateTerm,
} from '@/mandate';

/**
 * Regression tests for the lost constraints defect.
 *
 * Found by running a real Senior Database Administrator specification through
 * the engine: the role was handled correctly and then every one of six hard
 * constraints was silently dropped, because the mandate model had nowhere to
 * put a requirement that is not a search term.
 */
const SECRET_CLEARANCE: MandateConstraint = {
  kind: 'security_clearance',
  severity: 'disqualifying',
  statement: 'Must be eligible to obtain Secret clearance',
};
const ONSITE: MandateConstraint = {
  kind: 'location_or_onsite',
  severity: 'disqualifying',
  statement: 'On site 12 days per month, no relocation assistance',
};
const PREFERENCE: MandateConstraint = {
  kind: 'citizenship_or_status',
  severity: 'strong_preference',
  statement: 'Priority to Canadian citizens and permanent residents',
};

describe('constraints and the addressable market', () => {
  it('does not claim the market is constrained when nothing disqualifies', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 200, constraints: [PREFERENCE] });
    expect(p.constrainedMarket).toBe(false);
    expect(p.advice).toEqual([]);
  });

  it('says plainly that the default rates overstate a constrained market', () => {
    const p = projectPipeline({
      targetConversations: 10,
      longListSize: 200,
      constraints: [SECRET_CLEARANCE, ONSITE, PREFERENCE],
    });

    expect(p.constrainedMarket).toBe(true);
    expect(p.advice.join(' ')).toMatch(/2 disqualifying constraints narrow this market/);
    expect(p.advice.join(' ')).toMatch(/measured on unconstrained senior searches, so they overstate this one/);
    expect(p.advice.join(' ')).toMatch(/five\s+touches at someone who cannot take the job/);
  });

  it('invents no multiplier, because there is no figure to invent one from', () => {
    const unconstrained = projectPipeline({ targetConversations: 10, longListSize: 200 });
    const constrained = projectPipeline({ targetConversations: 10, longListSize: 200, constraints: [SECRET_CLEARANCE] });

    // The arithmetic is unchanged. Only the honesty about it changes.
    expect(constrained.contactsRequired).toBe(unconstrained.contactsRequired);
    expect(constrained.responseRate).toBe(unconstrained.responseRate);
  });

  it('reports a short long list and a narrow market together', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 40, constraints: [SECRET_CLEARANCE] });
    expect(p.advice.join(' ')).toMatch(/60 short of the 100 people/);
    expect(p.advice.join(' ')).toMatch(/narrows this market/);
  });
});

describe('constraints never become search terms', () => {
  it('keeps a clearance requirement out of the Boolean', async () => {
    const gateway = new LlmGateway(fakeModel(SENIOR_DBA_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    const confirmed: MandateTerm[] = draft.terms.map((t) => ({ ...t, status: 'confirmed' }));
    const { strings } = generateSearchStrings({ terms: confirmed, location: draft.location });

    const boolean = strings.find((s) => s.kind === 'linkedin_recruiter_boolean')!.value;
    expect(boolean).toBe(
      '("Senior Database Administrator" OR "Senior Database Engineer" OR "Cloud Database Engineer" ' +
        'OR "Database Platform Engineer") AND ("Oracle" OR "SQL Server" OR "Azure SQL Managed Instance") ' +
        'NOT ("junior")',
    );
    for (const noise of ['Secret', 'clearance', 'on-call', 'relocation', 'commuting']) {
      expect(boolean, noise).not.toContain(noise);
    }
  });

  it('sharpens the location question when an on-site rule has no named office', async () => {
    const gateway = new LlmGateway(fakeModel(SENIOR_DBA_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    const gap = deriveIntakeGaps(draft).find((g) => g.field === 'location')!;

    expect(gap.question).toMatch(/imposes an on-site or commuting requirement but never names the office/);
    expect(gap.question).toMatch(/unqualifiable/);
  });

  it('asks the ordinary location question when there is no on-site rule', async () => {
    const gateway = new LlmGateway(fakeModel({ ...VP_INFRASTRUCTURE_EXTRACTION, location: null }));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    const gap = deriveIntakeGaps(draft).find((g) => g.field === 'location')!;
    expect(gap.question).toMatch(/what is genuinely\s+negotiable/);
  });
});

describe('the Senior Database Administrator specification end to end', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Constraints Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
  });

  afterEach(async () => h?.close());

  const service = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0]) =>
    new MandateService(tx, new LlmGateway(fakeModel(SENIOR_DBA_EXTRACTION)), null);

  it('holds every constraint the specification stated, with its source quote', async () => {
    await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: 'Senior DBA', actor: { id: 'emil' }, tenantId: tenant }),
    );

    const rows = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT kind::text AS kind, severity::text AS severity, statement, source_quote
        FROM mandate_constraints ORDER BY kind
      `)) as unknown as { rows: { kind: string; severity: string; statement: string; source_quote: string }[] };
      return r.rows;
    });

    expect(rows.map((r) => r.kind)).toEqual([
      'citizenship_or_status', 'language', 'location_or_onsite', 'schedule', 'security_clearance',
    ]);
    expect(rows.filter((r) => r.severity === 'disqualifying')).toHaveLength(3);
    // Every one is checkable against the source rather than a paraphrase.
    expect(rows.every((r) => r.source_quote !== null && r.source_quote.length > 10)).toBe(true);
  });

  it('carries the constraints into the search plan and warns the recruiter', async () => {
    const plan = await h.app.withTenant(tenant, async (tx) => {
      const svc = service(tx);
      const drafted = await svc.draftFromJobSpec({ jobSpec: 'Senior DBA', actor: { id: 'emil' }, tenantId: tenant });
      await svc.confirmVocabulary({
        mandateId: drafted.mandateId,
        tenantId: tenant,
        actor: { id: 'emil' },
        decisions: [
          { kind: 'title_variant', term: 'Senior Database Administrator', decision: 'confirm' },
          { kind: 'title_variant', term: 'Senior Database Engineer', decision: 'confirm' },
          { kind: 'title_variant', term: 'Database Platform Engineer', decision: 'reject' },
          { kind: 'must_have_skill', term: 'Oracle', decision: 'confirm' },
          { kind: 'must_have_skill', term: 'SQL Server', decision: 'confirm' },
          { kind: 'exclusion', term: 'junior', decision: 'confirm' },
        ],
      });
      return svc.buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant });
    });

    expect(plan.constraints).toHaveLength(5);
    expect(plan.pipeline.constrainedMarket).toBe(true);
    expect(plan.pipeline.advice.join(' ')).toMatch(/Secret clearance/);

    // The rejected title is gone; the confirmed ones are there; no constraint leaked in.
    const boolean = plan.strings.strings.find((s) => s.kind === 'linkedin_recruiter_boolean')!.value;
    expect(boolean).toContain('"Senior Database Administrator"');
    expect(boolean).not.toContain('Database Platform Engineer');
    expect(boolean).not.toContain('Secret');
  });
});
