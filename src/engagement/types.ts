export type OutreachChannel =
  | 'linkedin_connection' | 'linkedin_inmail' | 'email' | 'phone' | 'voicemail' | 'referral';

// One definition of the segment concept, owned by the mandate module. The
// engagement engine only ever sees the two supported segments: an out of scope
// mandate never reaches a sequence.
export type { SupportedSegment } from '@/mandate/types';

export interface MessageTemplate {
  readonly ordinal: number;
  readonly code: string;
  readonly name: string;
  readonly channel: OutreachChannel;
  /** Where this template sits in the default sequence. Null means it is situational. */
  readonly defaultTouch: number | null;
  readonly segments: readonly ('senior_executive' | 'senior_it_consultant')[];
  /**
   * Whether this template may only be queued with verified, person specific
   * evidence behind it. False for the close and the referral ask, which respond
   * to a relationship that already exists.
   */
  readonly requiresPersonalEvidence: boolean;
  /** Bracketed fields that must be filled from evidence rather than the mandate. */
  readonly hookTokens: readonly string[];
  readonly body: string;
  readonly appliesPrinciples: string;
  readonly maxChars?: number;
  readonly maxWords?: number;
  readonly maxSeconds?: number;
  /** Touch three goes out in the hiring leader's voice, not the recruiter's. */
  readonly sendAs?: 'hiring_leader';
}

export interface SequenceStepPlan {
  readonly touch: number;
  readonly earliestDay: number;
  readonly latestDay: number;
  readonly templateCode: string;
  readonly channel: OutreachChannel;
  readonly purpose: string;
  readonly evidence: string;
  /** True for the optional sixth touch, which needs a stated reason. */
  readonly optional: boolean;
}

export type MessageState = 'drafted' | 'blocked' | 'awaiting_approval' | 'approved' | 'rejected' | 'cancelled' | 'relayed';

export type ApprovalDecision = 'approved' | 'edited' | 'rejected';

/** The eight rungs of the response ladder, Playbook section 3.6. */
export type ReplyRung =
  | 'explicit_not_interested' | 'silence_after_sequence' | 'polite_decline_but_engaged'
  | 'keep_me_in_mind' | 'question_about_scope' | 'question_about_compensation'
  | 'agreed_to_conversation' | 'referred_a_colleague';

export interface PersonalisationHook {
  /** The bracketed field this fills. */
  readonly token: string;
  readonly value: string;
  /** The evidence row that justifies it. Not optional: that is the gate. */
  readonly evidenceId: string;
  /** Human checkable: the talk, repository, byline or programme. */
  readonly citation: string;
}

export interface PersonalisationVerdict {
  readonly permitted: boolean;
  readonly hooks: readonly PersonalisationHook[];
  readonly missingTokens: readonly string[];
  readonly statement: string;
}

export interface ApprovalMetrics {
  readonly decided: number;
  readonly approvedUnchanged: number;
  readonly edited: number;
  readonly rejected: number;
  /** Share of decided drafts the recruiter changed before sending. */
  readonly editRate: number;
  readonly rejectRate: number;
  readonly statement: string;
}

/** One row of the approval queue: enough to triage without opening the draft. */
export interface QueueItem {
  readonly messageId: string;
  readonly prospectId: string;
  readonly personName: string;
  readonly mandateId: string;
  readonly mandateTitle: string;
  readonly touch: number;
  readonly templateCode: string;
  readonly channel: string;
  readonly scheduledFor: string;
  readonly body: string;
  readonly hookCount: number;
  readonly queuedAt: Date;
}

/**
 * Everything an approver needs to decide, in one payload.
 *
 * The whole argument for a human in this loop is that they see what the draft
 * rests on. A screen that shows the message and hides the evidence turns the
 * approver into a rubber stamp, which is the failure mode the edit rate is
 * there to detect and this payload is there to prevent.
 */
export interface MessageDetail extends QueueItem {
  readonly subject: string | null;
  readonly templatePurpose: string;
  readonly templateEvidence: string;
  readonly hooks: readonly {
    readonly token: string;
    readonly value: string;
    readonly citation: string;
    readonly evidenceLive: boolean;
    readonly collectedAt: Date;
  }[];
  readonly sequenceTouches: number;
  readonly priorDecisions: readonly {
    readonly touch: number;
    readonly decision: string;
    readonly decidedAt: Date;
  }[];
}

export class EngagementError extends Error {}

export class PersonalisationGateError extends EngagementError {
  readonly verdict: PersonalisationVerdict;
  constructor(verdict: PersonalisationVerdict) {
    super(verdict.statement);
    this.name = 'PersonalisationGateError';
    this.verdict = verdict;
  }
}
