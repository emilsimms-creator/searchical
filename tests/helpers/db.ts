import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { fileURLToPath } from 'node:url';
import { Searchical, type Database } from '@/db/client';
import { migrate } from '@/db/migrate';
import * as schema from '@/db/schema';

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface Harness {
  readonly db: Database;
  readonly app: Searchical;
  close(): Promise<void>;
}

/**
 * An in-process Postgres for tests.
 *
 * PGlite is a real Postgres build, which matters here: the properties under
 * test are roles, FORCE ROW LEVEL SECURITY, grants and SECURITY DEFINER
 * functions. A mock or a different engine would prove nothing.
 */
export async function harness(): Promise<Harness> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db, MIGRATIONS, (script) => client.exec(script));
  return {
    db,
    app: new Searchical(db, 'searchical_app'),
    close: () => client.close(),
  };
}

export async function seedTenant(app: Searchical, name: string) {
  return app.createTenant(name);
}
