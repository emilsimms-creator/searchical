import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import {
  ALGONQUIN_NETWORK_DESIGNER_EXTRACTION,
  ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION,
  DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION,
  fakeModel,
} from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import { generateDiscoveryQueries } from '@/discovery';
import { searchableSources } from '@/discovery/sources';
import { sequenceFor } from '@/engagement';
import { MESSAGE_TEMPLATES } from '@/engagement/templates';
import {
  CHANNEL_MATRIX_SEED, MIN_OVERRIDE_REASON_CHARS, MandateService, TriageOverrideError,
  applyTriageOverride, jobSpecExtraction, overrideBlocker, planChannels, seedChannelRatings, toDraft,
  validateOverrideRequest,
} from '@/mandate';

const REASON = 'The client confirmed a five year contract coordinator is what they want to hire.';

const draftOf = async (response: unknown) =>
  toDraft(await new LlmGateway(fakeModel(response)).run(jobSpecExtraction, { jobSpec: 'x' }));

describe('what may be overruled', () => {
  it('allows a refusal on seniority and nothing else', () => {
    expect(overrideBlocker('seniority')).toBeNull();
    expect(overrideBlocker('domain')).toMatch(/outside technology/);
    expect(overrideBlocker('both')).toMatch(/cannot be overruled/);
  });

  it('treats a refusal with no recorded axis as the strict case, because a missing axis is not permission', () => {
    expect(overrideBlocker(null)).not.toBeNull();
  });

  it('wants a real reason, a named person and a segment the practice recruits', () => {
    const ok = { segment: 'technical_specialist', reason: REASON, actor: 'emil' } as const;
    expect(() => validateOverrideRequest(ok)).not.toThrow();
    expect(() => validateOverrideRequest({ ...ok, reason: 'client asked' })).toThrow(TriageOverrideError);
    expect(() => validateOverrideRequest({ ...ok, reason: ' '.repeat(60) })).toThrow(
      new RegExp(`at least ${MIN_OVERRIDE_REASON_CHARS} characters`),
    );
    expect(() => validateOverrideRequest({ ...ok, actor: '  ' })).toThrow(/name the person/);
    expect(() => validateOverrideRequest({ ...ok, segment: 'out_of_scope' as never })).toThrow(/segment this practice recruits/);
  });

  it('moves a refused draft into the chosen segment and clears the refusal', async () => {
    const refused = await draftOf(ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION);
    const moved = applyTriageOverride(refused, { segment: 'technical_specialist', reason: REASON, actor: 'emil' }, 'seniority');
    expect(moved.segment).toBe('technical_specialist');
    expect(moved.outOfScopeReason).toBeNull();
    // The model's reasoning is kept as written: the overrule is recorded beside it, not over it.
    expect(moved.segmentRationale).toBe(refused.segmentRationale);
  });

  it('cannot be argued into scope by re-rolling the extraction', async () => {
    // Recorded as a seniority refusal, but a fresh read now finds it outside technology.
    const freshDomain = await draftOf(DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION);
    expect(() =>
      applyTriageOverride(freshDomain, { segment: 'technical_specialist', reason: REASON, actor: 'emil' }, 'seniority'),
    ).toThrow(/outside technology/);
    // And the reverse: refused on domain when recorded, so a friendlier fresh run changes nothing.
    const friendly = await draftOf(ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION);
    expect(() =>
      applyTriageOverride(friendly, { segment: 'technical_specialist', reason: REASON, actor: 'emil' }, 'domain'),
    ).toThrow(TriageOverrideError);
  });
});

describe('the third segment', () => {
  it('plans channels provisionally and says it is borrowed', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'technical_specialist');
    expect(plan.provisional).toBe(true);
    expect(plan.note).toMatch(/Provisional/);
    expect(plan.note).toMatch(/lower of its two researched scores/);
    expect(plan.recommended.length).toBeGreaterThanOrEqual(3);
    expect(plan.recommended.length).toBeLessThanOrEqual(5);
    expect(planChannels(CHANNEL_MATRIX_SEED, 'senior_executive').provisional).toBe(false);
    expect(planChannels(CHANNEL_MATRIX_SEED, 'senior_it_consultant').provisional).toBe(false);
  });

  it('keeps the channels the research supports for both senior segments and drops the developer communities', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'technical_specialist');
    const priority = (code: string) => plan.selections.find((s) => s.channelCode === code)!.priority;
    for (const code of ['referrals_from_past_placements', 'email', 'linkedin_recruiter']) {
      expect(priority(code), code).toBe('primary');
    }
    // The failure that started this: a cabling coordinator pointed at GitHub and the ambassador programmes.
    for (const code of ['github', 'certification_and_ambassador_communities', 'stack_overflow']) {
      expect(priority(code), code).toBe('skip');
    }
  });

  it('never rates a channel above either of the two researched scores', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'technical_specialist');
    for (const s of plan.selections) {
      const seed = CHANNEL_MATRIX_SEED.find((c) => c.code === s.channelCode)!;
      expect(s.fit, s.channelCode).toBeLessThanOrEqual(Math.min(seed.fitSeniorExecutive, seed.fitSeniorItConsultant));
    }
  });

  it('follows the technologist sequence, opening with a connection note', () => {
    expect(sequenceFor('technical_specialist')[0]).toMatchObject({ channel: 'linkedin_connection' });
    expect(sequenceFor('technical_specialist')).toHaveLength(6);
    const connection = MESSAGE_TEMPLATES.find((t) => t.code === 'linkedin_connection_note')!;
    expect(connection.segments).toContain('technical_specialist');
    // The executive InMail stays executive only.
    expect(MESSAGE_TEMPLATES.find((t) => t.code === 'first_inmail')!.segments).not.toContain('technical_specialist');
  });

  it('forms no discovery query, because no open web surface has been researched for it', () => {
    expect(searchableSources('technical_specialist')).toEqual([]);
    const result = generateDiscoveryQueries({
      terms: [{ kind: 'title_variant', term: 'Network Designer', origin: 'recruiter', status: 'confirmed', observedCount: null, rank: 1 }],
      segment: 'technical_specialist',
      location: 'Ottawa, Ontario',
    });
    expect(result.queries).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/No open web surface has been researched for technical specialists/);
  });
});

