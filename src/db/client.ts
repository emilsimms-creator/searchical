import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { config } from '@/config';

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
    return this.#db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.execute(sql.raw(`SET LOCAL ROLE ${this.#appRole}`));
      return fn(tx as unknown as TenantTx);
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
