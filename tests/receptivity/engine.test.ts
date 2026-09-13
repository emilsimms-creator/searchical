import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { Ledger } from '@/ledger';
import { recruiterManualEntry } from '@/connectors';
import {
  ReceptivityService, SCORE_MODEL_V1, installScoreModel, seedSignalTypes,
} from '@/receptivity';

const AS_OF = new Date('2026-09-09T00:00:00Z');
type Tx = Parameters<Parameters<Harness['app']['withTenant']>[1]>[0];

/** A tenant with a mandate, an employer, and two people working there. */
async function scaffold(tx: Tx, tenantId: string) {
  const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
  const sourceId = await ledger.registerSource(recruiterManualEntry);
  const evidenceId = await ledger.recordEvidence({
    sourceId, collectionMethod: 'recruiter_entered', collectedAt: AS_OF,
    lawfulBasis: 'legitimate_interest', jurisdiction: 'CA', confidence: 0.9,
  });

  const one = (res: unknown) => (res as { rows: { id: string }[] }).rows[0]!.id;

  const mandateId = one(await tx.execute(sql`
    INSERT INTO mandates (tenant_id, title, segment, function_domain, status, created_by,
                          confirmed_by, confirmed_at)
    VALUES (${tenantId}::uuid, 'VP Engineering', 'senior_executive', 'Engineering', 'live', 'emil', 'emil', now())
    RETURNING id`));

  const orgId = one(await tx.execute(sql`
    INSERT INTO organizations (tenant_id, name) VALUES (${tenantId}::uuid, 'Watched Employer') RETURNING id`));

  const otherOrgId = one(await tx.execute(sql`
    INSERT INTO organizations (tenant_id, name) VALUES (${tenantId}::uuid, 'Elsewhere') RETURNING id`));

  const people: string[] = [];
  for (const [name, employer, ended] of [
    ['Tracked One', orgId, null],
    ['Tracked Two', orgId, null],
    ['Left Years Ago', orgId, '2022-01-01'],
    ['Works Elsewhere', otherOrgId, null],
  ] as const) {
    const personId = one(await tx.execute(sql`
      INSERT INTO persons (tenant_id, display_name) VALUES (${tenantId}::uuid, ${name}) RETURNING id`));
    await ledger.recordEmployment({
      personId, organizationId: employer, title: 'Engineering Director', evidenceId,
      ...(ended ? { endedOn: ended } : {}),
    });
    await tx.execute(sql`
      INSERT INTO prospects (tenant_id, mandate_id, person_id, interest_scale,
                             f3_buying_cues, f4_push_factors, f5_motivator_match,
                             f6_timing, f7_deal_breakers, f8_compensation)
      VALUES (${tenantId}::uuid, ${mandateId}::uuid, ${personId}::uuid, 'maybe', 2, 3, 4, 2, 5, 3)`);
    people.push(personId);
  }

  return { mandateId, orgId, otherOrgId, evidenceId, people };
}

