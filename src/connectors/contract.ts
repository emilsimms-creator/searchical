/**
 * The connector capability contract.
 *
 * Principle 6: every connector declares its constraints in code. A limit that
 * is legal or contractual becomes a property the type system enforces, not a
 * note in a wiki that nobody reads.
 *
 * The load bearing decision here is that `persistence` is the discriminant of a
 * union rather than a field on one shared interface. A connector whose output
 * may not be persisted does not have a `fetch` method at all, so piping it into
 * the ledger is a compile error rather than a code review catch.
 *
 * See architecture.md s10.1 and decision record entry 1.
 */

export type EntityType = 'person' | 'organization' | 'employment' | 'signal' | 'contact';

/** ISO 3166-1 alpha-2, or 'EU' / 'GLOBAL' for regimes rather than countries. */
export type Jurisdiction = string;

export type LawfulBasisCode =
  | 'legitimate_interest'
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'publicly_available_exemption';

export interface RateLimitPolicy {
  /** Requests permitted per window. */
  readonly requests: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Conservative default for sources that publish no limit. */
  readonly note?: string;
}

export interface CoverageEntry {
  readonly region: string;
  /** 0 to 1. Drives the coverage confidence shown on every market map. */
  readonly confidence: number;
  readonly note?: string;
}

/**
 * Coverage is uneven and the system must say so rather than present a thin
 * result as a complete market map. See architecture.md s10.7.
 */
export type CoverageProfile = readonly CoverageEntry[];

export interface ConnectorBase {
  readonly id: string;
  readonly displayName: string;
  readonly yields: readonly EntityType[];
  readonly lawfulBasis: LawfulBasisCode;
  readonly jurisdictions: readonly Jurisdiction[];
  readonly rateLimit: RateLimitPolicy;
  /** How long output from this source stays trustworthy, in milliseconds. */
  readonly freshnessMs: number;
  /** Default confidence for facts from this source, 0 to 1. */
  readonly baseConfidence: number;
  /** The contract, licence or policy relied on. Recorded on every source row. */
  readonly termsRef: string;
  readonly coverage: CoverageProfile;
  /**
   * Constraints a human must observe when using this surface, surfaced at the
   * point of use rather than buried in documentation. See architecture.md s9.4.
   */
  readonly etiquette?: readonly string[];
}

export interface IngestibleRecord {
  readonly entity: EntityType;
  readonly payload: Readonly<Record<string, string>>;
  readonly citation?: string;
  readonly observedAt: Date;
}

export interface FetchQuery {
  readonly terms: readonly string[];
  readonly regions?: readonly string[];
  readonly limit?: number;
}

/** Output may be written to the ledger. */
export interface PersistingConnector extends ConnectorBase {
  readonly persistence: 'persist';
  fetch(query: FetchQuery): Promise<readonly IngestibleRecord[]>;
}

/** Output may be shown to a recruiter but never stored. */
export interface EphemeralConnector extends ConnectorBase {
  readonly persistence: 'ephemeral';
  view(query: FetchQuery): Promise<readonly IngestibleRecord[]>;
}

/**
 * Output may reach the ledger only by a human typing it in.
 *
 * This is the LinkedIn case. There is no member search API at any tier,
 * scraping is prohibited by a user agreement that has been held enforceable in
 * contract, and LinkedIn litigates. The connector exists so the seat can be
 * registered as a source, cited as provenance and carry its etiquette. It has
 * no method that returns records, by design.
 */
export interface ManualEntryConnector extends ConnectorBase {
  readonly persistence: 'manual_entry_only';
  /** Shown to the recruiter working the surface by hand. */
  readonly seatInstructions: string;
}

export type Connector = PersistingConnector | EphemeralConnector | ManualEntryConnector;

export class ConnectorPersistenceError extends Error {
  constructor(connectorId: string, persistence: Connector['persistence']) {
    super(
      `connector "${connectorId}" declares persistence "${persistence}" and may not be ingested. ` +
        `Its output reaches the ledger only through a human. See architecture.md s10.1.`,
    );
    this.name = 'ConnectorPersistenceError';
  }
}

/**
 * Runtime guard for the case where a connector arrives from a registry lookup
 * typed as the union. The compile time guarantee is the primary control; this
 * is the belt to its braces.
 */
export function assertPersistable(c: Connector): asserts c is PersistingConnector {
  if (c.persistence !== 'persist') {
    throw new ConnectorPersistenceError(c.id, c.persistence);
  }
}

export function isManualEntryOnly(c: Connector): c is ManualEntryConnector {
  return c.persistence === 'manual_entry_only';
}
