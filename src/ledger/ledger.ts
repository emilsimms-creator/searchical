import { sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import {
  assertPersistable,
  type Connector,
  type IngestibleRecord,
  type ManualEntryConnector,
  type PersistingConnector,
} from '@/connectors/contract';
import { LedgerError, type Actor, type ConspicuousPublication, type ConsentBasisCode, type Provenance } from './types';

type Row = Record<string, unknown>;
const first = (res: unknown): Row => {
  const rows = (res as { rows?: Row[] }).rows ?? [];
  const row = rows[0];
  if (!row) throw new LedgerError('expected one row from ledger function');
  return row;
};
const id = (res: unknown, key: string): string => String(first(res)[key]);

/**
 * The evidence ledger: the only write path for anything factual.
 *
 * This is not merely a convention enforced by code review. The application role
 * holds no INSERT on `evidence`, `attributes`, `sensitive_attributes`,
 * `signals`, `employments`, `consents` or `audit_log`. Those tables are written
 * exclusively by the SECURITY DEFINER functions in migrations/0002_security.sql,
 * which this class calls. A direct insert from anywhere else fails with
 * permission denied at the database, proven by tests/ledger.test.ts.
 *
 * Principle 1: provenance or it does not exist.
 */
export class Ledger {
  readonly #tx: TenantTx;
  readonly #actor: Actor;

  constructor(tx: TenantTx, actor: Actor) {
    this.#tx = tx;
    this.#actor = actor;
  }

  /** Register a connector as a source of facts. Idempotent per tenant. */
  async registerSource(connector: Connector): Promise<string> {
    const res = await this.#tx.execute(sql`
      INSERT INTO sources (tenant_id, connector_id, display_name, terms_ref)
      VALUES (current_tenant(), ${connector.id}, ${connector.displayName}, ${connector.termsRef})
      ON CONFLICT (tenant_id, connector_id)
        DO UPDATE SET display_name = EXCLUDED.display_name, terms_ref = EXCLUDED.terms_ref
      RETURNING id
    `);
    return id(res, 'id');
  }

  async recordEvidence(p: Provenance): Promise<string> {
    if (p.confidence < 0 || p.confidence > 1) {
      throw new LedgerError(`confidence must be between 0 and 1, received ${p.confidence}`);
    }
    const res = await this.#tx.execute(sql`
      SELECT ledger_record_evidence(
        ${p.sourceId}::uuid,
        ${p.collectionMethod}::collection_method,
        ${p.collectedAt.toISOString()}::timestamptz,
        ${p.lawfulBasis}::lawful_basis,
        ${p.jurisdiction},
        ${p.confidence}::numeric,
        ${p.expiresAt?.toISOString() ?? null}::timestamptz,
        ${p.rawRef ?? null},
        ${p.citation ?? null}
      ) AS id
    `);
    return id(res, 'id');
  }

  async recordAttribute(args: {
    personId: string;
    key: string;
    value: string;
    evidenceId: string;
    sensitive?: boolean;
  }): Promise<string> {
    const res = await this.#tx.execute(sql`
      SELECT ledger_record_attribute(
        ${args.personId}::uuid, ${args.key}, ${args.value},
        ${args.evidenceId}::uuid, ${args.sensitive ?? false}
      ) AS id
    `);
    return id(res, 'id');
  }

  /**
   * Expiry is not a parameter. It is derived inside the database from the
   * signal type's recency window, so "stale signals expire" cannot be bypassed
   * by a caller. See architecture.md s6.2.
   */
  async recordSignal(args: {
    subjectType: 'person' | 'organization';
    subjectId: string;
    signalTypeId: string;
    observedAt: Date;
    evidenceId: string;
  }): Promise<string> {
    const res = await this.#tx.execute(sql`
      SELECT ledger_record_signal(
        ${args.subjectType}::subject_type, ${args.subjectId}::uuid, ${args.signalTypeId}::uuid,
        ${args.observedAt.toISOString()}::timestamptz, ${args.evidenceId}::uuid
      ) AS id
    `);
    return id(res, 'id');
  }

  async recordEmployment(args: {
    personId: string;
    organizationId: string;
    title: string;
    evidenceId: string;
    startedOn?: string;
    endedOn?: string;
  }): Promise<string> {
    const res = await this.#tx.execute(sql`
      SELECT ledger_record_employment(
        ${args.personId}::uuid, ${args.organizationId}::uuid, ${args.title},
        ${args.evidenceId}::uuid, ${args.startedOn ?? null}::date, ${args.endedOn ?? null}::date
      ) AS id
    `);
    return id(res, 'id');
  }

  async recordConsent(args: {
    personId: string;
    basis: ConsentBasisCode;
    capturedAt: Date;
    evidenceId: string;
    expiresAt?: Date;
    conspicuousPublication?: ConspicuousPublication;
  }): Promise<string> {
    const cp = args.conspicuousPublication;
    if (args.basis === 'implied_conspicuous_publication' && !cp) {
      throw new LedgerError(
        'implied consent through conspicuous publication requires all three conditions and the source URL',
      );
    }
    const res = await this.#tx.execute(sql`
      SELECT ledger_record_consent(
        ${args.personId}::uuid, ${args.basis}::consent_basis,
        ${args.capturedAt.toISOString()}::timestamptz, ${args.evidenceId}::uuid,
        ${args.expiresAt?.toISOString() ?? null}::timestamptz,
        ${cp?.publishedBySubject ?? null}, ${cp?.noRefusalNotice ?? null},
        ${cp?.relevantToRole ?? null}, ${cp?.sourceUrl ?? null}
      ) AS id
    `);
    return id(res, 'id');
  }

  /**
   * Ingest records from a connector whose output may be persisted.
   *
   * The parameter type is `PersistingConnector`, not `Connector`. Passing the
   * LinkedIn seat connector here does not compile, which is the primary control;
   * `assertPersistable` covers the case where the value arrived from a registry
   * lookup typed as the union.
   */
  async ingest(
    connector: PersistingConnector,
    records: readonly IngestibleRecord[],
    opts: { jurisdiction: string; personIdFor: (r: IngestibleRecord) => string | undefined },
  ): Promise<{ evidenceIds: string[]; attributeIds: string[] }> {
    assertPersistable(connector);

    const sourceId = await this.registerSource(connector);
    const evidenceIds: string[] = [];
    const attributeIds: string[] = [];

    for (const record of records) {
      const evidenceId = await this.recordEvidence({
        sourceId,
        collectionMethod:
          connector.lawfulBasis === 'publicly_available_exemption' ? 'public_evidence' : 'provider_licensed',
        collectedAt: record.observedAt,
        lawfulBasis: connector.lawfulBasis,
        jurisdiction: opts.jurisdiction,
        confidence: connector.baseConfidence,
        expiresAt: new Date(record.observedAt.getTime() + connector.freshnessMs),
        ...(record.citation !== undefined ? { citation: record.citation } : {}),
      });
      evidenceIds.push(evidenceId);

      const personId = opts.personIdFor(record);
      if (personId) {
        for (const [key, value] of Object.entries(record.payload)) {
          attributeIds.push(await this.recordAttribute({ personId, key, value, evidenceId }));
        }
      }
    }

    await this.audit('ingest', 'connector', connector.id, {
      records: records.length,
      evidence: evidenceIds.length,
    });

    return { evidenceIds, attributeIds };
  }

  /**
   * The only path by which a manual entry only surface, LinkedIn Recruiter
   * above all, reaches the ledger: a named human recording what they learned.
   */
  async recordManualEntry(
    connector: ManualEntryConnector,
    record: { personId: string; key: string; value: string; citation?: string; observedAt: Date },
    opts: { jurisdiction: string },
  ): Promise<string> {
    if (this.#actor.type !== 'user') {
      throw new LedgerError(
        `manual entry from "${connector.id}" requires a human actor, received "${this.#actor.type}"`,
      );
    }
    const sourceId = await this.registerSource(connector);
    const evidenceId = await this.recordEvidence({
      sourceId,
      collectionMethod: 'recruiter_entered',
      collectedAt: record.observedAt,
      lawfulBasis: connector.lawfulBasis,
      jurisdiction: opts.jurisdiction,
      confidence: connector.baseConfidence,
      ...(record.citation !== undefined ? { citation: record.citation } : {}),
    });
    return this.recordAttribute({
      personId: record.personId,
      key: record.key,
      value: record.value,
      evidenceId,
    });
  }

  async audit(
    action: string,
    entityType: string,
    entityId?: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await this.#tx.execute(sql`
      SELECT audit_write(
        ${this.#actor.type}::actor_type, ${this.#actor.id}, ${action},
        ${entityType}, ${entityId ?? null}, ${JSON.stringify(detail)}::jsonb
      )
    `);
  }
}
