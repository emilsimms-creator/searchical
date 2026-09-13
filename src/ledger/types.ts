import type { LawfulBasisCode } from '@/connectors/contract';

export type CollectionMethodCode =
  | 'provider_licensed'
  | 'public_evidence'
  | 'recruiter_entered'
  | 'candidate_provided'
  | 'inferred';

export type ConsentBasisCode =
  | 'express'
  | 'implied_conspicuous_publication'
  | 'implied_existing_business_relationship'
  | 'implied_inquiry'
  | 'implied_non_business_relationship';

export interface Provenance {
  readonly sourceId: string;
  readonly collectionMethod: CollectionMethodCode;
  readonly collectedAt: Date;
  readonly lawfulBasis: LawfulBasisCode;
  readonly jurisdiction: string;
  /** 0 to 1. */
  readonly confidence: number;
  readonly expiresAt?: Date;
  readonly rawRef?: string;
  /** Human readable and checkable: the talk, byline, repository or filing. */
  readonly citation?: string;
}

export interface Actor {
  readonly type: 'user' | 'system' | 'connector';
  readonly id: string;
}

/**
 * The three conditions that must hold together for implied consent through
 * conspicuous publication under Canada's anti spam legislation. The burden of
 * proving consent sits with the sender, so all three are recorded individually
 * with the source that satisfied them. See architecture.md s9.1.
 */
export interface ConspicuousPublication {
  readonly publishedBySubject: boolean;
  readonly noRefusalNotice: boolean;
  readonly relevantToRole: boolean;
  readonly sourceUrl: string;
}

export class LedgerError extends Error {}
