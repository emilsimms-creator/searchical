import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { CompensationService, toCents } from '@/compensation';

const AT = new Date('2026-09-01T09:00:00Z');
type Tx = Parameters<Parameters<Harness['app']['withTenant']>[1]>[0];

async function scaffold(tx: Tx, tenantId: string) {
  const one = (res: unknown) => (res as { rows: { id: string }[] }).rows[0]!.id;
  const mandateId = one(await tx.execute(sql`
    INSERT INTO mandates (tenant_id, title, segment, function_domain, status, created_by, confirmed_by, confirmed_at)
    VALUES (${tenantId}::uuid, 'VP Engineering', 'senior_executive', 'Engineering', 'live', 'emil', 'emil', now())
    RETURNING id`));
  const personId = one(await tx.execute(sql`
    INSERT INTO persons (tenant_id, display_name) VALUES (${tenantId}::uuid, 'A Candidate') RETURNING id`));
  const prospectId = one(await tx.execute(sql`
    INSERT INTO prospects (tenant_id, mandate_id, person_id)
    VALUES (${tenantId}::uuid, ${mandateId}::uuid, ${personId}::uuid) RETURNING id`));
  return { mandateId, prospectId };
}

const stated = {
  baseMinCents: toCents(185_000), baseMaxCents: toCents(225_000), bonusTargetPct: 20,
  inferred: false, sourceQuote: 'Base salary $185,000 to $225,000 with a 20% target bonus',
};

describe('the compensation band', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Compensation Test')).id;
  });
  afterEach(async () => h?.close());

  const service = (tx: Tx) => new CompensationService(tx, tenant, { id: 'emil' });

  it('records a band in cents, defaulting to Canadian dollars', async () => {
    const band = await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      await service(tx).recordBand({ mandateId, ...stated });
      return service(tx).liveBand(mandateId);
    });
    expect(band!.currency).toBe('CAD');
    expect(band!.period).toBe('annual');
    expect(band!.baseMinCents).toBe(18_500_000n);
    expect(band!.bonusTargetPct).toBe(20);
    expect(band!.version).toBe(1);
    expect(band!.confirmedAt).toBeNull();
  });

  /** A band is versioned, because week two's number has to survive week six's revision. */
  it('supersedes rather than overwrites, and keeps what we were quoting at the time', async () => {
    const { live, history } = await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.recordBand({ mandateId, ...stated });
      await svc.recordBand({
        mandateId, baseMinCents: toCents(205_000), baseMaxCents: toCents(245_000),
        bonusTargetPct: 25, inferred: false,
        sourceQuote: 'revised band confirmed by the CPTO on 12 September',
        reason: 'Client raised the band after two declines at the top of the old one.',
      });
      return { live: await svc.liveBand(mandateId), history: await svc.history(mandateId) };
    });

    expect(live!.version).toBe(2);
    expect(live!.baseMinCents).toBe(20_500_000n);
    expect(history).toHaveLength(2);
    expect(history[1]!.baseMinCents).toBe(18_500_000n);
    expect(history[1]!.supersededReason).toMatch(/two declines at the top of the old one/);
    expect(history[1]!.supersededAt).not.toBeNull();
  });

  it('never leaves two live bands, because that is two recruiters quoting two numbers', async () => {
    const live = await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      const svc = service(tx);
      for (const min of [185_000, 195_000, 205_000]) {
        await svc.recordBand({
          mandateId, baseMinCents: toCents(min), baseMaxCents: toCents(min + 40_000),
          inferred: false, sourceQuote: `stated as ${min}`,
        });
      }
      const r = (await tx.execute(sql`
        SELECT count(*)::int AS n FROM mandate_compensation WHERE superseded_at IS NULL
      `)) as unknown as { rows: { n: number }[] };
      return r.rows[0]!.n;
    });
    expect(live).toBe(1);
  });

  it('refuses a direct insert, so the supersede and the insert cannot come apart', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        await tx.execute(sql`
          INSERT INTO mandate_compensation (tenant_id, mandate_id, version, base_min_cents, inferred, created_by)
          VALUES (${tenant}::uuid, ${mandateId}::uuid, 1, 18500000, false, 'emil')`);
      }),
      /permission denied/i,
      'a caller that inserted directly could leave a mandate with two live bands',
    );
  });

  it('will not rewrite a figure, only supersede it', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        await service(tx).recordBand({ mandateId, ...stated });
        await tx.execute(sql`UPDATE mandate_compensation SET base_max_cents = 30000000`);
      }),
      /versioned, not edited/,
      'the band quoted in week two must survive the revision in week six',
    );
  });

  it('refuses a range that runs backwards, and an empty band', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        await service(tx).recordBand({
          mandateId, baseMinCents: toCents(225_000), baseMaxCents: toCents(185_000), inferred: false,
        });
      }),
      /range_ordered/,
      'a range that runs backwards is not a range',
    );
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        await service(tx).recordBand({ mandateId, inferred: true });
      }),
      /says_something/,
      'an empty row makes a mandate look as though it has a band when it does not',
    );
  });
});

