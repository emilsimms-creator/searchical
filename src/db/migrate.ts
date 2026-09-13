import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { logger } from '@/observability/logger';

/**
 * Runs a multi statement SQL script. Drivers differ here: the extended protocol
 * used for ordinary parameterised queries refuses more than one command per
 * statement, so migrations need the simple protocol. Supplied by the caller
 * because the two drivers expose it differently.
 */
export type ScriptRunner = (script: string) => Promise<unknown>;

/**
 * Migrations are plain SQL files applied in filename order and recorded in
 * `schema_migrations`. They are hand written because this is an audit heavy
 * schema: you must be able to read exactly what ran. See architecture.md s14.
 */
export async function migrate(db: Database, dir: string, runScript: ScriptRunner): Promise<string[]> {
  await runScript(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    ((await db.execute(sql`SELECT filename FROM schema_migrations`)) as unknown as {
      rows: { filename: string }[];
    }).rows.map((r) => r.filename),
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(join(dir, file), 'utf8');
    // Each migration runs in its own transaction: a half applied security
    // migration is worse than a failed one.
    try {
      await runScript(
        `BEGIN;\n${body}\n;\nINSERT INTO schema_migrations (filename) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`,
      );
    } catch (error) {
      await runScript('ROLLBACK;').catch(() => undefined);
      logger.error({ migration: file }, 'migration failed');
      throw error;
    }
    ran.push(file);
    logger.info({ migration: file }, 'migration applied');
  }

  return ran;
}
