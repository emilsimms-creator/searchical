import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { ALGONQUIN_NETWORK_DESIGNER_EXTRACTION, fakeModel } from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import { MandateService, matchOffLimits, seedChannelRatings, type MandateConstraint, type MandateTerm, type OffLimitsEntry } from '@/mandate';
import { screen, screenAll } from '@/screening';

const FCI: OffLimitsEntry = {
  name: 'FCI', aliases: [], basis: 'client_vendor',
  source: 'Operator, 30 October 2026: the client\'s cabling vendor is FCI',
};

const term = (kind: MandateTerm['kind'], t: string): MandateTerm => ({
  kind, term: t, origin: 'recruiter', status: 'confirmed', observedCount: null, rank: 1,
});
const TERMS = [term('title_variant', 'Structured Cabling Designer'), term('must_have_skill', 'structured cabling')];
const NO_CONSTRAINTS: MandateConstraint[] = [];

describe('matching an off limits organisation', () => {
  it('matches the name as a whole word, in any case', () => {
    expect(matchOffLimits('Structured Cabling Designer at FCI, Ottawa', [FCI])?.matchedName).toBe('FCI');
    expect(matchOffLimits('structured cabling designer at fci', [FCI])).not.toBeNull();
  });

  it('does not match inside another word', () => {
    expect(matchOffLimits('Designer at Pacific Telecom and Specific Systems', [FCI])).toBeNull();
  });

  it('errs towards a hit, because a false hit costs a look and a miss approaches the wrong person', () => {
    expect(matchOffLimits('Cable assemblies engineer at FCI Connectors', [FCI])).not.toBeNull();
  });

  it('uses aliases only when they are recorded, and never invents one', () => {
    const text = 'Structured Cabling Designer at Fleming Communications Inc.';
    expect(matchOffLimits(text, [FCI])).toBeNull();
    expect(matchOffLimits(text, [{ ...FCI, aliases: ['Fleming Communications Inc.'] }])?.matchedName).toBe('Fleming Communications Inc.');
  });

  it('has nothing to match when nothing is off limits', () => {
    expect(matchOffLimits('Designer at FCI', [])).toBeNull();
  });
});

describe('screening with an off limits organisation', () => {
  const lead = (text: string) => ({
    evidence: { text, sourceId: 'x', depth: 'snippet' as const, url: 'https://example.org/in/a-person' },
    terms: TERMS, constraints: NO_CONSTRAINTS,
  });

  it('would advance this person without the entry, which is what makes the next test mean something', () => {
    expect(screen(lead('Structured Cabling Designer. Ten years of structured cabling at FCI.')).verdict).toBe('advance');
  });

  it('holds a strong match who names the organisation, and says a person must check', () => {
    const r = screen({ ...lead('Structured Cabling Designer. Ten years of structured cabling at FCI.'), offLimits: [FCI] });
    expect(r.verdict).toBe('hold');
    expect(r.concerns[0]).toMatchObject({ severity: 'off_limits', matched: 'FCI' });
    expect(r.headline).toMatch(/Do not approach until a person has checked/);
    expect(r.headline).toMatch(/not proof they do not/);
  });

  it('rejects nobody on a mention, because a mention is not employment', () => {
    const r = screen({ ...lead('Former FCI technician, now a Structured Cabling Designer.'), offLimits: [FCI] });
    expect(r.verdict).not.toBe('reject');
  });

  it('leaves everyone else alone', () => {
    const r = screen({ ...lead('Structured Cabling Designer. Ten years of structured cabling at another firm.'), offLimits: [FCI] });
    expect(r.verdict).toBe('advance');
    expect(r.concerns).toHaveLength(0);
  });

  it('sorts a flagged person last among the holds, so nobody works them first', () => {
    const ordered = screenAll([
      { ...lead('Structured Cabling Designer. structured cabling at FCI'), offLimits: [FCI] },
      { ...lead('Some page that says nothing useful'), offLimits: [FCI] },
    ]);
    expect(ordered.map((r) => r.index)).toEqual([1, 0]);
  });
});

