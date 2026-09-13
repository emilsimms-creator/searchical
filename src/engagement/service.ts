import { eq, sql } from 'drizzle-orm';
import type { TenantTx } from '@/db/client';
import {
  approvals, calls, messageHooks, messages, replies, sequences, sequenceSteps,
} from '@/db/schema';
import { MESSAGE_TEMPLATES } from './templates';
import { SEQUENCE_LIMITS, sequenceFor } from './sequence-plan';
import { checkLength, evaluatePersonalisation, type EvidenceFact } from './personalisation';
import {
  EngagementError, PersonalisationGateError,
  type ApprovalMetrics, type MessageTemplate, type PersonalisationHook, type ReplyRung,
} from './types';
import type { SupportedSegment } from '@/mandate/types';

export interface Actor { readonly id: string }

const DAY_MS = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function templateByCode(code: string): MessageTemplate {
  const found = MESSAGE_TEMPLATES.find((t) => t.code === code);
  if (!found) throw new EngagementError(`unknown template: ${code}`);
  return found;
}

/**
 * Which rungs of the response ladder end a sequence.
 *
 * The distinction the system exists to preserve is between "not interested" and
 * "not actively looking". Almost everyone is the second at some point, so any
 * reply that engages stops the sequence and routes to a conversation rather
 * than being treated as a dead end. Only an explicit no closes the door.
 */
const RUNG_STOPS_SEQUENCE: Readonly<Partial<Record<ReplyRung, string>>> = {
  explicit_not_interested: 'Closed for now. Stop cleanly, thank them, note the date.',
  polite_decline_but_engaged: 'Latent openness. Route to nurture and ask what the ideal opportunity would look like.',
  keep_me_in_mind: 'Warm but timing-gated. Log the timing trigger and schedule the next touch to it.',
  question_about_scope: 'Interested and information-hungry. Answer briefly and move to a 15 minute exploratory call.',
  question_about_compensation: 'Strong early interest. Give a range anchored to track record, then pivot to the career move.',
  agreed_to_conversation: 'Genuine, risk-aware openness. Book it fast and confirm the confidentiality level in writing.',
  referred_a_colleague: 'Low personal openness, high network value. Set disposition to Source and chase the referral within 48 hours.',
};

export class EngagementService {
  readonly #tx: TenantTx;
  readonly #tenantId: string;
  readonly #actor: Actor;

  constructor(tx: TenantTx, tenantId: string, actor: Actor) {
    this.#tx = tx;
    this.#tenantId = tenantId;
    this.#actor = actor;
  }

  /**
   * Schedule the default sequence for a prospect.
   *
   * Five touches by default. A sixth needs a stated reason, and there is no
   * argument that produces a seventh: engagement flattens after stage five and
   * over sequencing irritates candidates and dilutes the brand.
   */
  async startSequence(args: {
    prospectId: string;
    segment: SupportedSegment;
    startedAt: Date;
    touches?: number;
    sixthTouchReason?: string;
  }): Promise<{ sequenceId: string; steps: number }> {
    const touches = args.touches ?? SEQUENCE_LIMITS.defaultTouches;
    if (touches > SEQUENCE_LIMITS.absoluteMaximum) {
      throw new EngagementError(
        `${touches} touches requested; the ceiling is ${SEQUENCE_LIMITS.absoluteMaximum}. ${SEQUENCE_LIMITS.reason}`,
      );
    }
    if (touches === SEQUENCE_LIMITS.absoluteMaximum && !args.sixthTouchReason) {
      throw new EngagementError(
        'the sixth touch is optional and needs a stated reason. Five is the default ceiling because ' +
          'engagement flattens after stage five.',
      );
    }

    const [seq] = await this.#tx
      .insert(sequences)
      .values({
        tenantId: this.#tenantId,
        prospectId: args.prospectId,
        startedAt: args.startedAt,
        createdBy: this.#actor.id,
      })
      .returning({ id: sequences.id });

    const plan = sequenceFor(args.segment).filter((s) => s.touch <= touches);
    await this.#tx.insert(sequenceSteps).values(
      plan.map((step) => ({
        tenantId: this.#tenantId,
        sequenceId: seq!.id,
        touch: step.touch,
        templateCode: step.templateCode,
        channel: step.channel,
        purpose: step.purpose,
        // Scheduled at the earliest permitted day; the recruiter may relay later.
        scheduledFor: isoDate(new Date(args.startedAt.getTime() + step.earliestDay * DAY_MS)),
        optional: step.optional,
      })),
    );

