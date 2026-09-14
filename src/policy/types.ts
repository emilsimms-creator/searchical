import type { Connector } from '@/connectors/contract';
import type { CollectionMethodCode, ConsentBasisCode } from '@/ledger/types';

export type Gate = 'collection' | 'enrichment' | 'send';

export type Channel =
  | 'email'
  | 'linkedin_inmail'
  | 'linkedin_connection'
  | 'phone'
  | 'voicemail'
  | 'community'
  | 'referral';

export interface ConsentRecord {
  readonly basis: ConsentBasisCode;
  readonly capturedAt: Date;
  readonly expiresAt: Date | null;
}

/** Everything the engine needs to look up, kept behind an interface so rules stay pure. */
export interface PolicyLookups {
  isSuppressed(subjectHash: string): Promise<boolean>;
  consentFor(personId: string): Promise<readonly ConsentRecord[]>;
}

export interface PolicyContext {
  readonly gate: Gate;
  readonly jurisdiction: string;
  readonly now: Date;
  readonly connector?: Connector;
  readonly collectionMethod?: CollectionMethodCode;
  readonly attributeIsSensitive?: boolean;
  readonly writingToSensitiveTable?: boolean;
  readonly personId?: string;
  readonly subjectHash?: string;
  readonly channel?: Channel;
  readonly message?: {
    readonly identifiesSender: boolean;
    readonly hasMailingAddress: boolean;
    readonly hasUnsubscribe: boolean;
    /** A verified, person specific hook with a live citation. See architecture.md s7.2. */
    readonly personalisationEvidenceIds: readonly string[];
    /** The body, so the gate can see whether it quotes money. */
    readonly body?: string;
  };
  /**
   * Whether the mandate's compensation band has been confirmed by the hiring
   * leader. Undefined means not supplied, and the money rule then abstains
   * rather than guessing.
   */
  readonly compensationBandConfirmed?: boolean;
}

export interface PolicyReason {
  readonly rule: string;
  readonly allowed: boolean;
  /** Written to be shown to a recruiter, not only logged. */
  readonly statement: string;
  /** What the rule rests on, so a block can be argued with on the merits. */
  readonly basis: string;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly gate: Gate;
  readonly reasons: readonly PolicyReason[];
}

export interface PolicyRule {
  readonly id: string;
  readonly gate: Gate;
  appliesTo(ctx: PolicyContext): boolean;
  evaluate(ctx: PolicyContext, lookups: PolicyLookups): Promise<PolicyReason> | PolicyReason;
}

export class PolicyViolation extends Error {
  readonly decision: PolicyDecision;
  constructor(decision: PolicyDecision) {
    const blocked = decision.reasons.filter((r) => !r.allowed).map((r) => r.statement);
    super(`policy blocked at the ${decision.gate} gate: ${blocked.join('; ')}`);
    this.name = 'PolicyViolation';
    this.decision = decision;
  }
}