describe('confirmation, which is the client standing behind a number', () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Confirmation Test')).id;
  });
  afterEach(async () => h?.close());
  const service = (tx: Tx) => new CompensationService(tx, tenant, { id: 'emil' });

  it('will not confirm an inferred band, at the service or at the database', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      const svc = service(tx);
      const { bandId } = await svc.recordBand({
        mandateId, baseMinCents: toCents(190_000), baseMaxCents: toCents(230_000),
        inferred: true, otherNote: 'Market estimate from comparable VP Engineering roles.',
      });
      await expect(svc.confirmBand(bandId, AT)).rejects.toThrow(/inferred from the market/);
    });
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        await service(tx).recordBand({
          mandateId, baseMinCents: toCents(190_000), inferred: true,
        });
        await tx.execute(sql`
          UPDATE mandate_compensation SET confirmed_by = 'emil', confirmed_at = now()`);
      }),
      /inferred_not_confirmable/,
      'a confirmed guess is indistinguishable downstream from a number the client committed to',
    );
  });

  it('refuses a source quote on an inferred band', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      await expect(service(tx).recordBand({
        mandateId, baseMinCents: toCents(190_000), inferred: true, sourceQuote: 'competitive salary',
      })).rejects.toThrow(/inferred band carries no source quote/);
    });
  });

  it('will not let a confirmation be reassigned', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { mandateId } = await scaffold(tx, tenant);
        const svc = service(tx);
        const { bandId } = await svc.recordBand({ mandateId, ...stated });
        await svc.confirmBand(bandId, AT);
        await tx.execute(sql`UPDATE mandate_compensation SET confirmed_at = now()`);
      }),
      /already confirmed/,
      'a confirmation is the client standing behind a number',
    );
  });

  it('quotes a range only once the hiring leader has confirmed it', async () => {
    const results = await h.app.withTenant(tenant, async (tx) => {
      const { mandateId } = await scaffold(tx, tenant);
      const svc = service(tx);
      const none = await svc.quotableRange(mandateId);
      const { bandId } = await svc.recordBand({
        mandateId, ...stated, pensionNote: 'Defined benefit, indexed.',
      });
      const unconfirmed = await svc.quotableRange(mandateId);
      await svc.confirmBand(bandId, AT);
      const confirmed = await svc.quotableRange(mandateId);
      return { none, unconfirmed, confirmed };
    });

    expect(results.none).toEqual({
      quotable: false,
      reason: expect.stringMatching(/Do not invent one/),
    });
    expect(results.unconfirmed.quotable).toBe(false);
    expect((results.unconfirmed as { reason: string }).reason)
      .toMatch(/posting ranges are not offer ranges/);
    expect(results.confirmed.quotable).toBe(true);
    expect((results.confirmed as { text: string }).text)
      .toMatch(/185,000.*225,000.*20 percent target bonus.*Defined benefit/);
  });
});