    return { sequenceId: seq!.id, steps: plan.length };
  }

  /**
   * Draft a message into the approval queue.
   *
   * The personalisation gate runs here and refuses rather than degrading. The
   * database refuses too: `messages` cannot be inserted directly, so a message
   * with no hook behind it is not representable even by a caller that skips
   * this method.
   */
  async queueMessage(args: {
    sequenceStepId: string;
    body: string;
    subject?: string;
    hooks: readonly PersonalisationHook[];
    evidence: ReadonlyMap<string, EvidenceFact>;
  }): Promise<{ messageId: string }> {
    const [step] = await this.#tx
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.id, args.sequenceStepId))
      .limit(1);
    if (!step) throw new EngagementError(`sequence step ${args.sequenceStepId} not found in this tenant`);

    const [sequence] = await this.#tx.select().from(sequences).where(eq(sequences.id, step.sequenceId)).limit(1);
    if (sequence?.state !== 'active') {
      throw new EngagementError(
        `this sequence is ${sequence?.state ?? 'missing'}. A cancelled sequence does not resume: the ` +
          `reply that stopped it is the current state of the relationship.`,
      );
    }

    const template = templateByCode(step.templateCode);
    const verdict = evaluatePersonalisation(template, args.hooks, args.evidence);
    if (!verdict.permitted) throw new PersonalisationGateError(verdict);

    const tooLong = checkLength(template, args.body);
    if (tooLong) throw new EngagementError(tooLong);

    const res = (await this.#tx.execute(sql`
      SELECT engagement_queue_message(
        ${args.sequenceStepId}::uuid, ${template.code}, ${template.channel}::outreach_channel,
        ${args.subject ?? null}, ${args.body}, ${template.requiresPersonalEvidence},
        ${verdict.hooks.length}, ${template.sendAs ?? null}
      ) AS id
    `)) as unknown as { rows: { id: string }[] };
    const messageId = res.rows[0]!.id;

    if (verdict.hooks.length > 0) {
      await this.#tx.insert(messageHooks).values(
        verdict.hooks.map((h) => ({
          tenantId: this.#tenantId,
          messageId,
          token: h.token,
          value: h.value,
          evidenceId: h.evidenceId,
          citation: h.citation || args.evidence.get(h.evidenceId)?.citation || '',
        })),
      );
    }

    return { messageId };
  }

  /**
   * A human decides. Accepting, editing and rejecting are all recorded whole,
   * because the corpus of what was accepted and how it was edited is the
   * measure of whether the drafting is real or theatre.
   */
  async decide(args: {
    messageId: string;
    decision: 'approved' | 'edited' | 'rejected';
    finalBody?: string;
    reason?: string;
    decidedAt: Date;
  }): Promise<void> {
    const [message] = await this.#tx.select().from(messages).where(eq(messages.id, args.messageId)).limit(1);
    if (!message) throw new EngagementError(`message ${args.messageId} not found in this tenant`);
    if (message.state !== 'awaiting_approval') {
      throw new EngagementError(`message ${args.messageId} is ${message.state}, not awaiting approval`);
    }
    if (args.decision === 'edited' && (args.finalBody === undefined || args.finalBody === message.body)) {
      throw new EngagementError('an edit must change the body; record it as approved if nothing changed');
    }
    if (args.decision === 'rejected' && !args.reason) {
      throw new EngagementError('a rejection needs a reason: it is the signal that improves the drafting');
    }

    const finalBody = args.decision === 'rejected' ? message.body : args.finalBody ?? message.body;

    await this.#tx.insert(approvals).values({
      tenantId: this.#tenantId,
      messageId: args.messageId,
      decision: args.decision,
      originalBody: message.body,
      finalBody,
      reason: args.reason ?? null,
      decidedBy: this.#actor.id,
      queuedAt: message.createdAt,
      decidedAt: args.decidedAt,
    });

    await this.#tx
      .update(messages)
      .set({ state: args.decision === 'rejected' ? 'rejected' : 'approved', body: finalBody })
      .where(eq(messages.id, args.messageId));
  }

  /** Mark an approved draft as relayed by hand. The Pilot Cut stops here. */
  async markRelayed(messageId: string): Promise<void> {
    const updated = (await this.#tx.execute(sql`
      UPDATE messages SET state = 'relayed'
      WHERE id = ${messageId}::uuid AND state = 'approved'
      RETURNING id
    `)) as unknown as { rows: unknown[] };
    if (updated.rows.length === 0) {
      throw new EngagementError(`message ${messageId} is not approved, so it cannot be relayed`);
    }
  }

  /**
   * Record a reply and stop the sequence.
   *
   * Every rung that engages stops it, not only the explicit no. A person who
   * asks about scope has moved past the sequence, and continuing to send it is
   * the clearest possible signal that nobody is reading.
   */
  async recordReply(args: {
    prospectId: string;
    rung: ReplyRung;
    receivedAt: Date;
    note?: string;
  }): Promise<{ cancelledSteps: number; action: string }> {
    await this.#tx.insert(replies).values({
      tenantId: this.#tenantId,
      prospectId: args.prospectId,
      rung: args.rung,
      receivedAt: args.receivedAt,
      note: args.note ?? null,
      recordedBy: this.#actor.id,
    });

    const action = RUNG_STOPS_SEQUENCE[args.rung]
      ?? 'Unknown: the message may not have landed or resonated. Close politely and revisit on the next employer trigger.';

    if (args.rung === 'silence_after_sequence') {
      return { cancelledSteps: 0, action };
    }

    const cancelled = (await this.#tx.execute(sql`
      UPDATE messages m
      SET state = 'cancelled'
      FROM sequence_steps st JOIN sequences sq ON sq.id = st.sequence_id
      WHERE m.sequence_step_id = st.id
        AND sq.prospect_id = ${args.prospectId}::uuid
        AND sq.state = 'active'
        AND m.state IN ('drafted', 'awaiting_approval', 'approved')
      RETURNING m.id
    `)) as unknown as { rows: unknown[] };

    await this.#tx.execute(sql`
      UPDATE sequences SET state = 'cancelled', cancelled_at = ${args.receivedAt.toISOString()}::timestamptz,
        cancelled_reason = ${`Reply received: ${args.rung}`}
      WHERE prospect_id = ${args.prospectId}::uuid AND state = 'active'
    `);

    return { cancelledSteps: cancelled.rows.length, action };
  }

  /** The exploratory call. Referrals are a required field, not an optional one. */
  async recordCall(args: {
    prospectId: string;
    heldAt: Date;
    minutes: number;
    interestScale: 'no' | 'maybe' | 'yes';
    referralsGiven: number;
    disposition: 'candidate' | 'prospect' | 'source' | 'opted_out';
    pushFactors?: string;
    dominantMotivator?: string;
    timingTrigger?: string;
    dealBreakers?: string;
    compensationDiscussed?: boolean;
    notes?: string;
  }): Promise<void> {
    if (args.minutes < 20 && args.compensationDiscussed) {
      throw new EngagementError(
        'compensation was recorded as discussed in a call shorter than twenty minutes. Pay is raised ' +
          'after about ten minutes at the earliest, once the conversation has earned it: leading with ' +
          'money under-differentiates the approach and selects for the wrong buyers.',
      );
    }

    await this.#tx.insert(calls).values({
      tenantId: this.#tenantId,
      prospectId: args.prospectId,
      heldAt: args.heldAt,
      minutes: args.minutes,
      interestScale: args.interestScale,
      referralsGiven: args.referralsGiven,
      disposition: args.disposition,
      pushFactors: args.pushFactors ?? null,
      dominantMotivator: args.dominantMotivator ?? null,
      timingTrigger: args.timingTrigger ?? null,
      dealBreakers: args.dealBreakers ?? null,
      compensationDiscussed: args.compensationDiscussed ?? false,
      notes: args.notes ?? null,
      recordedBy: this.#actor.id,
    });

    await this.#tx.execute(sql`
      UPDATE prospects
      SET interest_scale = ${args.interestScale}::interest_scale,
          disposition = ${args.disposition}::disposition,
          referrals_given = referrals_given + ${args.referralsGiven},
          last_meaningful_touch_at = ${args.heldAt.toISOString()}::timestamptz,
          updated_at = now()
      WHERE id = ${args.prospectId}::uuid
    `);
  }

  /**
   * The approval edit rate.
   *
   * If recruiters rewrite every draft, the drafting is theatre and this number
   * says so. Measured from the first draft rather than added once the numbers
   * look good.
   */
  async approvalMetrics(): Promise<ApprovalMetrics> {
    const res = (await this.#tx.execute(sql`
      SELECT decision::text AS decision, count(*)::int AS n FROM approvals GROUP BY 1
    `)) as unknown as { rows: { decision: string; n: number }[] };

    const count = (d: string) => res.rows.find((r) => r.decision === d)?.n ?? 0;
    const approvedUnchanged = count('approved');
    const edited = count('edited');
    const rejected = count('rejected');
    const decided = approvedUnchanged + edited + rejected;
    const editRate = decided === 0 ? 0 : edited / decided;
    const rejectRate = decided === 0 ? 0 : rejected / decided;

    return {
      decided, approvedUnchanged, edited, rejected, editRate, rejectRate,
      statement: decided === 0
        ? 'No drafts decided yet.'
        : `${decided} drafts decided: ${approvedUnchanged} sent unchanged, ${edited} edited, ` +
          `${rejected} rejected. Edit rate ${Math.round(editRate * 100)} percent` +
          (editRate > 0.7
            ? '. Above seventy percent means the drafting is not doing its job and the recruiter is writing the message.'
            : '.'),
    };
  }
}

export { RUNG_STOPS_SEQUENCE };