describe('recording who is off limits', () => {
  let h: Harness;
  let tenant: string;
  let mandateId: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Off Limits Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
    const drafted = await h.app.withTenant(tenant, (tx) => svc(tx).draftFromJobSpec({ jobSpec: 'x', actor: { id: 'emil' }, tenantId: tenant }));
    mandateId = drafted.mandateId;
  });

  afterEach(async () => h?.close());

  const svc = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0]) =>
    new MandateService(tx, new LlmGateway(fakeModel(ALGONQUIN_NETWORK_DESIGNER_EXTRACTION)), null);

  const record = (over: Partial<Parameters<MandateService['recordOffLimits']>[0]> = {}) =>
    h.app.withTenant(tenant, (tx) =>
      svc(tx).recordOffLimits({ mandateId, tenantId: tenant, actor: { id: 'emil' }, name: 'FCI', basis: 'client_vendor', source: FCI.source, ...over }),
    );
  const list = () => h.app.withTenant(tenant, (tx) => svc(tx).offLimitsFor(mandateId));

  it('records the organisation with its basis and where it came from', async () => {
    await record();
    expect(await list()).toEqual([{ name: 'FCI', aliases: [], basis: 'client_vendor', source: FCI.source }]);
  });

  it('refuses an entry with no traceable source', async () => {
    await expectRejection(record({ source: 'told' }), /needs its source/);
    expect(await list()).toEqual([]);
  });

  it('refuses the same organisation twice, however it is capitalised', async () => {
    await record();
    await expectRejection(record({ name: ' fci ' }), /already off limits/);
  });

  it('lifts an entry with a reason, keeps the history and stops restricting', async () => {
    const { id } = await record();
    await expectRejection(h.app.withTenant(tenant, (tx) => svc(tx).liftOffLimits({ id, actor: { id: 'emil' }, reason: 'ok' })), /at least 20 characters/);
    await h.app.withTenant(tenant, (tx) =>
      svc(tx).liftOffLimits({ id, actor: { id: 'emil' }, reason: 'The client confirmed in writing that FCI staff may be approached.' }),
    );
    expect(await list()).toEqual([]);
    const rows = (await h.app.withTenant(tenant, async (tx) => (await tx.execute(sql`SELECT lifted_by, lifted_reason FROM mandate_off_limits`)) as unknown as { rows: { lifted_by: string }[] })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lifted_by).toBe('emil');
    // Once lifted, it can be recorded again: the restriction came back.
    await record();
    expect(await list()).toHaveLength(1);
  });

  it('shows up on the search plan, which is where a recruiter looks first', async () => {
    await record();
    await h.app.withTenant(tenant, (tx) =>
      svc(tx).confirmVocabulary({
        mandateId, tenantId: tenant, actor: { id: 'emil' },
        decisions: [{ kind: 'title_variant', term: 'Network Designer', decision: 'confirm' }],
      }),
    );
    const plan = await h.app.withTenant(tenant, (tx) => svc(tx).buildSearchPlan({ mandateId, tenantId: tenant }));
    expect(plan.offLimits.map((o) => o.name)).toEqual(['FCI']);
  });

  describe('in the database itself', () => {
    it('cannot be deleted, renamed or re-sourced by the application', async () => {
      await record();
      await expectRejection(h.app.withTenant(tenant, (tx) => tx.execute(sql`DELETE FROM mandate_off_limits`)), /permission denied/);
      await expectRejection(h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE mandate_off_limits SET name = 'Someone else'`)), /permission denied/);
      await expectRejection(h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE mandate_off_limits SET source = 'rewritten history'`)), /permission denied/);
    });

    it('refuses a half completed lift', async () => {
      await record();
      await expectRejection(
        h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE mandate_off_limits SET lifted_at = now()`)),
        /off_limits_lift_complete/,
      );
    });

    it('refuses a basis it does not know', async () => {
      await expectRejection(
        h.app.withTenant(tenant, (tx) => tx.execute(sql`
          INSERT INTO mandate_off_limits (tenant_id, mandate_id, name, basis, source, recorded_by)
          VALUES (${tenant}::uuid, ${mandateId}::uuid, 'X Co', 'hunch', 'told by somebody', 'emil')`)),
        /off_limits_basis_known/,
      );
    });
  });
});