describe("the candidate's number", () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Figure Test')).id;
  });
  afterEach(async () => h?.close());
  const service = (tx: Tx) => new CompensationService(tx, tenant, { id: 'emil' });

  it('records an expectation, which is the figure this system is built around', async () => {
    const figure = await h.app.withTenant(tenant, async (tx) => {
      const { prospectId } = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.recordFigure({
        prospectId, figureKind: 'expectation', amountCents: toCents(215_000),
        volunteered: true, statedAt: AT,
      });
      return svc.latestExpectation(prospectId);
    });
    expect(figure!.amountCents).toBe(21_500_000n);
    expect(figure!.currency).toBe('CAD');
  });

  /**
   * BC and PEI both restrict employers from asking an applicant what previous
   * employers paid them. Whether a search firm acting as agent is caught is a
   * question for counsel; the system takes the conservative route either way.
   */
  it('refuses pay history that was asked for rather than volunteered', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const { prospectId } = await scaffold(tx, tenant);
      await expect(service(tx).recordFigure({
        prospectId, figureKind: 'current_package', amountCents: toCents(198_000),
        volunteered: false, lawfulBasis: 'they told us', statedAt: AT,
      })).rejects.toThrow(/only where the person offered it unprompted/);
    });
  });

  it('refuses pay history with no stated lawful basis', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const { prospectId } = await scaffold(tx, tenant);
      await expect(service(tx).recordFigure({
        prospectId, figureKind: 'current_package', amountCents: toCents(198_000),
        volunteered: true, statedAt: AT,
      })).rejects.toThrow(/needs a stated lawful basis/);
    });
  });

  it('holds the same rule at the database, so the service cannot be stepped around', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const { prospectId } = await scaffold(tx, tenant);
        await tx.execute(sql`
          INSERT INTO prospect_compensation
            (tenant_id, prospect_id, figure_kind, amount_cents, volunteered, stated_at, recorded_by)
          VALUES (${tenant}::uuid, ${prospectId}::uuid, 'current_package', 19800000, false,
                  now(), 'emil')`);
      }),
      /history_needs_basis/,
      'a system that cannot show which it did cannot show it complied',
    );
  });

  it('records volunteered pay history with the jurisdiction attached for later review', async () => {
    const note = await h.app.withTenant(tenant, async (tx) => {
      const { prospectId } = await scaffold(tx, tenant);
      await service(tx).recordFigure({
        prospectId, figureKind: 'current_package', amountCents: toCents(198_000),
        volunteered: true, lawfulBasis: 'Offered unprompted on the exploratory call, 1 September.',
        personLocation: 'Vancouver', statedAt: AT,
      });
      const r = (await tx.execute(sql`
        SELECT note FROM prospect_compensation WHERE figure_kind = 'current_package'
      `)) as unknown as { rows: { note: string }[] };
      return r.rows[0]!.note;
    });
    expect(note).toMatch(/Vancouver/);
    expect(note).toMatch(/asking is restricted/);
  });

  /** Closes factor 8 of the receptivity model, which had a weight and nothing to weigh. */
  it('surfaces the gap at the first call rather than at offer', async () => {
    const { gap, guidance } = await h.app.withTenant(tenant, async (tx) => {
      const { mandateId, prospectId } = await scaffold(tx, tenant);
      const svc = service(tx);
      const { bandId } = await svc.recordBand({ mandateId, ...stated });
      await svc.confirmBand(bandId, AT);
      await svc.recordFigure({
        prospectId, figureKind: 'expectation', amountCents: toCents(300_000),
        volunteered: true, statedAt: AT,
      });
      return {
        gap: await svc.gap(mandateId, prospectId),
        guidance: await svc.factor8(mandateId, prospectId, true),
      };
    });
    expect(gap.verdict).toBe('above_band');
    expect(gap.suggestedFactor8).toBe(0);
    expect(guidance).toMatch(/suggests 0 out of 5/);
  });

  it('keeps every figure inside its tenant', async () => {
    const other = (await seedTenant(h.app, 'Another Practice')).id;
    const prospectId = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await service(tx).recordFigure({
        prospectId: built.prospectId, figureKind: 'expectation', amountCents: toCents(215_000),
        volunteered: true, statedAt: AT,
      });
      return built.prospectId;
    });
    const seen = await h.app.withTenant(other, (tx) =>
      new CompensationService(tx, other, { id: 'someone-else' }).latestExpectation(prospectId));
    expect(seen).toBeNull();
  });
});
