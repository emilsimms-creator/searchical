import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { Ledger } from '@/ledger';
import { recruiterManualEntry } from '@/connectors';
import { EngagementService, MESSAGE_TEMPLATES, type EvidenceFact } from '@/engagement';

const START = new Date('2026-09-01T09:00:00Z');
type Tx = Parameters<Parameters<Harness['app']['withTenant']>[1]>[0];

async function scaffold(tx: Tx, tenantId: string, name: string, title: string, expiresAt?: Date) {
  const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
  const sourceId = await ledger.registerSource(recruiterManualEntry);
  const evidenceId = await ledger.recordEvidence({
    sourceId, collectionMethod: 'public_evidence', collectedAt: START,
    lawfulBasis: 'publicly_available_exemption', jurisdiction: 'CA', confidence: 0.8,
    citation: 'https://example.org/kubecon-2026-talk',
    ...(expiresAt ? { expiresAt } : {}),
  });
  const one = (res: unknown) => (res as { rows: { id: string }[] }).rows[0]!.id;
  const mandateId = one(await tx.execute(sql`
    INSERT INTO mandates (tenant_id, title, segment, function_domain, status, created_by, confirmed_by, confirmed_at)
    VALUES (${tenantId}::uuid, ${title}, 'senior_executive', 'Engineering', 'live', 'emil', 'emil', now())
    RETURNING id`));
  const personId = one(await tx.execute(sql`
    INSERT INTO persons (tenant_id, display_name) VALUES (${tenantId}::uuid, ${name}) RETURNING id`));
  const prospectId = one(await tx.execute(sql`
    INSERT INTO prospects (tenant_id, mandate_id, person_id)
    VALUES (${tenantId}::uuid, ${mandateId}::uuid, ${personId}::uuid) RETURNING id`));
  return { mandateId, personId, prospectId, evidenceId };
}

const evidenceMap = (id: string) =>
  new Map<string, EvidenceFact>([[id, {
    id, live: true, aboutThisPerson: true, citation: 'https://example.org/kubecon-2026-talk',
  }]]);

const hooksFor = (templateCode: string, evidenceId: string) =>
  (MESSAGE_TEMPLATES.find((t) => t.code === templateCode)?.hookTokens ?? []).map((token) => ({
    token,
    value: 'their KubeCon talk on multi-cluster failover',
    evidenceId,
    citation: 'https://example.org/kubecon-2026-talk',
  }));

describe('the approval queue', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Queue Test')).id;
  });
  afterEach(async () => h?.close());

  const service = (tx: Tx) => new EngagementService(tx, tenant, { id: 'emil' });

  async function queueOne(tx: Tx, name: string, title: string, body: string, expiresAt?: Date) {
    const built = await scaffold(tx, tenant, name, title, expiresAt);
    const svc = service(tx);
    const { sequenceId } = await svc.startSequence({
      prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
    });
    const step = ((await tx.execute(sql`
      SELECT id, template_code FROM sequence_steps WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch LIMIT 1
    `)) as unknown as { rows: { id: string; template_code: string }[] }).rows[0]!;
    const { messageId } = await svc.queueMessage({
      sequenceStepId: step.id, body,
      hooks: hooksFor(step.template_code, built.evidenceId), evidence: evidenceMap(built.evidenceId),
    });
    return { ...built, messageId, sequenceId };
  }

  it('lists what is waiting on a human, with enough to triage without opening it', async () => {
    const queue = await h.app.withTenant(tenant, async (tx) => {
      await queueOne(tx, 'Ada Okafor', 'VP Engineering', 'Hi Ada, your KubeCon talk stood out.');
      return service(tx).pendingQueue();
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      personName: 'Ada Okafor',
      mandateTitle: 'VP Engineering',
      touch: 1,
      templateCode: 'first_inmail',
      channel: 'linkedin_inmail',
      scheduledFor: '2026-09-01',
      hookCount: 1,
    });
  });

  /** The oldest draft is the one whose scheduled day is closest to passing. */
  it('puts the oldest first, because a late touch three is no longer the sequence the research supports', async () => {
    const names = await h.app.withTenant(tenant, async (tx) => {
      await queueOne(tx, 'First Queued', 'VP Engineering', 'Hi, your KubeCon talk stood out.');
      await queueOne(tx, 'Second Queued', 'VP Platform', 'Hi, your KubeCon talk stood out.');
      await queueOne(tx, 'Third Queued', 'VP Data', 'Hi, your KubeCon talk stood out.');
      return (await service(tx).pendingQueue()).map((q) => q.personName);
    });
    expect(names).toEqual(['First Queued', 'Second Queued', 'Third Queued']);
  });

  it('drops a draft whose sequence was cancelled by a reply', async () => {
    const queue = await h.app.withTenant(tenant, async (tx) => {
      const built = await queueOne(tx, 'Replied Already', 'VP Engineering', 'Hi, your KubeCon talk stood out.');
      await queueOne(tx, 'Still Waiting', 'VP Platform', 'Hi, your KubeCon talk stood out.');
      await service(tx).recordReply({
        prospectId: built.prospectId, rung: 'agreed_to_conversation', receivedAt: START,
      });
      return service(tx).pendingQueue();
    });
    expect(queue.map((q) => q.personName)).toEqual(['Still Waiting']);
  });

  it('drops a draft once it has been decided', async () => {
    const queue = await h.app.withTenant(tenant, async (tx) => {
      const built = await queueOne(tx, 'Decided', 'VP Engineering', 'Hi, your KubeCon talk stood out.');
      await service(tx).decide({ messageId: built.messageId, decision: 'approved', decidedAt: START });
      return service(tx).pendingQueue();
    });
    expect(queue).toEqual([]);
  });

  it('keeps one practice out of another practice queue', async () => {
    const other = (await seedTenant(h.app, 'Another Practice')).id;
    await h.app.withTenant(tenant, (tx) =>
      queueOne(tx, 'Ours', 'VP Engineering', 'Hi, your KubeCon talk stood out.'));
    const seen = await h.app.withTenant(other, (tx) =>
      new EngagementService(tx, other, { id: 'someone-else' }).pendingQueue());
    expect(seen).toEqual([]);
  });
});

