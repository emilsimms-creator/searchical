import type { ConstraintKind, ConstraintSeverity, MandateConstraint, MandateTerm } from '@/mandate/types';

/**
 * How much we actually have on this person.
 *
 * This is the single most important field in the screening layer. A search
 * snippet is forty words a search engine chose; a profile page is what the
 * person wrote about themselves; a conversation is what they told you when
 * asked directly. Treating those three as interchangeable is how a sourcing
 * tool produces confident nonsense, and it is what "evaluates every profile
 * against your criteria" quietly does when the evaluation runs on a snippet.
 */
export type EvidenceDepth = 'snippet' | 'profile' | 'conversation';

export interface ScreeningEvidence {
  /** Everything readable about this person from this source. */
  readonly text: string;
  /** A place the person or the page stated. Never inferred from anything else. */
  readonly statedLocation?: string | null;
  readonly sourceId: string;
  readonly depth: EvidenceDepth;
}

/** Whether a kind of requirement can be judged from this kind of evidence. */
export type Checkability =
  /** Judgeable, and a negative finding is worth acting on. */
  | 'reliable'
  /** A hint at best. Informs the conversation, never a rejection. */
  | 'weak'
  /** Cannot be judged from this evidence. Becomes a question. */
  | 'never'
  /**
   * Must not be judged from this evidence even if it looks possible, because
   * the only available method is to infer a protected ground.
   */
  | 'prohibited';

export type ScreenVerdict =
  /** Positive signal, nothing contradicting. Worth a human's time. */
  | 'advance'
  /** Nothing either way. The evidence is too thin to say, which is not a fault. */
  | 'hold'
  /** Something the mandate excludes is positively established here. */
  | 'reject';

export interface Finding {
  readonly statement: string;
  /** The text that established it, so a recruiter can check rather than trust. */
  readonly matched: string | null;
  readonly severity: ConstraintSeverity | 'exclusion' | 'positive';
}

/** A non-negotiable that this evidence could not settle, phrased for the call. */
export interface OpenQuestion {
  readonly kind: ConstraintKind;
  readonly severity: ConstraintSeverity;
  readonly question: string;
  readonly why: string;
}

export interface ScreenResult {
  readonly verdict: ScreenVerdict;
  readonly depth: EvidenceDepth;
  /** What argued for this person. */
  readonly matches: readonly Finding[];
  /** What argued against. */
  readonly concerns: readonly Finding[];
  /**
   * The non-negotiables this evidence could not settle.
   *
   * Never empty for a real mandate screened from a snippet, and that is the
   * honest state rather than a gap. A screen that reports no open questions on
   * a clearance requirement has not checked it; it has forgotten it.
   */
  readonly openQuestions: readonly OpenQuestion[];
  /** One sentence a recruiter can act on. */
  readonly headline: string;
  /** True when a protected ground was in scope and deliberately not screened. */
  readonly prohibitedChecksSkipped: readonly ConstraintKind[];
}

export interface ScreenInput {
  readonly evidence: ScreeningEvidence;
  readonly terms: readonly MandateTerm[];
  readonly constraints: readonly MandateConstraint[];
}

export class ScreeningError extends Error {}
