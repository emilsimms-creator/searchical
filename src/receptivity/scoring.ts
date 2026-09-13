import {
  ReceptivityError, type FactorScore, type InterestScale, type ScoreExplanation, type ScoreModel,
  type ScoreResult, type ScoredSignal, type StackingVerdict, type Tier,
} from './types';

const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Which signals still count, and whether they stack.
 *
 * A single signal is noise: LinkedIn members make billions of profile updates a
 * month, so one edited headline is grooming rather than intent. The rule is two
 * or more independent signals inside the window with at least one employer
 * level trigger, because combining an employer event with an individual
 * behaviour produces the highest confidence shortlist. See architecture.md s6.2.
 */
export function evaluateStacking(
  signals: readonly ScoredSignal[],
  model: ScoreModel,
  asOf: Date,
): StackingVerdict {
  const windowStart = new Date(asOf.getTime() - model.stacking.windowDays * DAY_MS);
  const inWindow = signals.filter((s) => s.live && s.observedAt >= windowStart);
  const triggers = inWindow.filter((s) => s.category === 'employer_trigger');
  const { minimumSignals, minimumEmployerTriggers, windowDays } = model.stacking;

  const eligible = inWindow.length >= minimumSignals && triggers.length >= minimumEmployerTriggers;

  return {
    eligible,
    liveSignals: inWindow.length,
    employerTriggers: triggers.length,
    statement: eligible
      ? `${inWindow.length} independent signals in the last ${windowDays} days, ` +
        `${triggers.length} of them employer level. Eligible for active outreach.`
      : `${inWindow.length} signal${inWindow.length === 1 ? '' : 's'} in the last ${windowDays} days, ` +
        `${triggers.length} employer level. Needs ${minimumSignals} with at least ` +
        `${minimumEmployerTriggers} employer trigger, so this stays a watch rather than an approach.`,
  };
}

/**
 * Factor one, derived from the signal ledger rather than scored by hand.
 *
 * The workbook's own arithmetic: sum the points of every observed live signal,
 * divide by the points needed per score level, round, and cap at the top of the
 * scale.
 */
export function deriveSignalFactor(
  signals: readonly ScoredSignal[],
  model: ScoreModel,
  pointsPerLevel = 3,
): number {
  const points = signals.filter((s) => s.live).reduce((sum, s) => sum + s.points, 0);
  return Math.min(model.maxFactorScore, Math.round(points / pointsPerLevel));
}

export interface ScoreInput {
  readonly signals: readonly ScoredSignal[];
  /** Recorded from the exploratory call. Absent before first contact. */
  readonly interestScale?: InterestScale;
  /** Factors three to eight, scored by the recruiter from the call. */
  readonly recruiterFactors?: Partial<Record<'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8', number>>;
  readonly lastMeaningfulTouchAt?: Date;
  readonly asOf: Date;
  readonly model: ScoreModel;
}

/**
 * Score a prospect.
 *
 * Pure: the same inputs under the same model version always produce the same
 * output, which is what makes a score replayable and a model change
 * backtestable. Nothing here reads the clock or the database.
 */
export function scoreProspect(input: ScoreInput): ScoreResult {
  const { model, asOf } = input;
  const max = model.maxFactorScore;

  const stacking = evaluateStacking(input.signals, model, asOf);
  const f1 = deriveSignalFactor(input.signals, model);
  const f2 = input.interestScale === undefined ? 0 : model.interestScale[input.interestScale];

  const factors: FactorScore[] = model.factors.map((definition) => {
    let value: number;
    let note: string;

    if (definition.id === 'f1') {
      value = f1;
      note = `Derived from ${input.signals.filter((s) => s.live).length} live signals.`;
    } else if (definition.id === 'f2') {
      value = f2;
      note = input.interestScale === undefined
        ? 'No exploratory call yet, so no position on the interest scale.'
        : `Interest scale: ${input.interestScale}.`;
    } else {
      const provided = input.recruiterFactors?.[definition.id as 'f3'];
      value = provided ?? 0;
      note = provided === undefined
        ? 'Not yet scored: this factor comes from the exploratory call.'
        : 'Scored from the exploratory call.';
    }

    if (value < 0 || value > max) {
      throw new ReceptivityError(`factor ${definition.id} scored ${value}, outside 0 to ${max}`);
    }

    return {
      id: definition.id,
      label: definition.label,
      weight: definition.weight,
      value,
      derived: definition.derived,
      contribution: round1((value * definition.weight) / max),
      note,
    };
  });

  const rawScore = round1(factors.reduce((sum, f) => sum + f.contribution, 0));

  // Decay. A strong candidate never disappears from view, but an untouched one
  // sinks in priority. Pin (2026).
  const daysSinceTouch = input.lastMeaningfulTouchAt
    ? Math.max(0, daysBetween(input.lastMeaningfulTouchAt, asOf))
    : null;
  const retention = daysSinceTouch === null
    ? 1
    : Math.min(1, Math.max(model.decayFloor, 1 - (model.decayPerPeriod * daysSinceTouch) / model.decayPeriodDays));
  const decayedScore = round1(rawScore * retention);

  const tierRule = model.tiers.find((t) => decayedScore >= t.minimumScore);
  if (!tierRule) {
    throw new ReceptivityError(`score ${decayedScore} fell through every tier in model ${model.version}`);
  }
  const tier: Tier = tierRule.tier;

  const nextTouchDueAt = input.lastMeaningfulTouchAt
    ? new Date(input.lastMeaningfulTouchAt.getTime() + tierRule.cadenceDays * DAY_MS)
    : null;

  const explanation: ScoreExplanation = {
    modelVersion: model.version,
    computedAt: asOf.toISOString(),
    factors,
    signals: input.signals.map((s) => ({
      code: s.code, label: s.label, points: s.points, live: s.live,
      viaEmployer: s.viaEmployer, observedAt: s.observedAt.toISOString(),
    })),
    stacking,
    rawScore,
    daysSinceTouch: daysSinceTouch === null ? null : Math.round(daysSinceTouch),
    decayApplied: round1((1 - retention) * 100),
    decayedScore,
    tier,
    nextTouchDueAt: nextTouchDueAt?.toISOString() ?? null,
    headline: headlineFor({ factors, stacking, tier, decayedScore, rawScore, retention, signals: input.signals }),
  };

  return { rawScore, decayedScore, tier, nextTouchDueAt, explanation };
}

/**
 * One line a recruiter can read aloud, naming the largest contributor and the
 * most recent employer trigger. This is also the raw material for the opening
 * line of an approach, which is why it names the evidence and not the number.
 */
function headlineFor(args: {
  factors: readonly FactorScore[];
  stacking: StackingVerdict;
  tier: Tier;
  decayedScore: number;
  rawScore: number;
  retention: number;
  signals: readonly ScoredSignal[];
}): string {
  const top = [...args.factors].sort((a, b) => b.contribution - a.contribution)[0];
  const trigger = args.signals
    .filter((s) => s.live && s.category === 'employer_trigger')
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];

  const parts = [`${args.tier.toUpperCase()} at ${args.decayedScore} of 100`];
  if (args.retention < 1) parts.push(`decayed from ${args.rawScore}`);
  if (top && top.contribution > 0) parts.push(`driven by ${top.label.toLowerCase()}`);
  if (trigger) parts.push(`most recent employer trigger: ${trigger.label.toLowerCase()}`);
  if (!args.stacking.eligible) parts.push('not yet eligible for outreach');

  return `${parts.join('; ')}.`;
}
