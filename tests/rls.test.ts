import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from './helpers/db';
import { persons } from '@/db/schema';

/**
 * Phase 0 exit criterion: row level security blocks a cross tenant read,
 * proven against a real database rather than asserted.
 */
describe('tenant isolation', () => {
  let h: Harness;
  let alpha: string;
  let beta: string;

  beforeAll(async () => {
    h = await harness();
    alpha = (await seedTenant(h.app, 'Alpha Search')).id;
    beta = (await seedTenant(h.app, 'Beta Search')).id;

    await h.app.withTenant(alpha, async (tx) => {
      await tx.insert(persons).values({ tenantId: alpha, displayName: 'Alpha Person' });
    });
    await h.app.withTenant(beta, async (tx) => {
      await tx.insert(persons).values({ tenantId: beta, displayName: 'Beta Person' });
    });
  });

  afterAll(async () => h?.close());

  it('sees only its own rows', async () => {
    const a = await h.app.withTenant(alpha, (tx) => tx.select().from(persons));
    const b = await h.app.withTenant(beta, (tx) => tx.select().from(persons));

    expect(a.map((p) => p.displayName)).toEqual(['Alpha Person']);
    expect(b.map((p) => p.displayName)).toEqual(['Beta Person']);
  });

  it('cannot read another tenant even when the identifier is known', async () => {
    const rows = await h.app.withTenant(beta, async (tx) => {
      // A deliberately hostile query: filter directly for the other tenant.
      const res = (await tx.execute(
        sql`SELECT display_name FROM persons WHERE tenant_id = ${alpha}::uuid`,
      )) as unknown as { rows: unknown[] };
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('cannot write a row into another tenant', async () => {
    await expect(
      h.app.withTenant(beta, async (tx) => {
        await tx.insert(persons).values({ tenantId: alpha, displayName: 'Smuggled' });
      }),
    ).rejects.toThrow();
  });

  it('returns nothing when no tenant claim is set', async () => {
    // Fail closed: the RLS predicate compares against NULL, which is not true.
    const rows = await h.app.asOwner(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE searchical_app`);
      const r = (await tx.execute(sql`SELECT * FROM persons`)) as unknown as { rows: unknown[] };
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('drops the tenant claim and the role at the end of the transaction', async () => {
    await h.app.withTenant(alpha, async () => undefined);
    const settings = await h.app.asOwner(async (tx) => {
      const res = (await tx.execute(
        sql`SELECT current_setting('app.tenant_id', true) AS tenant, current_user AS who`,
      )) as unknown as { rows: { tenant: string | null; who: string }[] };
      return res.rows[0]!;
    });
    expect(settings.tenant === null || settings.tenant === '').toBe(true);
    expect(settings.who).not.toBe('searchical_app');
  });
});
