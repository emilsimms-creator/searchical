export type SignalCategory =
  | 'linkedin_platform' | 'linkedin_behaviour' | 'career_stage' | 'employer_trigger'
  | 'compensation_cycle' | 'personal' | 'personal_brand' | 'engagement_data' | 'relationship';

export type SignalStrength = 'low' | 'medium' | 'medium_high' | 'high';
export type SubjectType = 'person' | 'organization';

export interface SignalTypeSeed {
  readonly ordinal: number;
  readonly code: string;
  readonly label: string;
  readonly category: SignalCategory;
  /** Which clock this signal runs on. See architecture.md s6.1. */
  readonly subjectType: SubjectType;
  readonly strength: SignalStrength;
  readonly points: number;
  readonly recencyWindowDays: number;
  readonly indicates: string;
  readonly sourceCitation: string;
  readonly windowNote?: string;
}

/** Where the recruiter has moved the person, in Vlastelica's terms. */
export type InterestScale = 'no' | 'maybe' | 'yes';

export type Tier = 'hot' | 'warm' | 'cool';

export type Disposition = 'candidate' | 'prospect' | 'source' | 'opted_out';

export type FactorId = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8';

export interface FactorDefinition {
  readonly id: FactorId;
  readonly ordinal: number;
  readonly label: string;
  /** Percentage points. The eight must total 100. */
  readonly weight: number;
  readonly zeroLooksLike: string;
  readonly fiveLooksLike: string;
  readonly evidenceBasis: string;
  /** True when the system derives it rather than the recruiter scoring it. */
  readonly derived: boolean;
}

export interface TierRule {
  readonly tier: Tier;
  /** Inclusive lower bound on the decayed score. */
  readonly minimumScore: number;
  /** Days between touches at this tier. */
  readonly cadenceDays: number;
  readonly basis: string;
}

/**
 * The scoring model as versioned configuration.
 *
 * Weights, decay, tiers and cadence are data, not constants in code. Changing
 * any of them creates a NEW version; historical scores keep the version that
 * produced them and are never rewritten. That is what makes a practitioner
 * heuristic into something that can be backtested rather than merely believed.
 * See architecture.md s6.4 and principle 7.
 */
export interface ScoreModel {
  readonly version: string;
  readonly factors: readonly FactorDefinition[];
  readonly maxFactorScore: number;
  /** Share of the raw score lost per decay period without a meaningful touch. */
  readonly decayPerPeriod: number;
  readonly decayPeriodDays: number;
  /** Floor, as a share of raw, below which decay cannot push a score. */
  readonly decayFloor: number;
  readonly tiers: readonly TierRule[];
  readonly interestScale: Readonly<Record<InterestScale, number>>;
  /** Days before a due date at which a touch is flagged as due. */
  readonly dueWarningDays: number;
  /** Signals must stack before outreach. See architecture.md s6.2. */
  readonly stacking: {
    readonly minimumSignals: number;
    readonly minimumEmployerTriggers: number;
    readonly windowDays: number;
  };
  readonly notes: string;
}

export interface ScoredSignal {
  readonly code: string;
  readonly label: string;
  readonly category: SignalCategory;
  readonly subjectType: SubjectType;
  readonly points: number;
  readonly observedAt: Date;
  readonly expiresAt: Date;
  /** False when the signal has aged out of its own window. */
  readonly live: boolean;
  /** True when it reached this person by fan out from their employer. */
  readonly viaEmployer: boolean;
}

export interface StackingVerdict {
  readonly eligible: boolean;
  readonly liveSignals: number;
  readonly employerTriggers: number;
  readonly statement: string;
}

export interface FactorScore {
  readonly id: FactorId;
  readonly label: string;
  readonly weight: number;
  /** 0 to maxFactorScore. */
  readonly value: number;
  readonly derived: boolean;
  readonly contribution: number;
  readonly note: string;
}

/**
 * Everything needed to answer "why this person, why now" without re-deriving
 * anything. Stored with the score, so an explanation is a read rather than a
 * recomputation against a model that may since have changed.
 */
export interface ScoreExplanation {
  readonly modelVersion: string;
  readonly computedAt: string;
  readonly factors: readonly FactorScore[];
  readonly signals: readonly {
    code: string; label: string; points: number; live: boolean; viaEmployer: boolean; observedAt: string;
  }[];
  readonly stacking: StackingVerdict;
  readonly rawScore: number;
  readonly daysSinceTouch: number | null;
  readonly decayApplied: number;
  readonly decayedScore: number;
  readonly tier: Tier;
  readonly nextTouchDueAt: string | null;
  /** One line a recruiter can read aloud. */
  readonly headline: string;
}

export interface ScoreResult {
  readonly rawScore: number;
  readonly decayedScore: number;
  readonly tier: Tier;
  readonly nextTouchDueAt: Date | null;
  readonly explanation: ScoreExplanation;
}

export class ReceptivityError extends Error {}
