/** The two segments this practice recruits, and the verdict for everything else. */
export type SupportedSegment = 'senior_executive' | 'senior_it_consultant';
export type Segment = SupportedSegment | 'out_of_scope';

export const isSupportedSegment = (s: Segment): s is SupportedSegment => s !== 'out_of_scope';
/** `unstated` is a real answer: the specification did not say, so nothing was invented. */
export type EngagementType = 'permanent' | 'contract' | 'either' | 'unstated';
export type MandateStatus = 'draft' | 'awaiting_confirmation' | 'live' | 'closed' | 'out_of_scope';
export type ConfidentialityLevel = 'fully_confidential' | 'client_named_at_stage' | 'open';
export type TermKind = 'title_variant' | 'must_have_skill' | 'exclusion';
export type TermOrigin = 'extracted' | 'recruiter' | 'market_observed';
export type TermStatus = 'proposed' | 'confirmed' | 'rejected';
export type ChannelPriority = 'primary' | 'secondary' | 'skip';
export type SearchStringKind =
  | 'linkedin_recruiter_boolean'
  | 'github_xray'
  | 'conference_talks_xray'
  | 'provider_query';

export interface ChannelRatingSeed {
  readonly ordinal: number;
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly fitSeniorExecutive: number;
  readonly fitSeniorItConsultant: number;
  readonly roleInProcess: string;
  readonly howExpertsUseIt: string;
  readonly etiquette: string;
  readonly evidenceStrength: string;
  readonly keySource: string;
}

export interface MandateTerm {
  readonly kind: TermKind;
  readonly term: string;
  readonly origin: TermOrigin;
  readonly status: TermStatus;
  /**
   * How often this term actually appears in the target universe. `null` means
   * not yet checked, which is different from zero. A zero count is information
   * the recruiter needs, so a zero term is shown struck through rather than
   * silently dropped. See architecture.md s5.2.
   */
  readonly observedCount: number | null;
  readonly extractionConfidence?: number;
  readonly rank: number;
}

/**
 * The performance based intake. What must this person accomplish, what
 * operating range is required, and why would a strong person consider this a
 * career move rather than a lateral one.
 *
 * A mandate with an empty `careerMoveCase` produces a sequence that pitches a
 * lateral role, which the research identifies as a primary reason senior people
 * ignore recruiters. The engine therefore treats it as a gap to be closed with
 * the hiring leader, not an optional field.
 */
export interface PerformanceIntake {
  readonly firstYearOutcomes: string | null;
  readonly operatingRange: string | null;
  readonly careerMoveCase: string | null;
}

export interface IntakeGap {
  readonly field: keyof PerformanceIntake | 'title_variants' | 'must_have_skills' | 'target_companies' | 'location';
  readonly question: string;
}

export interface MandateDraft {
  readonly title: string;
  readonly segment: Segment;
  /** Why that segment. Required reading when the verdict is out_of_scope. */
  readonly segmentRationale: string;
  readonly functionDomain: string;
  readonly location: string | null;
  readonly engagementType: EngagementType;
  readonly intake: PerformanceIntake;
  readonly terms: readonly MandateTerm[];
  readonly targetCompanies: readonly { name: string; kind: TargetCompanyKind; rationale?: string | undefined }[];
  readonly constraints: readonly MandateConstraint[];
}

export type ConstraintKind =
  | 'security_clearance'
  | 'citizenship_or_status'
  | 'location_or_onsite'
  | 'schedule'
  | 'language'
  | 'licence_or_credential'
  | 'prior_experience'
  | 'travel'
  | 'other';

/** Only `disqualifying` removes people from the addressable market. */
export type ConstraintSeverity = 'disqualifying' | 'strong_preference' | 'nice_to_have';

/**
 * A requirement that is not a search term.
 *
 * Clearance eligibility, citizenship, a commuting radius, an on-call rotation,
 * a language. These never belong in a Boolean (forcing them into the skill list
 * corrupts it) but they decide the size of the addressable market, they decide
 * whether a sequence is worth spending on someone, and they are what the
 * receptivity score's freedom-from-deal-breakers factor is scored against.
 */
export interface MandateConstraint {
  readonly kind: ConstraintKind;
  readonly severity: ConstraintSeverity;
  readonly statement: string;
  /** The words from the specification that established it, copied verbatim. */
  readonly sourceQuote?: string | undefined;
  /**
   * True when the constraint follows from domain knowledge rather than from the
   * specification. An inferred constraint is surfaced for the recruiter to
   * confirm with the client, and never narrows the pipeline arithmetic.
   */
  readonly inferred: boolean;
}

export type TargetCompanyKind = 'competitor' | 'academy' | 'adjacent_sector' | 'client_named' | 'late_stage';

export interface ChannelSelection {
  readonly channelCode: string;
  readonly name: string;
  readonly category: string;
  readonly fit: number;
  readonly priority: ChannelPriority;
  readonly reason: string;
  readonly etiquette: string;
  readonly roleInProcess: string;
}

export interface PipelineProjection {
  readonly targetConversations: number;
  readonly longListSize: number;
  readonly responseRate: number;
  readonly interestedShare: number;
  readonly touchesPerPerson: number;
  readonly contactsRequired: number;
  readonly touchesRequired: number;
  readonly longListSufficient: boolean;
  readonly shortfall: number;
  readonly ratesSource: string;
  readonly ratesSampleSize: number | null;
  /** True when a disqualifying constraint narrows the market the rates assume. */
  readonly constrainedMarket: boolean;
  /** Shown as a working, not a number. */
  readonly workings: string;
  /** Concrete widening moves when the long list is short. */
  readonly advice: readonly string[];
}

export interface SearchString {
  readonly kind: SearchStringKind;
  readonly value: string;
}

export class MandateError extends Error {}

/**
 * Raised when a mandate falls outside the two segments this practice recruits.
 *
 * A refusal costs a minute. A confidently wrong channel plan costs a search.
 */
export class OutOfScopeError extends MandateError {
  readonly rationale: string;
  constructor(title: string, rationale: string) {
    super(
      `"${title}" is outside the two segments this practice recruits (senior executives and senior ` +
        `IT consultants), so no channel plan will be produced. ${rationale}`,
    );
    this.name = 'OutOfScopeError';
    this.rationale = rationale;
  }
}