describe('the draft an approver actually reads', () => {
  let h: Harness;
  let tenant: string;
  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Detail Test')).id;
  });
  afterEach(async () => h?.close());
  const service = (tx: Tx) => new EngagementService(tx, tenant, { id: 'emil' });

  async function queueOne(tx: Tx, expiresAt?: Date) {
    const built = await scaffold(tx, tenant, 'Ada Okafor', 'VP Engineering', expiresAt);
    const svc = service(tx);
    const { sequenceId } = await svc.startSequence({
      prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
    });
    const step = ((await tx.execute(sql`
      SELECT id, template_code FROM sequence_steps WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch LIMIT 1
    `)) as unknown as { rows: { id: string; template_code: string }[] }).rows[0]!;
    const { messageId } = await svc.queueMessage({
      sequenceStepId: step.id, body: 'Hi Ada, your KubeCon talk stood out.',
      hooks: hooksFor(step.template_code, built.evidenceId), evidence: evidenceMap(built.evidenceId),
    });
    return { ...built, messageId };
  }

  /**
   * The whole argument for a human in this loop is that they see what the draft
   * rests on. A payload that hides the evidence makes the approver a rubber
   * stamp, which is the failure the edit rate exists to detect.
   */
  it('carries the claim and its source together', async () => {
    const detail = await h.app.withTenant(tenant, async (tx) => {
      const built = await queueOne(tx);
      return service(tx).messageDetail(built.messageId);
    });

    expect(detail!.personName).toBe('Ada Okafor');
    expect(detail!.sequenceTouches).toBe(5);
    expect(detail!.templatePurpose).toMatch(/specific hook and an exploratory, confidential ask/);
    expect(detail!.templateEvidence).toMatch(/under 400 characters/);
    expect(detail!.hooks).toHaveLength(1);
    expect(detail!.hooks[0]).toMatchObject({
      token: 'specific achievement, talk or program',
      citation: 'https://example.org/kubecon-2026-talk',
      evidenceLive: true,
    });
  });

  /** A talk from four years ago cited as recent is the sentence that ends the conversation. */
  it('shows a hook resting on expired evidence as no longer live', async () => {
    const detail = await h.app.withTenant(tenant, async (tx) => {
      const built = await queueOne(tx, new Date('2026-08-01T00:00:00Z'));
      return service(tx).messageDetail(built.messageId);
    });
    expect(detail!.hooks[0]!.evidenceLive).toBe(false);
  });

  it('shows what was already decided for this person, so touch three reads in context', async () => {
    const detail = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant, 'Ada Okafor', 'VP Engineering');
      const svc = service(tx);
      const { sequenceId } = await svc.startSequence({
        prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
      });
      const steps = ((await tx.execute(sql`
        SELECT id, template_code, touch FROM sequence_steps WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch
      `)) as unknown as { rows: { id: string; template_code: string; touch: number }[] }).rows;

      const queue = async (i: number) => (await svc.queueMessage({
        sequenceStepId: steps[i]!.id, body: `Draft ${i} about your KubeCon talk.`,
        hooks: hooksFor(steps[i]!.template_code, built.evidenceId),
        evidence: evidenceMap(built.evidenceId),
      })).messageId;

      const first = await queue(0);
      await svc.decide({ messageId: first, decision: 'edited', finalBody: 'Rewritten.', decidedAt: START });
      const second = await queue(1);
      return svc.messageDetail(second);
    });

    expect(detail!.touch).toBe(2);
    expect(detail!.priorDecisions).toEqual([
      { touch: 1, decision: 'edited', decidedAt: expect.any(Date) },
    ]);
  });

  it('returns nothing for a draft in another tenant', async () => {
    const other = (await seedTenant(h.app, 'Another Practice')).id;
    const messageId = await h.app.withTenant(tenant, async (tx) => (await queueOne(tx)).messageId);
    const seen = await h.app.withTenant(other, (tx) =>
      new EngagementService(tx, other, { id: 'someone-else' }).messageDetail(messageId));
    expect(seen).toBeNull();
  });
});
