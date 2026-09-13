import { sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import type { ConsentRecord, PolicyLookups } from './types';

export function databaseLookups(tx: TenantTx): PolicyLookups {
  return {
    async isSuppressed(subjectHash: string): Promise<boolean> {
      const res = (await tx.execute(sql`
        SELECT 1 FROM suppressions WHERE subject_hash = ${subjectHash} LIMIT 1
      `)) as unknown as { rows: unknown[] };
      return res.rows.length > 0;
    },

    async consentFor(personId: string): Promise<readonly ConsentRecord[]> {
      const res = (await tx.execute(sql`
        SELECT basis, captured_at, expires_at FROM consents WHERE person_id = ${personId}::uuid
      `)) as unknown as { rows: { basis: string; captured_at: string; expires_at: string | null }[] };
      return res.rows.map((r) => ({
        basis: r.basis as ConsentRecord['basis'],
        capturedAt: new Date(r.captured_at),
        expiresAt: r.expires_at === null ? null : new Date(r.expires_at),
      }));
    },
  };
}
