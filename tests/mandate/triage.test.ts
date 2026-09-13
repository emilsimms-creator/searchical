import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { fakeModel, NAV_CANADA_TECHNOLOGIST_EXTRACTION, VP_INFRASTRUCTURE_EXTRACTION } from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import {
  CHANNEL_MATRIX_SEED, MandateService, OutOfScopeError, deriveIntakeGaps,
  jobSpecExtraction, planChannels, seedChannelRatings, toDraft,
} from '@/mandate';

/**
 * Regression tests for the segment triage defect.
 *
 * Found by running a real NAV CANADA Technologist specification through the
 * engine: with only two segments available, extraction was forced to pick one,
 * and the planner then recommended GitHub, AWS Community Builders and the CNCF
 * ambassador directories for a technician who maintains radar equipment.
 */
describe('segment triage', () => {
  it('refuses to plan channels for a role outside the two segments', () => {
    expect(() => planChannels(CHANNEL_MATRIX_SEED, 'out_of_scope')).toThrow(OutOfScopeError);
    expect(() => planChannels(CHANNEL_MATRIX_SEED, 'out_of_scope')).toThrow(
      /rates channels for senior executives and senior IT consultants only/,
    );
  });

  it('still plans normally for the supported segments', () => {
    for (const segment of ['senior_executive', 'senior_it_consultant'] as const) {
      expect(() => planChannels(CHANNEL_MATRIX_SEED, segment)).not.toThrow();
    }
  });

  it('requires a rationale on every verdict, not only refusals', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    expect(draft.segmentRationale).toMatch(/director level and above/i);
  });

  it('rejects an extraction that gives a segment with no reasoning', async () => {
    const { segmentRationale: _omitted, ...noRationale } = VP_INFRASTRUCTURE_EXTRACTION;
    const gateway = new LlmGateway(fakeModel(noRationale));
    await expect(gateway.run(jobSpecExtraction, { jobSpec: 'x' })).rejects.toThrow();
  });
});

describe('the NAV CANADA Technologist specification', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Triage Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
  });

  afterEach(async () => h?.close());

  const service = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0]) =>
    new MandateService(tx, new LlmGateway(fakeModel(NAV_CANADA_TECHNOLOGIST_EXTRACTION)), null);

  it('is stopped at triage with the reasoning attached', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: 'NAV CANADA Technologist', actor: { id: 'emil' }, tenantId: tenant }),
    );

    expect(drafted.status).toBe('out_of_scope');
    expect(drafted.outOfScopeReason).toMatch(/training salary/);
    expect(drafted.outOfScopeReason).toMatch(/no seniority marker/i);
  });

  it('is recorded rather than discarded, because what we cannot serve is worth knowing', async () => {
    await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: 'NAV CANADA Technologist', actor: { id: 'emil' }, tenantId: tenant }),
    );

    const rows = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT title, segment::text AS segment, status::text AS status, segment_rationale FROM mandates
      `)) as unknown as { rows: { title: string; segment: string; status: string; segment_rationale: string }[] };
      return r.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.segment).toBe('out_of_scope');
    expect(rows[0]!.status).toBe('out_of_scope');
    expect(rows[0]!.segment_rationale.length).toBeGreaterThan(50);
  });

  it('cannot be confirmed into life by a recruiter clicking through', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: 'NAV CANADA Technologist', actor: { id: 'emil' }, tenantId: tenant }),
    );

    await expectRejection(
      h.app.withTenant(tenant, (tx) =>
        service(tx).confirmVocabulary({
          mandateId: drafted.mandateId,
          tenantId: tenant,
          actor: { id: 'emil' },
          decisions: [{ kind: 'title_variant', term: 'Technologist', decision: 'confirm' }],
        }),
      ),
      /outside the two segments/,
      'an out of scope mandate must not be confirmable',
    );
  });

  it('produces no search plan, which is the whole point', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx).draftFromJobSpec({ jobSpec: 'NAV CANADA Technologist', actor: { id: 'emil' }, tenantId: tenant }),
    );

    await expectRejection(
      h.app.withTenant(tenant, (tx) => service(tx).buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant })),
      /outside the two segments/,
      'no channel plan for an out of scope mandate',
    );

    const strings = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`SELECT count(*)::int AS n FROM search_strings`)) as unknown as {
        rows: { n: number }[];
      };
      return r.rows[0]!.n;
    });
    expect(strings).toBe(0);
  });
});

describe('the location gap', () => {
  it('asks where the role is when the specification does not say', async () => {
    const gateway = new LlmGateway(fakeModel(NAV_CANADA_TECHNOLOGIST_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    const gap = deriveIntakeGaps(draft).find((g) => g.field === 'location');

    expect(gap).toBeDefined();
    expect(gap!.question).toMatch(/returns the wrong people everywhere/);
  });

  it('stays quiet when the specification names a location', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    expect(deriveIntakeGaps(draft).some((g) => g.field === 'location')).toBe(false);
  });
});

/**
 * The second axis of the force-fitting defect.
 *
 * A Director of Enterprise Strategy at a credit union clears the seniority bar
 * comfortably and is not this practice's market. The segments are seniority
 * definitions; the channel matrix behind them was researched for senior
 * technology talent. Nothing connected the two, so the engine passed her through
 * triage and recommended the CIO Association of Canada as the top channel.
 */
describe('domain triage', () => {
  it('refuses a senior executive who is outside technology, and says which bar failed', async () => {
    const { LlmGateway } = await import('@/llm/gateway');
    const { fakeModel, DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION } = await import('../helpers/model');
    const draft = toDraft(
      await new LlmGateway(fakeModel(DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION)).run(jobSpecExtraction, { jobSpec: 'x' }),
    );

    expect(draft.segment).toBe('out_of_scope');
    expect(draft.outOfScopeReason).toBe('domain');
    expect(draft.segmentRationale).toMatch(/clears the seniority bar/i);
    expect(() => planChannels(CHANNEL_MATRIX_SEED, draft.segment)).toThrow(OutOfScopeError);
  });

  it('records no refusal reason for a mandate that is in scope', async () => {
    const { LlmGateway } = await import('@/llm/gateway');
    const { fakeModel, VP_INFRASTRUCTURE_EXTRACTION } = await import('../helpers/model');
    const draft = toDraft(
      await new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION)).run(jobSpecExtraction, { jobSpec: 'x' }),
    );
    expect(draft.outOfScopeReason).toBeNull();
  });

  it('names both technology segments as technology segments in the prompt', () => {
    const { system } = jobSpecExtraction.render({ jobSpec: 'x' });
    expect(system).toMatch(/SENIOR TECHNOLOGY TALENT/);
    expect(system).toMatch(/every modern executive role touches technology, and almost none of them are technology/);
  });
});
