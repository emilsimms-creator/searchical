import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { config } from '@/config';
import { PolicyViolation } from '@/policy/types';

/** Drizzle wraps driver and callback errors, so the refusal may sit on the cause chain. */
function policyViolationIn(error: unknown): (PolicyViolation & { audit: NonNullable<PolicyViolation['audit']> }) | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current instanceof PolicyViolation && current.audit) {
      return current as PolicyViolation & { audit: NonNullable<PolicyViolation['audit']> };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export type Schema = typeof schema;
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type TenantTx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Postgres identifiers are not parameterisable, so validate before interpolating. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export class TenantScopeError extends Error {}

/**
 * The application's handle on the database.
 *
 * Every read and write of tenant data goes through `withTenant`, which opens a
 * transaction, sets the tenant claim for that transaction only, and drops to the
 * unprivileged application role. Row level security in migrations/0002 does the
 * confining. Nothing here filters by tenant in application code, deliberately:
 * an application level filter is a bug waiting for a missing WHERE clause.
 */
export class Searchical {
  readonly #db: Database;
  readonly #appRole: string;

  constructor(db: Database, appRole: string = config.DATABASE_APP_ROLE) {
    if (!IDENTIFIER.test(appRole)) {
      throw new TenantScopeError(`invalid application role name: ${appRole}`);
    }
    this.#db = db;
    this.#appRole = appRole;
  }

  /**
   * Run work inside one tenant's scope.
   *
   * `set_config(..., true)` and `SET LOCAL ROLE` are both transaction local, so
   * the claim and the role revert on commit or rollback. There is no path that
   * leaves a connection carrying a stale tenant into the next request.
   */
  async withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.#db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        await tx.execute(sql.raw(`SET LOCAL ROLE ${this.#appRole}`));
        return fn(tx as unknown as TenantTx);
      });
    } catch (error) {
      const violation = policyViolationIn(error);
      if (violation?.audit) {
        // Never let a failure to audit mask the refusal itself.
        await this.#auditRefusal(tenantId, violation).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * A refused policy decision, written after its transaction has rolled back.
   *
   * Found on the live uOttawa end to end run. The gates audit every decision
   * inside the transaction doing the work, and a refusal then throws, so the
   * transaction rolls back and takes the audit row with it. Allowed decisions
   * were recorded and refusals vanished, which is the wrong way round: the
   * refusals are the decisions a regulator most wants to see. This writes the
   * durable copy in a fresh transaction, marked as rolled back so nobody reads
   * it as an action that happened. A caller that catches the refusal inside its
   * own transaction and commits keeps the in-transaction row instead, so each
   * refusal is recorded exactly once either way.
   */
  async #auditRefusal(tenantId: string, v: PolicyViolation & { audit: NonNullable<PolicyViolation['audit']> }) {
    await this.#db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.execute(sql.raw(`SET LOCAL ROLE ${this.#appRole}`));
      await tx.execute(sql`
        SELECT audit_write(
          ${v.audit.actorType}::actor_type, ${v.audit.actorId}, ${'policy.' + v.decision.gate},
          ${v.audit.entityType}, ${v.audit.entityId},
          ${JSON.stringify({
            allowed: false,
            rolled_back: true,
            reasons: v.decision.reasons.map((r) => ({ rule: r.rule, allowed: r.allowed, statement: r.statement })),
          })}::jsonb
        )`);
    });
  }

  /**
   * Administrative work that cannot be done inside a tenant scope, such as
   * creating the tenant itself. Named unambiguously so that reaching for it is
   * a visible decision in review rather than an accident.
   */
  async asOwner<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.#db.transaction(async (tx) => fn(tx as unknown as TenantTx));
  }

  /**
   * Tenants are subject to forced row level security like everything else, so
   * the row is created with its own identity already in the session claim.
   */
  async createTenant(name: string, region = 'ca-central-1'): Promise<{ id: string; name: string }> {
    const id = crypto.randomUUID();
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
      await tx.insert(schema.tenants).values({ id, name, region });
      return { id, name };
    });
  }

  get raw(): Database {
    return this.#db;
  }
}
