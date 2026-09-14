import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { Searchical, type TenantTx } from '@/db/client';
import * as schema from '@/db/schema';

/**
 * Who is using the screen, and which practice's data they may see.
 *
 * The Pilot Cut has one operator and one tenant, so this reads both from the
 * environment rather than from a login. That is a deliberate, temporary shim and
 * it is written to be impossible to run past by accident: the process refuses to
 * start without both values, and every query still goes through `withTenant`,
 * so row level security is doing the confining exactly as it does everywhere
 * else. Replacing this with real authentication changes this file and nothing
 * downstream of it.
 *
 * What it must never become is a filter in application code. The moment a screen
 * starts passing a tenant id into a WHERE clause, the isolation is one missing
 * clause away from gone.
 */
const WebEnv = z.object({
  DATABASE_URL: z.string().url({
    message: 'The approval queue needs DATABASE_URL. It reads real drafts, not fixtures.',
  }),
  SEARCHICAL_TENANT_ID: z.string().uuid({
    message: 'Set SEARCHICAL_TENANT_ID to the practice this operator works for.',
  }),
  SEARCHICAL_OPERATOR: z.string().min(1, {
    message: 'Set SEARCHICAL_OPERATOR to the person deciding. Every approval is recorded against it.',
  }),
});

let cached: { app: Searchical; tenantId: string; operator: string } | null = null;

function connect() {
  if (cached) return cached;
  const env = WebEnv.parse(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  cached = {
    app: new Searchical(drizzle(pool, { schema })),
    tenantId: env.SEARCHICAL_TENANT_ID,
    operator: env.SEARCHICAL_OPERATOR,
  };
  return cached;
}

/** The operator whose name goes on every approval. */
export const operator = (): { id: string } => ({ id: connect().operator });

/** Run one unit of work inside this operator's tenant. */
export async function withSession<T>(fn: (tx: TenantTx, tenantId: string) => Promise<T>): Promise<T> {
  const { app, tenantId } = connect();
  return app.withTenant(tenantId, (tx) => fn(tx, tenantId));
}
