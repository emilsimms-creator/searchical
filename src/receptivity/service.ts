import { and, eq, sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import {
  employerWatchlist, identityMerges, organizations, personIdentities,
  prospects, scoreModels, scores, signalTypes, targetCompanies,
} from '@/db/schema';
import { Ledger } from '@/ledger';
import { SIGNAL_TYPE_SEED } from './signal-types';
import { SCORE_MODEL_V1, assertModelIsCoherent } from './scoring-model';
import { scoreProspect } from './scoring';
import {
  ReceptivityError, type InterestScale, type ScoreModel, type ScoreResult, type ScoredSignal,
  type SignalTypeSeed,
} from './types';

export interface Actor {
  readonly id: string;
}

/** Seed a tenant's signal taxonomy. Called once, with the tenant. */
export async function seedSignalTypes(tx: TenantTx, tenantId: string): Promise<number> {
  await tx
    .insert(signalTypes)
    .values(
      SIGNAL_TYPE_SEED.map((s: SignalTypeSeed) => ({
        tenantId,
        code: s.code,
        label: s.label,
        category: s.category,
        strength: s.strength,
        points: s.points,
        recencyWindowDays: s.recencyWindowDays,
        sourceCitation: s.sourceCitation,
        subjectType: s.subjectType,
        indicates: s.indicates,
        windowNote: s.windowNote ?? null,
        ordinal: s.ordinal,
      })),
    )
    .onConflictDoNothing();
  return SIGNAL_TYPE_SEED.length;
}

/**
 * Install a scoring model version and make it active.
 *
 * Installing never rewrites history: existing scores keep the version that
 * produced them. Use `backtest` to ask what a new model WOULD have said.
 */
export async function installScoreModel(
  tx: TenantTx,
  tenantId: string,
  model: ScoreModel,
  actor: Actor,
): Promise<void> {
  assertModelIsCoherent(model);
  await tx.execute(sql`UPDATE score_models SET active = false WHERE tenant_id = ${tenantId}::uuid AND active`);
  await tx
    .insert(scoreModels)
    .values({ tenantId, version: model.version, definition: model, active: true, createdBy: actor.id })
    .onConflictDoUpdate({
      target: [scoreModels.tenantId, scoreModels.version],
      set: { definition: model, active: true },
    });
}

export class ReceptivityService {
  readonly #tx: TenantTx;
  readonly #tenantId: string;
  readonly #actor: Actor;

  constructor(tx: TenantTx, tenantId: string, actor: Actor) {
    this.#tx = tx;
    this.#tenantId = tenantId;
    this.#actor = actor;
  }

  async activeModel(): Promise<ScoreModel> {
    const [row] = await this.#tx
      .select()
      .from(scoreModels)
      .where(and(eq(scoreModels.tenantId, this.#tenantId), eq(scoreModels.active, true)))
      .limit(1);
    if (!row) throw new ReceptivityError('no active scoring model for this tenant: call installScoreModel first');
    return row.definition as ScoreModel;
  }

  // -------------------------------------------------------------------------
  // The employer clock
  // -------------------------------------------------------------------------

  /**
   * Put every target company of a mandate on the watchlist.
   *
   * The entry outlives the mandate deliberately. The watchlist is the practice's
   * standing view of the employers it recruits from, and a trigger at one of
   * them is worth knowing about whether or not a search is open.
   */
  async armWatchlistFromMandate(mandateId: string): Promise<{ watched: number }> {
    const targets = await this.#tx
      .select()
      .from(targetCompanies)
      .where(eq(targetCompanies.mandateId, mandateId));

    let watched = 0;
    for (const target of targets) {
      if (!target.watchlisted) continue;
      let organizationId = target.organizationId;

      if (!organizationId) {
        const [org] = await this.#tx
          .insert(organizations)
          .values({ tenantId: this.#tenantId, name: target.name })
          .returning({ id: organizations.id });
        organizationId = org!.id;
        await this.#tx
          .update(targetCompanies)
          .set({ organizationId })
          .where(eq(targetCompanies.id, target.id));
      }

      await this.#tx
        .insert(employerWatchlist)
        .values({
          tenantId: this.#tenantId,
          organizationId,
          addedFromMandateId: mandateId,
          reason: `Target company for a mandate: ${target.kind}.`,
        })
        .onConflictDoNothing();
      watched += 1;
    }
    return { watched };
  }

  /**
   * Record a trigger at a watched employer, then fan it out.
   *
   * This is the highest leverage mechanism in the system. One return to office
   * mandate makes a whole floor receptive at once, and the event fires at the
   * employer before any individual behaviour appears, which is how a practice
   * reaches people ahead of the recruiters waiting for an open-to-work badge.
   */
  async recordEmployerTrigger(args: {
    organizationId: string;
    signalCode: string;
    observedAt: Date;
    evidenceId: string;
  }): Promise<{ signalId: string; prospectsRescored: number }> {
    const [type] = await this.#tx
      .select()
      .from(signalTypes)
      .where(and(eq(signalTypes.tenantId, this.#tenantId), eq(signalTypes.code, args.signalCode)))
      .limit(1);
    if (!type) throw new ReceptivityError(`unknown signal type: ${args.signalCode}`);
    if (type.subjectType !== 'organization') {
      throw new ReceptivityError(
        `signal "${args.signalCode}" attaches to a person, not an employer. Employer triggers are the ` +
          `only signals that fan out, and treating a personal signal as one would apply it to ` +
          `everyone at the company.`,
      );
    }

    const ledger = new Ledger(this.#tx, { type: this.#actor.id === 'system' ? 'system' : 'user', id: this.#actor.id });
    const signalId = await ledger.recordSignal({
      subjectType: 'organization',
      subjectId: args.organizationId,
      signalTypeId: type.id,
      observedAt: args.observedAt,
      evidenceId: args.evidenceId,
    });

    const rescored = await this.fanOut(args.organizationId, args.observedAt);
    return { signalId, prospectsRescored: rescored };
  }

  /**
   * Re-rank everyone tracked at an employer after a trigger there.
   *
   * Current employment is what counts: a trigger at a company someone left
   * three years ago says nothing about them today.
   */
  async fanOut(organizationId: string, asOf: Date): Promise<number> {
    const affected = (await this.#tx.execute(sql`
      SELECT DISTINCT p.id AS prospect_id
      FROM prospects p
      JOIN employments e ON e.person_id = p.person_id
      WHERE e.organization_id = ${organizationId}::uuid
        AND e.ended_on IS NULL
    `)) as unknown as { rows: { prospect_id: string }[] };

    for (const row of affected.rows) {
      await this.score(row.prospect_id, asOf);
    }
    return affected.rows.length;
  }

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------

  /**
   * Gather every signal that bears on a prospect: their own, plus the employer
   * triggers at the companies they currently work for.
   */
  async signalsFor(personId: string, asOf: Date): Promise<ScoredSignal[]> {
    const res = (await this.#tx.execute(sql`
      SELECT st.code, st.label, st.category::text AS category, st.subject_type::text AS subject_type,
             st.points, s.observed_at, s.expires_at,
             (s.subject_type = 'organization') AS via_employer
      FROM signals s
      JOIN signal_types st ON st.id = s.signal_type_id
      WHERE (s.subject_type = 'person' AND s.subject_id = ${personId}::uuid)
         OR (s.subject_type = 'organization' AND s.subject_id IN (
               SELECT e.organization_id FROM employments e
               WHERE e.person_id = ${personId}::uuid AND e.ended_on IS NULL))
      ORDER BY s.observed_at DESC
    `)) as unknown as {
      rows: {
        code: string; label: string; category: string; subject_type: string; points: number;
        observed_at: string; expires_at: string; via_employer: boolean;
      }[];
    };

    return res.rows.map((r) => ({
      code: r.code,
      label: r.label,
      category: r.category as ScoredSignal['category'],
      subjectType: r.subject_type as ScoredSignal['subjectType'],
      points: Number(r.points),
      observedAt: new Date(r.observed_at),
      expiresAt: new Date(r.expires_at),
      live: new Date(r.expires_at) > asOf,
      viaEmployer: r.via_employer,
    }));
  }

  /** Score a prospect under the active model and append the result. */
  async score(prospectId: string, asOf: Date): Promise<ScoreResult> {
    const model = await this.activeModel();
    const [prospect] = await this.#tx.select().from(prospects).where(eq(prospects.id, prospectId)).limit(1);
    if (!prospect) throw new ReceptivityError(`prospect ${prospectId} not found in this tenant`);

    const result = scoreProspect({
      signals: await this.signalsFor(prospect.personId, asOf),
      ...(prospect.interestScale ? { interestScale: prospect.interestScale as InterestScale } : {}),
      recruiterFactors: {
        ...(prospect.f3BuyingCues !== null ? { f3: prospect.f3BuyingCues } : {}),
        ...(prospect.f4PushFactors !== null ? { f4: prospect.f4PushFactors } : {}),
        ...(prospect.f5MotivatorMatch !== null ? { f5: prospect.f5MotivatorMatch } : {}),
        ...(prospect.f6Timing !== null ? { f6: prospect.f6Timing } : {}),
        ...(prospect.f7DealBreakers !== null ? { f7: prospect.f7DealBreakers } : {}),
        ...(prospect.f8Compensation !== null ? { f8: prospect.f8Compensation } : {}),
      },
      ...(prospect.lastMeaningfulTouchAt ? { lastMeaningfulTouchAt: prospect.lastMeaningfulTouchAt } : {}),
      asOf,
      model,
    });

    await this.#tx.insert(scores).values({
      tenantId: this.#tenantId,
      prospectId,
      modelVersion: model.version,
      rawScore: result.rawScore.toString(),
      decayedScore: result.decayedScore.toString(),
      tier: result.tier,
      nextTouchDueAt: result.nextTouchDueAt,
      explanation: result.explanation,
      isBacktest: false,
    });

    return result;
  }

  /**
   * What a different model WOULD have said, without touching history.
   *
   * Backtest rows are flagged, so a replay can never be mistaken for what the
   * practice actually did. This is the mechanism by which a heuristic becomes
   * a calibrated model rather than a number people have got used to.
   */
  async backtest(model: ScoreModel, asOf: Date): Promise<{ prospectId: string; before: number; after: number }[]> {
    assertModelIsCoherent(model);
    const rows = await this.#tx.select().from(prospects);
    const comparison: { prospectId: string; before: number; after: number }[] = [];

    for (const prospect of rows) {
      const latest = (await this.#tx.execute(sql`
        SELECT decayed_score FROM scores
        WHERE prospect_id = ${prospect.id}::uuid AND NOT is_backtest
        ORDER BY computed_at DESC LIMIT 1
      `)) as unknown as { rows: { decayed_score: string }[] };
      if (latest.rows.length === 0) continue;

      const replayed = scoreProspect({
        signals: await this.signalsFor(prospect.personId, asOf),
        ...(prospect.interestScale ? { interestScale: prospect.interestScale as InterestScale } : {}),
        recruiterFactors: {
          ...(prospect.f3BuyingCues !== null ? { f3: prospect.f3BuyingCues } : {}),
          ...(prospect.f4PushFactors !== null ? { f4: prospect.f4PushFactors } : {}),
          ...(prospect.f5MotivatorMatch !== null ? { f5: prospect.f5MotivatorMatch } : {}),
          ...(prospect.f6Timing !== null ? { f6: prospect.f6Timing } : {}),
          ...(prospect.f7DealBreakers !== null ? { f7: prospect.f7DealBreakers } : {}),
          ...(prospect.f8Compensation !== null ? { f8: prospect.f8Compensation } : {}),
        },
        ...(prospect.lastMeaningfulTouchAt ? { lastMeaningfulTouchAt: prospect.lastMeaningfulTouchAt } : {}),
        asOf,
        model,
      });

      await this.#tx.insert(scores).values({
        tenantId: this.#tenantId,
        prospectId: prospect.id,
        modelVersion: model.version,
        rawScore: replayed.rawScore.toString(),
        decayedScore: replayed.decayedScore.toString(),
        tier: replayed.tier,
        nextTouchDueAt: replayed.nextTouchDueAt,
        explanation: replayed.explanation,
        isBacktest: true,
      });

      comparison.push({
        prospectId: prospect.id,
        before: Number(latest.rows[0]!.decayed_score),
        after: replayed.decayedScore,
      });
    }
    return comparison;
  }

  // -------------------------------------------------------------------------
  // Identity resolution
  // -------------------------------------------------------------------------

  /**
   * Find the person behind an identifier, or say that a human must decide.
   *
   * Deterministic first, then heuristic, and below the threshold the system
   * asks rather than guessing. A bad merge in a database holding consent
   * records is a compliance incident, not a data quality annoyance.
   */
  async resolve(args: {
    kind: 'verified_email' | 'provider_id' | 'profile_url' | 'name_employer_window';
    value: string;
  }): Promise<{ personId: string; method: 'deterministic' } | { personId: null; method: 'ask_recruiter' }> {
    const normalised = args.value.trim().toLowerCase();
    const [hit] = await this.#tx
      .select()
      .from(personIdentities)
      .where(and(eq(personIdentities.kind, args.kind), eq(personIdentities.value, normalised)))
      .limit(1);

    // A verified email or a provider's stable identifier is an exact key. A
    // name plus employer window is a guess, and a guess is escalated.
    if (hit && (args.kind === 'verified_email' || args.kind === 'provider_id' || args.kind === 'profile_url')) {
      return { personId: hit.personId, method: 'deterministic' };
    }
    return { personId: null, method: 'ask_recruiter' };
  }

  /** Record a merge. Audited and reversible, always. */
  async recordMerge(args: {
    keptPersonId: string;
    mergedPersonId: string;
    confidence: number;
    method: 'deterministic' | 'heuristic' | 'recruiter_confirmed';
  }): Promise<void> {
    await this.#tx.insert(identityMerges).values({
      tenantId: this.#tenantId,
      keptPersonId: args.keptPersonId,
      mergedPersonId: args.mergedPersonId,
      confidence: args.confidence.toString(),
      method: args.method,
      actorId: this.#actor.id,
    });
  }
}

export { SCORE_MODEL_V1 };
