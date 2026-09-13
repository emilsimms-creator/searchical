export type Segment = 'senior_executive' | 'senior_it_consultant';
export type EngagementType = 'permanent' | 'contract' | 'either';
export type MandateStatus = 'draft' | 'awaiting_confirmation' | 'live' | 'closed';
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
  readonly field: keyof PerformanceIntake | 'title_variants' | 'must_have_skills' | 'target_companies';
  readonly question: string;
}

export interface MandateDraft {
  readonly title: string;
  readonly segment: Segment;
  readonly functionDomain: string;
  readonly location: string | null;
  readonly engagementType: EngagementType;
  readonly intake: PerformanceIntake;
  readonly terms: readonly MandateTerm[];
  readonly targetCompanies: readonly { name: string; kind: TargetCompanyKind; rationale?: string | undefined }[];
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
