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
  type ApprovalMetrics, type MessageDetail, type MessageTemplate, type PersonalisationHook,
  type QueueItem, type ReplyRung,
} from './types';
import type { SupportedSegment } from '@/mandate/types';

interface QueueRow {
  id: string; body: string; template_code: string; channel: string; created_at: string;
  touch: number; scheduled_for: string; prospect_id: string; display_name: string;
  mandate_id: string; title: string; hooks: number;
}

const toQueueItem = (r: QueueRow): QueueItem => ({
  messageId: r.id,
  prospectId: r.prospect_id,
  personName: r.display_name,
  mandateId: r.mandate_id,
  mandateTitle: r.title,
  touch: r.touch,
  templateCode: r.template_code,
  channel: r.channel,
  scheduledFor: r.scheduled_for,
  body: r.body,
  hookCount: r.hooks,
  queuedAt: new Date(r.created_at),
});

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
    // The mirror of the rule above, and the one an interface makes reachable.
    // An approval queue puts the draft in an editable box, so an operator can
    // change the words and click Approve. Recorded as approved, that edit
    // vanishes from the only metric that says whether the drafting is worth
    // keeping. The decision follows the text, not the button.
    if (args.decision === 'approved' && args.finalBody !== undefined && args.finalBody !== message.body) {
      throw new EngagementError(
        'this approval changed the body, so it is an edit. Recording it as approved understates ' +
        'the edit rate, which is the measure of whether the drafting is doing its job',
      );
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
  /**
   * Everything waiting on a human, oldest first.
   *
   * Oldest first rather than by score or by mandate, deliberately: a draft that
   * has sat in the queue longest is the one whose scheduled day is closest to
   * passing, and a sequence whose touch three goes out a week late is no longer
   * the sequence the research supports.
   */
  async pendingQueue(): Promise<QueueItem[]> {
    const res = (await this.#tx.execute(sql`
      SELECT m.id, m.body, m.template_code, m.channel::text AS channel, m.created_at,
             st.touch, st.scheduled_for,
             p.id AS prospect_id, pe.display_name, ma.id AS mandate_id, ma.title,
             (SELECT count(*)::int FROM message_hooks h WHERE h.message_id = m.id) AS hooks
        FROM messages m
        JOIN sequence_steps st ON st.id = m.sequence_step_id
        JOIN sequences s ON s.id = st.sequence_id
        JOIN prospects p ON p.id = s.prospect_id
        JOIN persons pe ON pe.id = p.person_id
        JOIN mandates ma ON ma.id = p.mandate_id
       WHERE m.state = 'awaiting_approval' AND s.state = 'active'
       ORDER BY m.created_at ASC
    `)) as unknown as { rows: Record<string, never>[] };
    return (res.rows as unknown as QueueRow[]).map(toQueueItem);
  }

  /**
   * One draft with the evidence it rests on, so the approver is reading the
   * claim and its source together rather than trusting a sentence.
   */
  async messageDetail(messageId: string): Promise<MessageDetail | null> {
    const res = (await this.#tx.execute(sql`
      SELECT m.id, m.body, m.subject, m.template_code, m.channel::text AS channel, m.created_at,
             st.touch, st.scheduled_for, st.purpose,
             p.id AS prospect_id, pe.display_name, ma.id AS mandate_id, ma.title,
             (SELECT count(*)::int FROM message_hooks h WHERE h.message_id = m.id) AS hooks,
             (SELECT count(*)::int FROM sequence_steps x WHERE x.sequence_id = s.id) AS touches
        FROM messages m
        JOIN sequence_steps st ON st.id = m.sequence_step_id
        JOIN sequences s ON s.id = st.sequence_id
        JOIN prospects p ON p.id = s.prospect_id
        JOIN persons pe ON pe.id = p.person_id
        JOIN mandates ma ON ma.id = p.mandate_id
       WHERE m.id = ${messageId}::uuid
    `)) as unknown as {
      rows: (QueueRow & { subject: string | null; touches: number; purpose: string })[];
    };
    const row = res.rows[0];
    if (!row) return null;

    const hookRows = (await this.#tx.execute(sql`
      SELECT h.token, h.value, h.citation, e.collected_at, e.expires_at
        FROM message_hooks h
        JOIN evidence e ON e.id = h.evidence_id
       WHERE h.message_id = ${messageId}::uuid
       ORDER BY h.token
    `)) as unknown as {
      rows: { token: string; value: string; citation: string; collected_at: string; expires_at: string | null }[];
    };

    const priorRows = (await this.#tx.execute(sql`
      SELECT st.touch, a.decision::text AS decision, a.decided_at
        FROM approvals a
        JOIN messages m2 ON m2.id = a.message_id
        JOIN sequence_steps st ON st.id = m2.sequence_step_id
        JOIN sequences s2 ON s2.id = st.sequence_id
        JOIN prospects p2 ON p2.id = s2.prospect_id
       WHERE p2.id = ${row.prospect_id}::uuid
       ORDER BY st.touch
    `)) as unknown as { rows: { touch: number; decision: string; decided_at: string }[] };

    const template = templateByCode(row.template_code);
    const now = Date.now();
    return {
      ...toQueueItem(row),
      subject: row.subject,
      // The step's purpose says what THIS touch is for; the template's principles
      // say what the wording rests on. An approver reading a draft without both
      // is judging prose rather than a decision.
      templatePurpose: row.purpose,
      templateEvidence: template.appliesPrinciples,
      sequenceTouches: row.touches,
      hooks: hookRows.rows.map((h) => ({
        token: h.token,
        value: h.value,
        citation: h.citation,
        // Expiry is what makes a hook stale. A talk from four years ago cited
        // as "recently" is the sentence that ends the conversation.
        evidenceLive: h.expires_at === null || new Date(h.expires_at).getTime() > now,
        collectedAt: new Date(h.collected_at),
      })),
      priorDecisions: priorRows.rows.map((r) => ({
        touch: r.touch, decision: r.decision, decidedAt: new Date(r.decided_at),
      })),
    };
  }

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
