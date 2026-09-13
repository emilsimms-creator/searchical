import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { fakeModel, VP_INFRASTRUCTURE_EXTRACTION } from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import { MandateService, fixtureTitleFrequency, seedChannelRatings, type TermDecision } from '@/mandate';

const JOB_SPEC = `VP, Infrastructure and Cloud. Ottawa, hybrid. Reporting to the CIO, this leader will
consolidate three regional data centres onto a hybrid Azure and AWS footprint and stand up a single
operations function across the merged estate. Team of about 60 across four sites, 40 million dollar
operating budget.`;

const FREQUENCY = fixtureTitleFrequency({
  'VP Infrastructure': 240,
  'Director, Cloud Infrastructure': 96,
  'Head of Cloud and Infrastructure': 31,
  'Chief Infrastructure Evangelist': 0,
});

const CONFIRM_ALL: TermDecision[] = [
  { kind: 'title_variant', term: 'VP Infrastructure', decision: 'confirm' },
  { kind: 'title_variant', term: 'Director, Cloud Infrastructure', decision: 'confirm' },
  { kind: 'title_variant', term: 'Head of Cloud and Infrastructure', decision: 'confirm' },
  { kind: 'title_variant', term: 'Chief Infrastructure Evangelist', decision: 'reject' },
  { kind: 'must_have_skill', term: 'hybrid cloud', decision: 'confirm' },
  { kind: 'must_have_skill', term: 'Azure', decision: 'confirm' },
  { kind: 'must_have_skill', term: 'AWS', decision: 'confirm' },
  { kind: 'exclusion', term: 'sales', decision: 'confirm' },
];

