import type { SupportedSegment } from '@/mandate/types';

/**
 * How a surface is reached.
 *
 * `search_xray` means a public search engine is asked for pages on that site.
 * `directory` means the surface publishes a list or an API intended to be read.
 * `licensed` means a contracted provider whose terms we hold in writing.
 */
export type DiscoveryAccess = 'search_xray' | 'directory' | 'licensed';

/**
 * What may be done with what comes back, reusing the connector contract's
 * vocabulary deliberately so the two cannot drift apart.
 *
 * `manual_entry_only` is the important one: the surface may be searched and a
 * human may read the result, and nothing reaches the ledger except what that
 * human types. LinkedIn sits here, and so does anything whose terms prohibit
 * collection but not reading.
 */
export type DiscoveryPersistence = 'persist' | 'manual_entry_only';

/**
 * Whether anyone has actually read this surface's terms.
 *
 * A source whose terms are unverified cannot be enabled for persistence. This
 * is the same shape as every other gate in this system: the default is the
 * cautious one and a human has to move it, with a date and a citation against
 * their name. Vendor claims and received wisdom about "public data" are exactly
 * how a practice ends up on the wrong side of a terms dispute it never read.
 */
export interface TermsPosition {
  /** What the terms actually say about this use, in plain words. */
  readonly summary: string;
  /** The specific document, so a lawyer can go and read it. */
  readonly citation: string;
  /** True only where the cited document has been read and quoted. */
  readonly verified: boolean;
  /** ISO date of that reading, so a stale verification is visible. */
  readonly verifiedOn: string | null;
  /** What still has to be established before this source is switched on. */
  readonly openQuestion: string | null;
}

export interface DiscoverySource {
  readonly id: string;
  readonly name: string;
  readonly access: DiscoveryAccess;
  readonly persistence: DiscoveryPersistence;
  /** The host a search_xray source is restricted to. Null for the others. */
  readonly site: string | null;
  /** What this surface actually tells you about a person. */
  readonly yields: readonly ('identity' | 'employer' | 'skill_evidence' | 'contact' | 'trigger')[];
  /**
   * Why a senior person appears here at all. This is the difference between a
   * surface that finds candidates and one that finds noise: a conference
   * speaker list is a pre-vetted shortlist, a general web search is not.
   */
  readonly whySeniorPeopleAreHere: string;
  readonly segments: readonly SupportedSegment[];
  /** Rough regional coverage, worst case first, so reach is never overstated. */
  readonly regions: readonly string[];
  readonly terms: TermsPosition;
  /** How a recruiter should behave here, surfaced at the point of use. */
  readonly etiquette: string;
}

/** One result from a web search provider, before any interpretation. */
export interface SearchHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  /**
   * The provider's own position for this result, one based.
   *
   * Deliberately NOT renumbered after unusable entries are dropped. The field
   * exists so the provider's relevance judgment can be audited later, and
   * renumbering would quietly rewrite it. A gap in the ranks means the payload
   * contained something unusable at that position, which is itself worth seeing.
   */
  readonly rank: number;
}

export interface SearchRequest {
  readonly query: string;
  readonly limit?: number;
  /** Two letter country code, where the provider supports narrowing. */
  readonly region?: string;
}

/**
 * A web search provider.
 *
 * Kept behind an interface for the same reason the language model is: the
 * choice of vendor is a commercial decision that should not reach into the
 * code, and a fixture backed implementation lets the whole discovery layer be
 * tested without a key, a network or a bill.
 */
export interface WebSearchProvider {
  readonly id: string;
  readonly displayName: string;
  search(request: SearchRequest): Promise<readonly SearchHit[]>;
}

/** A query aimed at one source, with the reason it was formed that way. */
export interface DiscoveryQuery {
  readonly sourceId: string;
  readonly query: string;
  readonly rationale: string;
}

export class DiscoveryError extends Error {}
