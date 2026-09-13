import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { harness, seedTenant, type Harness } from '../helpers/db';
import { expectRejection } from '../helpers/errors';
import { Ledger } from '@/ledger';
import { recruiterManualEntry } from '@/connectors';
import { EngagementService, MESSAGE_TEMPLATES, PersonalisationGateError, type EvidenceFact } from '@/engagement';

const START = new Date('2026-09-01T09:00:00Z');
type Tx = Parameters<Parameters<Harness['app']['withTenant']>[1]>[0];

async function scaffold(tx: Tx, tenantId: string) {
  const ledger = new Ledger(tx, { type: 'user', id: 'emil' });
  const sourceId = await ledger.registerSource(recruiterManualEntry);
  const evidenceId = await ledger.recordEvidence({
    sourceId, collectionMethod: 'public_evidence', collectedAt: START,
    lawfulBasis: 'publicly_available_exemption', jurisdiction: 'CA', confidence: 0.8,
    citation: 'https://example.org/kubecon-2026-talk',
  });
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

  return { mandateId, personId, prospectId, evidenceId };
}

const evidenceMap = (id: string, over: Partial<EvidenceFact> = {}) =>
  new Map<string, EvidenceFact>([[id, {
    id, live: true, aboutThisPerson: true, citation: 'https://example.org/kubecon-2026-talk', ...over,
  }]]);

/**
 * A hook per token the template actually asks for. Touch two is a
 * `first_email` and touch three a `hiring_leader_followup`, and each names a
 * different bracket: reusing the InMail's hook is exactly the mismatch the gate
 * exists to catch, so the tests must not paper over it.
 */
const hooksFor = (templateCode: string, evidenceId: string) =>
  (MESSAGE_TEMPLATES.find((t) => t.code === templateCode)?.hookTokens ?? []).map((token) => ({
    token,
    value: 'their KubeCon talk on multi-cluster failover',
    evidenceId,
    citation: 'https://example.org/kubecon-2026-talk',
  }));

const goodHook = (evidenceId: string) => hooksFor('first_inmail', evidenceId);

/** Steps of one named sequence, never whatever the tenant happens to hold. */
async function stepsOf(tx: Tx, sequenceId: string) {
  const r = (await tx.execute(sql`
    SELECT id, touch, template_code FROM sequence_steps WHERE sequence_id = ${sequenceId}::uuid ORDER BY touch
  `)) as unknown as { rows: { id: string; touch: number; template_code: string }[] };
  return r.rows;
}