describe('the mandate engine end to end', () => {
  let h: Harness;
  let tenant: string;

  const service = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0], extraction: unknown = VP_INFRASTRUCTURE_EXTRACTION) =>
    new MandateService(tx, new LlmGateway(fakeModel(extraction)), FREQUENCY);

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Mandate Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
  });

  afterEach(async () => h?.close());

  it('seeds the full channel matrix for a new tenant', async () => {
    const count = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`SELECT count(*)::int AS n FROM channel_ratings`)) as unknown as {
        rows: { n: number }[];
      };
      return r.rows[0]!.n;
    });
    expect(count).toBe(29);
  });

  it('drafts a mandate that is awaiting confirmation, never live', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant }),
    );

    expect(drafted.status).toBe('awaiting_confirmation');
    expect(drafted.gaps).toEqual([]);
    // The invented title is present with a zero count, not dropped.
    expect(drafted.vocabulary.zeroCount.map((t) => t.term)).toEqual(['Chief Infrastructure Evangelist']);
    expect(drafted.vocabulary.terms[0]!.term).toBe('VP Infrastructure');
  });

  it('refuses to build a plan before a human has confirmed the vocabulary', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant }),
    );

    await expectRejection(
      h.app.withTenant(tenant, (tx) => service(tx).buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant })),
      /confirm the market vocabulary/,
      'an unconfirmed mandate must not produce a search plan',
    );
  });

  it('refuses to go live with every title rejected', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant }),
    );

    await expectRejection(
      h.app.withTenant(tenant, (tx) =>
        service(tx).confirmVocabulary({
          mandateId: drafted.mandateId,
          tenantId: tenant,
          actor: { id: 'emil' },
          decisions: CONFIRM_ALL.map((d) => ({ ...d, decision: 'reject' as const })),
        }),
      ),
      /no confirmed title variant/,
      'a mandate with nothing to search for must not go live',
    );
  });

  it('produces the full plan once confirmed', async () => {
    const plan = await h.app.withTenant(tenant, async (tx) => {
      const svc = service(tx);
      const drafted = await svc.draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant });
      await svc.confirmVocabulary({
        mandateId: drafted.mandateId,
        tenantId: tenant,
        actor: { id: 'emil' },
        decisions: CONFIRM_ALL,
      });
      return svc.buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant, pipeline: { targetConversations: 10, longListSize: 75 } });
    });

    expect(plan.strings.strings.find((s) => s.kind === 'linkedin_recruiter_boolean')?.value).toBe(
      '("VP Infrastructure" OR "Director, Cloud Infrastructure" OR "Head of Cloud and Infrastructure") ' +
        'AND ("hybrid cloud" OR "Azure" OR "AWS") NOT ("sales")',
    );
    // The rejected title never reaches the search.
    expect(plan.strings.strings[0]!.value).not.toContain('Evangelist');

    expect(plan.channels.recommended.length).toBeGreaterThanOrEqual(3);
    expect(plan.channels.recommended.length).toBeLessThanOrEqual(5);
    expect(plan.channels.selections.find((s) => s.channelCode === 'github')?.priority).toBe('skip');

    expect(plan.pipeline.contactsRequired).toBe(100);
    expect(plan.pipeline.longListSufficient).toBe(false);
  });

  it('persists the plan, and regenerating appends rather than overwrites', async () => {
    const mandateId = await h.app.withTenant(tenant, async (tx) => {
      const svc = service(tx);
      const drafted = await svc.draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant });
      await svc.confirmVocabulary({ mandateId: drafted.mandateId, tenantId: tenant, actor: { id: 'emil' }, decisions: CONFIRM_ALL });
      await svc.buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant });
      await svc.buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant });
      return drafted.mandateId;
    });

    const counts = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT
          (SELECT count(*)::int FROM search_strings WHERE mandate_id = ${mandateId}::uuid) AS strings,
          (SELECT count(*)::int FROM channel_selections WHERE mandate_id = ${mandateId}::uuid) AS channels,
          (SELECT count(*)::int FROM pipeline_projections WHERE mandate_id = ${mandateId}::uuid) AS projections
      `)) as unknown as { rows: { strings: number; channels: number; projections: number }[] };
      return r.rows[0]!;
    });

    // Three string kinds, generated twice: history is kept so an old string
    // stays explicable. Three rather than four because this is an executive
    // mandate, the code host rates 1 of 5 for that segment and is skipped, and
    // the strings now respect the plan rather than contradicting it.
    expect(counts.strings).toBe(6);
    expect(counts.projections).toBe(2);
    // Channel selections are per mandate, so the second run is a no-op.
    expect(counts.channels).toBe(29);
  });

  it('watchlists every target company permanently', async () => {
    const rows = await h.app.withTenant(tenant, async (tx) => {
      await service(tx).draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant });
      const r = (await tx.execute(sql`SELECT name, watchlisted FROM target_companies`)) as unknown as {
        rows: { name: string; watchlisted: boolean }[];
      };
      return r.rows;
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.watchlisted)).toBe(true);
  });

  it('records the questions a thin job specification leaves open', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx, { ...VP_INFRASTRUCTURE_EXTRACTION, careerMoveCase: null, firstYearOutcomes: null }).draftFromJobSpec({
        jobSpec: 'VP Infrastructure. Ottawa. Azure and AWS required.',
        actor: { id: 'emil' },
        tenantId: tenant,
      }),
    );

    expect(drafted.gaps.map((g) => g.field).sort()).toEqual(['careerMoveCase', 'firstYearOutcomes']);

    const stored = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`SELECT field FROM intake_gaps ORDER BY field`)) as unknown as {
        rows: { field: string }[];
      };
      return r.rows.map((x) => x.field);
    });
    expect(stored).toEqual(['careerMoveCase', 'firstYearOutcomes']);
  });

  it('lets a recruiter add a title the model never proposed', async () => {
    const plan = await h.app.withTenant(tenant, async (tx) => {
      const svc = service(tx);
      const drafted = await svc.draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant });
      await svc.confirmVocabulary({
        mandateId: drafted.mandateId,
        tenantId: tenant,
        actor: { id: 'emil' },
        decisions: CONFIRM_ALL,
        additions: [{ kind: 'title_variant', term: 'Directeur, Infrastructure infonuagique' }],
      });
      return svc.buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant });
    });

    expect(plan.strings.strings[0]!.value).toContain('Directeur, Infrastructure infonuagique');
  });

  it('captures source of hire from the first event, and will not let it be rewritten', async () => {
    const mandateId = await h.app.withTenant(tenant, async (tx) => {
      const svc = service(tx);
      const drafted = await svc.draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant });
      await svc.recordSourceOfHire({
        tenantId: tenant,
        mandateId: drafted.mandateId,
        channelCode: 'referrals_from_past_placements',
        stage: 'identified',
        detail: { referredBy: 'former placement' },
      });
      return drafted.mandateId;
    });

    const n = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM source_of_hire_events WHERE mandate_id = ${mandateId}::uuid`,
      )) as unknown as { rows: { n: number }[] };
      return r.rows[0]!.n;
    });
    expect(n).toBe(1);

    await expectRejection(
      h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE source_of_hire_events SET stage = 'placed'`)),
      /permission denied/i,
      'attribution history must not be rewritable',
    );
  });

  it('keeps mandates inside their tenant', async () => {
    const other = (await seedTenant(h.app, 'Other Practice')).id;
    await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: JOB_SPEC, actor: { id: 'emil' }, tenantId: tenant }),
    );

    const seen = await h.app.withTenant(other, async (tx) => {
      const r = (await tx.execute(sql`SELECT count(*)::int AS n FROM mandates`)) as unknown as { rows: { n: number }[] };
      return r.rows[0]!.n;
    });
    expect(seen).toBe(0);
  });
});