describe('overruling a refusal, end to end', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Override Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
  });

  afterEach(async () => h?.close());

  const service = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0], response: unknown) =>
    new MandateService(tx, new LlmGateway(fakeModel(response)), null);

  const refuse = (response: unknown = ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION) =>
    h.app.withTenant(tenant, (tx) =>
      service(tx, response).draftFromJobSpec({ jobSpec: 'Network Designer', actor: { id: 'emil' }, tenantId: tenant }),
    );

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    h.app.withTenant(tenant, async (tx) => ((await tx.execute(query)) as unknown as { rows: T[] }).rows);

  it('puts the refused mandate back on the normal path, with its draft built on the same row', async () => {
    const refused = await refuse();
    expect(refused.status).toBe('out_of_scope');

    const overruled = await h.app.withTenant(tenant, (tx) =>
      service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
        mandateId: refused.mandateId, jobSpec: 'Network Designer', segment: 'technical_specialist',
        reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
      }),
    );

    expect(overruled.mandateId).toBe(refused.mandateId);
    expect(overruled.status).toBe('awaiting_confirmation');
    expect(overruled.vocabulary.terms.length).toBeGreaterThan(0);
    expect(overruled.gaps.map((g) => g.field)).toContain('firstYearOutcomes');

    const mandate = await rows<{ segment: string; status: string; reason: string | null }>(sql`
      SELECT segment::text AS segment, status::text AS status, out_of_scope_reason::text AS reason FROM mandates
    `);
    expect(mandate).toEqual([{ segment: 'technical_specialist', status: 'awaiting_confirmation', reason: null }]);

    const constraints = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM mandate_constraints`);
    expect(constraints[0]!.n).toBe(2);
  });

  it('records who overruled the model and why, beside what the model said', async () => {
    const refused = await refuse();
    await h.app.withTenant(tenant, (tx) =>
      service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
        mandateId: refused.mandateId, jobSpec: 'x', segment: 'technical_specialist',
        reason: `  ${REASON}  `, actor: { id: 'emil' }, tenantId: tenant,
      }),
    );

    const [row] = await rows<{
      original_reason: string; original_rationale: string; new_segment: string; reason: string; overridden_by: string;
    }>(sql`SELECT original_reason::text, original_rationale, new_segment::text, reason, overridden_by FROM triage_overrides`);
    expect(row!.original_reason).toBe('seniority');
    expect(row!.original_rationale).toMatch(/borderline/);
    expect(row!.new_segment).toBe('technical_specialist');
    expect(row!.reason).toBe(REASON);
    expect(row!.overridden_by).toBe('emil');
  });

  it('still needs the vocabulary gate, and then plans a provisional search with no code surface', async () => {
    const refused = await refuse();
    await h.app.withTenant(tenant, (tx) =>
      service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
        mandateId: refused.mandateId, jobSpec: 'x', segment: 'technical_specialist',
        reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
      }),
    );

    await expectRejection(
      h.app.withTenant(tenant, (tx) => service(tx, {}).buildSearchPlan({ mandateId: refused.mandateId, tenantId: tenant })),
      /must confirm the market vocabulary/,
      'an overrule gets past triage and no further',
    );

    await h.app.withTenant(tenant, (tx) =>
      service(tx, {}).confirmVocabulary({
        mandateId: refused.mandateId, tenantId: tenant, actor: { id: 'emil' },
        decisions: [
          { kind: 'title_variant', term: 'Network Designer', decision: 'confirm' },
          { kind: 'must_have_skill', term: 'structured cabling', decision: 'confirm' },
        ],
      }),
    );
    const plan = await h.app.withTenant(tenant, (tx) =>
      service(tx, {}).buildSearchPlan({ mandateId: refused.mandateId, tenantId: tenant }),
    );

    expect(plan.channels.provisional).toBe(true);
    expect(plan.strings.strings.map((s) => s.kind)).not.toContain('github_xray');
  });

  it('refuses to overrule a role refused on domain, and records nothing', async () => {
    const refused = await refuse(DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION);
    await expectRejection(
      h.app.withTenant(tenant, (tx) =>
        service(tx, DIRECTOR_ENTERPRISE_STRATEGY_EXTRACTION).overrideTriage({
          mandateId: refused.mandateId, jobSpec: 'x', segment: 'senior_executive',
          reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
        }),
      ),
      /refused on domain/,
      'a domain refusal cannot be overruled',
    );
    expect((await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM triage_overrides`))[0]!.n).toBe(0);
    expect((await rows<{ status: string }>(sql`SELECT status::text AS status FROM mandates`))[0]!.status).toBe('out_of_scope');
  });

  it('refuses a thin reason before anything is written', async () => {
    const refused = await refuse();
    await expectRejection(
      h.app.withTenant(tenant, (tx) =>
        service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
          mandateId: refused.mandateId, jobSpec: 'x', segment: 'technical_specialist',
          reason: 'client asked', actor: { id: 'emil' }, tenantId: tenant,
        }),
      ),
      /needs a reason/,
      'an overrule with no real reason',
    );
    expect((await rows<{ status: string }>(sql`SELECT status::text AS status FROM mandates`))[0]!.status).toBe('out_of_scope');
  });

  it('has nothing to overrule on a mandate that was never refused', async () => {
    const accepted = await refuse(ALGONQUIN_NETWORK_DESIGNER_EXTRACTION);
    expect(accepted.status).toBe('awaiting_confirmation');
    await expectRejection(
      h.app.withTenant(tenant, (tx) =>
        service(tx, ALGONQUIN_NETWORK_DESIGNER_EXTRACTION).overrideTriage({
          mandateId: accepted.mandateId, jobSpec: 'x', segment: 'technical_specialist',
          reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
        }),
      ),
      /not refused, so there is nothing to overrule/,
    );
  });

  it('cannot be overruled twice, because the first overrule moved it out of the refused state', async () => {
    const refused = await refuse();
    const overrule = () =>
      h.app.withTenant(tenant, (tx) =>
        service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
          mandateId: refused.mandateId, jobSpec: 'x', segment: 'technical_specialist',
          reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
        }),
      );
    await overrule();
    await expectRejection(overrule(), /not refused/);
  });

  describe('in the database itself, not only the service', () => {
    const insert = (originalReason: string, reason: string, segment = 'technical_specialist') =>
      h.app.withTenant(tenant, async (tx) => {
        const [m] = ((await tx.execute(sql`
          INSERT INTO mandates (tenant_id, title, segment, function_domain, status, created_by)
          VALUES (${tenant}::uuid, 'x', 'out_of_scope', 'x', 'out_of_scope', 'emil') RETURNING id
        `)) as unknown as { rows: { id: string }[] }).rows;
        await tx.execute(sql`
          INSERT INTO triage_overrides (tenant_id, mandate_id, original_reason, original_rationale, new_segment, reason, overridden_by)
          VALUES (${tenant}::uuid, ${m!.id}::uuid, ${originalReason}::out_of_scope_reason, 'r', ${segment}::mandate_segment, ${reason}, 'emil')
        `);
      });

    it('accepts a seniority overrule with a real reason', async () => {
      await insert('seniority', REASON);
    });

    it('refuses to record an overrule of a domain refusal', async () => {
      await expectRejection(insert('domain', REASON), /triage_overrides_seniority_only/);
    });

    it('refuses an overrule whose target is still out of scope', async () => {
      await expectRejection(insert('seniority', REASON, 'out_of_scope'), /triage_overrides_in_scope_target/);
    });

    it('refuses a reason too thin to be a record', async () => {
      await expectRejection(insert('seniority', 'client asked'), /triage_overrides_reason_substantive/);
    });

    it('cannot be rewritten or deleted by the application', async () => {
      const refused = await refuse();
      await h.app.withTenant(tenant, (tx) =>
        service(tx, ALGONQUIN_NETWORK_DESIGNER_REFUSED_EXTRACTION).overrideTriage({
          mandateId: refused.mandateId, jobSpec: 'x', segment: 'technical_specialist',
          reason: REASON, actor: { id: 'emil' }, tenantId: tenant,
        }),
      );
      await expectRejection(
        h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE triage_overrides SET reason = 'changed my mind about this'`)),
        /permission denied/,
      );
      await expectRejection(
        h.app.withTenant(tenant, (tx) => tx.execute(sql`DELETE FROM triage_overrides`)),
        /permission denied/,
      );
    });
  });
});