describe('the engagement engine', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Engagement Test')).id;
  });
  afterEach(async () => h?.close());

  const service = (tx: Tx) => new EngagementService(tx, tenant, { id: 'emil' });

  /** Exit criterion: a full sequence schedules. */
  it('schedules five touches on the days the research gives', async () => {
    const steps = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await service(tx).startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
      const r = (await tx.execute(sql`
        SELECT touch, template_code, channel::text AS channel, scheduled_for FROM sequence_steps ORDER BY touch
      `)) as unknown as { rows: { touch: number; template_code: string; channel: string; scheduled_for: string }[] };
      return r.rows;
    });

    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.scheduled_for)).toEqual([
      '2026-09-01', '2026-09-04', '2026-09-08', '2026-09-11', '2026-09-15',
    ]);
    expect(steps.map((s) => s.channel)).toEqual([
      'linkedin_inmail', 'email', 'email', 'voicemail', 'email',
    ]);
  });

  it('refuses a seventh touch, and a sixth without a reason', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await expect(
        service(tx).startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START, touches: 7 }),
      ).rejects.toThrow(/the ceiling is 6/);
      await expect(
        service(tx).startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START, touches: 6 }),
      ).rejects.toThrow(/needs a stated reason/);
    });
  });

  /** Exit criterion: never double queue. */
  it('cannot schedule two live sequences for one prospect', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
      }),
      /duplicate key|unique/i,
      'a second concurrent sequence is how a person receives ten touches politely',
    );
  });

  it('cannot queue two messages against one step', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
          { rows: { id: string }[] }).rows[0]!.id;
        const args = {
          sequenceStepId: stepId, body: 'Hi there, your KubeCon talk stood out.',
          hooks: goodHook(built.evidenceId), evidence: evidenceMap(built.evidenceId),
        };
        await svc.queueMessage(args);
        await svc.queueMessage(args);
      }),
      /duplicate key|unique/i,
      'one message per touch, enforced rather than hoped for',
    );
  });

  /** Exit criterion: a message with no verified hook cannot be queued. */
  it('refuses to queue a message with no verified person specific hook', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
          { rows: { id: string }[] }).rows[0]!.id;
        await svc.queueMessage({ sequenceStepId: stepId, body: 'Hi, are you open to a chat?', hooks: [], evidence: new Map() });
      }),
      /goes back to research/,
      'a generic message must not reach the approval queue',
    );
  });

  it('throws a typed error carrying the verdict, so the interface can show what is missing', async () => {
    let caught: unknown;
    try {
      await h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
          { rows: { id: string }[] }).rows[0]!.id;
        await svc.queueMessage({ sequenceStepId: stepId, body: 'Hi.', hooks: [], evidence: new Map() });
      });
    } catch (error) {
      caught = (error as { cause?: unknown }).cause ?? error;
    }
    const gate = caught instanceof PersonalisationGateError ? caught : null;
    expect(gate?.verdict.missingTokens).toEqual(['specific achievement, talk or program']);
  });

  /** The gate is a property of the database, not only of the service. */
  it('refuses a direct insert into messages, so the gate cannot be bypassed', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        await service(tx).startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
          { rows: { id: string }[] }).rows[0]!.id;
        await tx.execute(sql`
          INSERT INTO messages (tenant_id, sequence_step_id, template_code, channel, body, state)
          VALUES (${tenant}::uuid, ${stepId}::uuid, 'first_inmail', 'linkedin_inmail', 'Generic.', 'awaiting_approval')
        `);
      }),
      /permission denied/i,
      'the gate must not be bypassable by a caller that skips the service',
    );
  });

  it('refuses at the database even when the service is told there is a hook but sends none', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        await service(tx).startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
        const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
          { rows: { id: string }[] }).rows[0]!.id;
        await tx.execute(sql`
          SELECT engagement_queue_message(${stepId}::uuid, 'first_inmail', 'linkedin_inmail'::outreach_channel,
                                          NULL, 'Generic.', true, 0, NULL)`);
      }),
      /personalisation gate/,
      'the database function is the last line, and it holds',
    );
  });

  /** Exit criterion: cancels on a recorded reply. */
  it('stops the sequence on any reply that engages, not only an explicit no', async () => {
    for (const rung of ['agreed_to_conversation', 'keep_me_in_mind', 'explicit_not_interested'] as const) {
      const result = await h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        const { sequenceId } = await svc.startSequence({
          prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
        });
        const stepId = (await stepsOf(tx, sequenceId))[0]!.id;
        await svc.queueMessage({
          sequenceStepId: stepId, body: 'Hi, your KubeCon talk stood out.',
          hooks: goodHook(built.evidenceId), evidence: evidenceMap(built.evidenceId),
        });
        const reply = await svc.recordReply({ prospectId: built.prospectId, rung, receivedAt: START });
        const seq = (await tx.execute(sql`
          SELECT state::text AS state FROM sequences WHERE id = ${sequenceId}::uuid`)) as unknown as
          { rows: { state: string }[] };
        return { reply, state: seq.rows[0]!.state };
      });
      expect(result.state, rung).toBe('cancelled');
      expect(result.reply.cancelledSteps, rung).toBe(1);
      expect(result.reply.action.length, rung).toBeGreaterThan(20);
    }
  });

  it('gives the prescribed action for each rung rather than a bare status', async () => {
    const actions = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      const referral = await svc.recordReply({
        prospectId: built.prospectId, rung: 'referred_a_colleague', receivedAt: START,
      });
      return referral.action;
    });
    expect(actions).toMatch(/Set disposition to Source and chase the referral within 48 hours/);
  });

  it('will not resume a cancelled sequence', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        const svc = service(tx);
        const { sequenceId } = await svc.startSequence({
          prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
        });
        await svc.recordReply({ prospectId: built.prospectId, rung: 'explicit_not_interested', receivedAt: START });
        const step = (await stepsOf(tx, sequenceId))[1]!;
        await svc.queueMessage({
          sequenceStepId: step.id, body: 'Following up on your KubeCon talk.',
          hooks: hooksFor(step.template_code, built.evidenceId), evidence: evidenceMap(built.evidenceId),
        });
      }),
      /cancelled sequence does not resume/,
      'the reply that stopped it is the current state of the relationship',
    );
  });

  /** Exit criterion: the approval edit rate is measured from the first draft. */
  it('measures the approval edit rate from the very first decision', async () => {
    const metrics = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      const { sequenceId } = await svc.startSequence({
        prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
      });
      const steps = await stepsOf(tx, sequenceId);

      const queue = async (step: (typeof steps)[number], body: string) =>
        (await svc.queueMessage({
          sequenceStepId: step.id, body,
          hooks: hooksFor(step.template_code, built.evidenceId), evidence: evidenceMap(built.evidenceId),
        })).messageId;

      const a = await queue(steps[0]!, 'Hi, your KubeCon talk stood out.');
      const b = await queue(steps[1]!, 'Following up on your KubeCon talk.');
      const c = await queue(steps[2]!, 'A note from the hiring leader about your KubeCon talk.');

      await svc.decide({ messageId: a, decision: 'approved', decidedAt: START });
      await svc.decide({ messageId: b, decision: 'edited', finalBody: 'Rewritten entirely.', decidedAt: START });
      await svc.decide({ messageId: c, decision: 'rejected', reason: 'Wrong angle for this person.', decidedAt: START });

      return svc.approvalMetrics();
    });

    expect(metrics.decided).toBe(3);
    expect(metrics.approvedUnchanged).toBe(1);
    expect(metrics.edited).toBe(1);
    expect(metrics.rejected).toBe(1);
    expect(Math.round(metrics.editRate * 100)).toBe(33);
    expect(metrics.statement).toMatch(/3 drafts decided/);
  });

  it('warns when the edit rate says the drafting is theatre', async () => {
    const metrics = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      const { sequenceId } = await svc.startSequence({
        prospectId: built.prospectId, segment: 'senior_executive', startedAt: START,
      });
      const steps = (await stepsOf(tx, sequenceId)).slice(0, 2);
      for (const [i, step] of steps.entries()) {
        const id = (await svc.queueMessage({
          sequenceStepId: step.id, body: `Draft ${i} about your KubeCon talk.`,
          hooks: hooksFor(step.template_code, built.evidenceId), evidence: evidenceMap(built.evidenceId),
        })).messageId;
        await svc.decide({ messageId: id, decision: 'edited', finalBody: `Rewritten ${i}.`, decidedAt: START });
      }
      return svc.approvalMetrics();
    });
    expect(metrics.editRate).toBe(1);
    expect(metrics.statement).toMatch(/the drafting is not doing its job/);
  });

  it('refuses an edit that changed nothing, and a rejection with no reason', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
      const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
        { rows: { id: string }[] }).rows[0]!.id;
      const body = 'Hi, your KubeCon talk stood out.';
      const id = (await svc.queueMessage({
        sequenceStepId: stepId, body, hooks: goodHook(built.evidenceId), evidence: evidenceMap(built.evidenceId),
      })).messageId;

      await expect(svc.decide({ messageId: id, decision: 'edited', finalBody: body, decidedAt: START }))
        .rejects.toThrow(/record it as approved if nothing changed/);
      await expect(svc.decide({ messageId: id, decision: 'rejected', decidedAt: START }))
        .rejects.toThrow(/needs a reason/);
    });
  });

  it('stops at an approved draft: the Pilot Cut relays by hand', async () => {
    const state = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
      const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
        { rows: { id: string }[] }).rows[0]!.id;
      const id = (await svc.queueMessage({
        sequenceStepId: stepId, body: 'Hi, your KubeCon talk stood out.',
        hooks: goodHook(built.evidenceId), evidence: evidenceMap(built.evidenceId),
      })).messageId;
      await svc.decide({ messageId: id, decision: 'approved', decidedAt: START });
      await svc.markRelayed(id);
      const r = (await tx.execute(sql`SELECT state::text AS state FROM messages`)) as unknown as
        { rows: { state: string }[] };
      return r.rows[0]!.state;
    });
    expect(state).toBe('relayed');
  });

  it('records the exploratory call and moves the prospect with it', async () => {
    const after = await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      await service(tx).recordCall({
        prospectId: built.prospectId, heldAt: START, minutes: 30, interestScale: 'yes',
        referralsGiven: 3, disposition: 'candidate', compensationDiscussed: true,
        dominantMotivator: 'Scope and stretch',
      });
      const r = (await tx.execute(sql`
        SELECT interest_scale::text AS i, disposition::text AS d, referrals_given AS ref FROM prospects
      `)) as unknown as { rows: { i: string; d: string; ref: number }[] };
      return r.rows[0]!;
    });
    expect(after).toEqual({ i: 'yes', d: 'candidate', ref: 3 });
  });

  it('refuses a short call that claims compensation was discussed', async () => {
    await expectRejection(
      h.app.withTenant(tenant, async (tx) => {
        const built = await scaffold(tx, tenant);
        await service(tx).recordCall({
          prospectId: built.prospectId, heldAt: START, minutes: 10, interestScale: 'maybe',
          referralsGiven: 0, disposition: 'prospect', compensationDiscussed: true,
        });
      }),
      /leading with\s+money/,
      'pay is raised once the conversation has earned it',
    );
  });

  it('will not let an approval be rewritten', async () => {
    await h.app.withTenant(tenant, async (tx) => {
      const built = await scaffold(tx, tenant);
      const svc = service(tx);
      await svc.startSequence({ prospectId: built.prospectId, segment: 'senior_executive', startedAt: START });
      const stepId = ((await tx.execute(sql`SELECT id FROM sequence_steps WHERE touch = 1`)) as unknown as
        { rows: { id: string }[] }).rows[0]!.id;
      const id = (await svc.queueMessage({
        sequenceStepId: stepId, body: 'Hi, your KubeCon talk stood out.',
        hooks: goodHook(built.evidenceId), evidence: evidenceMap(built.evidenceId),
      })).messageId;
      await svc.decide({ messageId: id, decision: 'edited', finalBody: 'Changed.', decidedAt: START });
    });
    await expectRejection(
      h.app.withTenant(tenant, (tx) => tx.execute(sql`UPDATE approvals SET decision = 'approved'`)),
      /permission denied/i,
      'the approval corpus is the measure of whether the drafting is any good',
    );
  });
});
