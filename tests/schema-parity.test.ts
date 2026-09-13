import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { sql, getTableName, getTableColumns, is, Table } from 'drizzle-orm';
import { harness, type Harness } from './helpers/db';
import * as schema from '@/db/schema';

/**
 * The SQL migrations are the source of truth for this schema, and the Drizzle
 * definitions exist for typed queries. This test fails the moment the two drift
 * apart, which is the only thing that makes keeping both honest.
 */
describe('schema parity between migrations and the typed schema', () => {
  let h: Harness;
  let live: Map<string, Set<string>>;

  beforeAll(async () => {
    h = await harness();
    const res = (await h.app.asOwner((tx) =>
      tx.execute(sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
      `),
    )) as unknown as { rows: { table_name: string; column_name: string }[] };

    live = new Map();
    for (const row of res.rows) {
      const set = live.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      live.set(row.table_name, set);
    }
  });

  afterAll(async () => h?.close());

  it('every typed table exists in the migrated database with matching columns', () => {
    // Typed as unknown[] first: the schema module is a union of tables and
    // enums, and a type predicate must narrow from a supertype.
    const exported: unknown[] = Object.values(schema);
    const tables = exported.filter((v): v is Table => is(v, Table));
    expect(tables.length).toBeGreaterThan(10);

    const problems: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      const liveColumns = live.get(name);
      if (!liveColumns) {
        problems.push(`table "${name}" is defined in the typed schema but not created by any migration`);
        continue;
      }
      for (const column of Object.values(getTableColumns(table))) {
        if (!liveColumns.has(column.name)) {
          problems.push(`column "${name}.${column.name}" is in the typed schema but not in the database`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every fact table requires evidence', async () => {
    // Provenance or it does not exist: this is a NOT NULL foreign key, so a
    // bare fact is not representable.
    const res = (await h.app.asOwner((tx) =>
      tx.execute(sql`
        SELECT table_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'evidence_id'
        ORDER BY table_name
      `),
    )) as unknown as { rows: { table_name: string; is_nullable: string }[] };

    expect(res.rows.map((r) => r.table_name)).toEqual([
      'attributes',
      'consents',
      'employments',
      // An identity claim is a fact about a person and carries provenance like
      // any other. A merge made on unattributed evidence is unreviewable.
      'person_identities',
      'sensitive_attributes',
      'signals',
    ]);
    expect(res.rows.every((r) => r.is_nullable === 'NO')).toBe(true);
  });

  it('forces row level security on every tenant scoped table', async () => {
    const res = (await h.app.asOwner((tx) =>
      tx.execute(sql`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
      `),
    )) as unknown as { rows: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[] };

    const unprotected = res.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
    expect(unprotected.map((r) => r.relname)).toEqual([]);
  });
});