describe('the receptivity engine', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Receptivity Test')).id;
    await h.app.withTenant(tenant, async (tx) => {
      await seedSignalTypes(tx, tenant);
      await installScoreModel(tx, tenant, SCORE_MODEL_V1, { id: 'emil' });
    });
  });

  afterEach(async () => h?.close());

  const service = (tx: Tx) => new ReceptivityService(tx, tenant, { id: 'emil' });

  it('seeds the full signal taxonomy with the employer triggers on the organization clock', async () => {
    const rows = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT subject_type::text AS st, count(*)::int AS n FROM signal_types GROUP BY 1 ORDER BY 1
      `)) as unknown as { rows: { st: string; n: number }[] };
      return r.rows;
    });
    expect(rows).toEqual([{ st: 'organization', n: 6 }, { st: 'person', n: 17 }]);
  });

  /**
   * Exit criterion: an employer trigger fires and re-ranks the people tracked
   * at that employer.
   */
  it('fans an employer trigger out to everyone currently tracked there, and no further', async () => {
    const { scored, orgId } = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const result = await service(tx).recordEmployerTrigger({
        organizationId: built.orgId,
        signalCode: 'employer_return_to_office',
        observedAt: AS_OF,
        evidenceId: built.evidenceId,
      });
      return { scored: result.prospectsRescored, orgId: built.orgId };
    });

    // Two current employees. Not the leaver, not the person at another company.
    expect(scored).toBe(2);
    expect(orgId).toBeTruthy();

    const detail = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT p.display_name, s.decayed_score, s.tier::text AS tier
        FROM scores s JOIN prospects pr ON pr.id = s.prospect_id JOIN persons p ON p.id = pr.person_id
        ORDER BY p.display_name
      `)) as unknown as { rows: { display_name: string; decayed_score: string; tier: string }[] };
      return r.rows;
    });
    expect(detail.map((d) => d.display_name)).toEqual(['Tracked One', 'Tracked Two']);
  });

  it('refuses to fan out a signal that belongs to a person', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        await service(tx).recordEmployerTrigger({
          organizationId: built.orgId,
          signalCode: 'public_opentowork_photo_frame',
          observedAt: AS_OF,
          evidenceId: built.evidenceId,
        });
      }),
      /attaches to a person, not an employer/,
      'a personal signal must not be applied to everyone at a company',
    );
  });

  it('carries an employer trigger into the person score, flagged as arriving via the employer', async () => {
    const explanation = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.recordEmployerTrigger({
        organizationId: built.orgId, signalCode: 'employer_return_to_office',
        observedAt: AS_OF, evidenceId: built.evidenceId,
      });
      const r = (await tx.execute(sql`
        SELECT explanation FROM scores ORDER BY computed_at DESC LIMIT 1
      `)) as unknown as { rows: { explanation: Record<string, unknown> }[] };
      return r.rows[0]!.explanation;
    });

    const signals = explanation['signals'] as { code: string; viaEmployer: boolean }[];
    expect(signals).toHaveLength(1);
    expect(signals[0]!.code).toBe('employer_return_to_office');
    expect(signals[0]!.viaEmployer).toBe(true);
    expect(String(explanation['headline'])).toMatch(/employer return-to-office mandate/);
  });

  /** Exit criterion: any score explains itself. */
  it('stores an explanation complete enough to answer why this person, why now', async () => {
    const explanation = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.recordEmployerTrigger({
        organizationId: built.orgId, signalCode: 'merger_or_acquisition_involving',
        observedAt: AS_OF, evidenceId: built.evidenceId,
      });
      const r = (await tx.execute(sql`
        SELECT explanation FROM scores ORDER BY computed_at DESC LIMIT 1
      `)) as unknown as { rows: { explanation: Record<string, unknown> }[] };
      return r.rows[0]!.explanation;
    });

    for (const key of ['modelVersion', 'factors', 'signals', 'stacking', 'rawScore',
                       'decayApplied', 'decayedScore', 'tier', 'headline']) {
      expect(explanation[key], key).toBeDefined();
    }
    expect((explanation['factors'] as unknown[]).length).toBe(8);
    expect(explanation['modelVersion']).toBe('1.0.0');
  });

  /** Exit criterion: a model version change does not alter a single historical score. */
  it('leaves every historical score untouched when the model changes', async () => {
    const before = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await service(tx).recordEmployerTrigger({
        organizationId: built.orgId, signalCode: 'employer_return_to_office',
        observedAt: AS_OF, evidenceId: built.evidenceId,
      });
      const r = (await tx.execute(sql`
        SELECT id, model_version, decayed_score FROM scores ORDER BY id
      `)) as unknown as { rows: { id: string; model_version: string; decayed_score: string }[] };
      return r.rows;
    });
    expect(before.length).toBe(2);

    // A model that weights the interview far more heavily than the signals.
    const v2 = {
      ...SCORE_MODEL_V1,
      version: '2.0.0',
      factors: SCORE_MODEL_V1.factors.map((f) =>
        f.id === 'f1' ? { ...f, weight: 0 } : f.id === 'f5' ? { ...f, weight: 30 } : f,
      ),
    };

    const comparison = await h.app.withTenant(tenant, async (tx) => {
      await installScoreModel(tx, tenant, v2, { id: 'emil' });
      return service(tx).backtest(v2, AS_OF);
    });

    const after = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT id, model_version, decayed_score, is_backtest FROM scores ORDER BY id
      `)) as unknown as { rows: { id: string; model_version: string; decayed_score: string; is_backtest: boolean }[] };
      return r.rows;
    });

    // Every original row is byte for byte what it was.
    const originals = after.filter((r) => !r.is_backtest);
    expect(originals).toEqual(before.map((b) => ({ ...b, is_backtest: false })));

    // And the replay is present, flagged, and says something different.
    const replays = after.filter((r) => r.is_backtest);
    expect(replays).toHaveLength(2);
    expect(replays.every((r) => r.model_version === '2.0.0')).toBe(true);
    expect(comparison).toHaveLength(2);
    expect(comparison[0]!.before).not.toBe(comparison[0]!.after);
  });

  it('refuses to store a score against an incoherent model', async () => {
    const broken = { ...SCORE_MODEL_V1, version: '9.9.9', factors: SCORE_MODEL_V1.factors.map((f) => ({ ...f, weight: 1 })) };
    await expectRejection(
      h.app.withTenant(tenant, (tx) => installScoreModel(tx, tenant, broken, { id: 'emil' })),
      /weights total 8, not 100/,
      'an incoherent model must not become the active one',
    );
  });

  it('will not let a score be rewritten', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await service(tx).recordEmployerTrigger({
        organizationId: built.orgId, signalCode: 'employer_return_to_office',
        observedAt: AS_OF, evidenceId: built.evidenceId,
      });
    });
    await expectRejection(
      h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE scores SET decayed_score = 99`)),
      /permission denied/i,
      'a score is an observation of what the model said, not a mutable field',
    );
  });

  it('puts every target company of a mandate on the watchlist permanently', async () => {
    const watched = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await tx.execute(sql`
        INSERT INTO target_companies (tenant_id, mandate_id, name, kind)
        VALUES (${tenant}::uuid, ${built.mandateId}::uuid, 'Competitor A', 'competitor'),
               (${tenant}::uuid, ${built.mandateId}::uuid, 'Academy B', 'academy')`);
      return service(tx).armWatchlistFromMandate(built.mandateId);
    });
    expect(watched.watched).toBe(2);

    const rows = await h.app.withTenant(tenant, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT o.name, w.active FROM employer_watchlist w JOIN organizations o ON o.id = w.organization_id
        ORDER BY o.name
      `)) as unknown as { rows: { name: string; active: boolean }[] };
      return r.rows;
    });
    expect(rows.map((r) => r.name)).toEqual(['Academy B', 'Competitor A']);
    expect(rows.every((r) => r.active)).toBe(true);
  });

  it('resolves an identity deterministically, and asks rather than guessing otherwise', async () => {
    const result = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await tx.execute(sql`
        INSERT INTO person_identities (tenant_id, person_id, kind, value, confidence, evidence_id)
        VALUES (${tenant}::uuid, ${built.people[0]}::uuid, 'verified_email', 'known@example.org', 1.0,
                ${built.evidenceId}::uuid)`);
      const svc = service(tx);
      return {
        exact: await svc.resolve({ kind: 'verified_email', value: '  Known@Example.org ' }),
        guess: await svc.resolve({ kind: 'name_employer_window', value: 'j smith|watched employer' }),
        unknown: await svc.resolve({ kind: 'verified_email', value: 'nobody@example.org' }),
        expected: built.people[0],
      };
    });

    expect(result.exact).toEqual({ personId: result.expected, method: 'deterministic' });
    expect(result.guess.method).toBe('ask_recruiter');
    expect(result.unknown.method).toBe('ask_recruiter');
  });
});
