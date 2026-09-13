import {
  pgTable, uuid, text, timestamp, integer, boolean, date, pgEnum, index, unique,
} from 'drizzle-orm/pg-core';
import { evidence, tenants } from './tables';
import { prospects, interestScale, disposition } from './receptivity';

/** Mirrors migrations/0010_engagement.sql, which is the source of truth. */

export const outreachChannel = pgEnum('outreach_channel', [
  'linkedin_connection', 'linkedin_inmail', 'email', 'phone', 'voicemail', 'referral',
]);
export const sequenceState = pgEnum('sequence_state', ['active', 'completed', 'cancelled']);
export const messageState = pgEnum('message_state', [
  'drafted', 'blocked', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'relayed',
]);
export const approvalDecision = pgEnum('approval_decision', ['approved', 'edited', 'rejected']);
export const replyRung = pgEnum('reply_rung', [
  'explicit_not_interested', 'silence_after_sequence', 'polite_decline_but_engaged',
  'keep_me_in_mind', 'question_about_scope', 'question_about_compensation',
  'agreed_to_conversation', 'referred_a_colleague',
]);

export const sequences = pgTable('sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  state: sequenceState('state').notNull().default('active'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledReason: text('cancelled_reason'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sequenceSteps = pgTable('sequence_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sequenceId: uuid('sequence_id').notNull().references(() => sequences.id, { onDelete: 'cascade' }),
  touch: integer('touch').notNull(),
  templateCode: text('template_code').notNull(),
  channel: outreachChannel('channel').notNull(),
  purpose: text('purpose').notNull(),
  scheduledFor: date('scheduled_for').notNull(),
  optional: boolean('optional').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.sequenceId, t.touch)]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sequenceStepId: uuid('sequence_step_id').notNull().references(() => sequenceSteps.id, { onDelete: 'cascade' }),
  templateCode: text('template_code').notNull(),
  channel: outreachChannel('channel').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  state: messageState('state').notNull().default('drafted'),
  blockedReason: text('blocked_reason'),
  sendsAs: text('sends_as'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.sequenceStepId)]);

export const messageHooks = pgTable('message_hooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  value: text('value').notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  citation: text('citation').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.messageId, t.token)]);

export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  decision: approvalDecision('decision').notNull(),
  originalBody: text('original_body').notNull(),
  finalBody: text('final_body').notNull(),
  reason: text('reason'),
  decidedBy: text('decided_by').notNull(),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.messageId), index('approvals_metrics_idx').on(t.tenantId, t.decision, t.decidedAt)]);

export const replies = pgTable('replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  rung: replyRung('rung').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  note: text('note'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable('calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  heldAt: timestamp('held_at', { withTimezone: true }).notNull(),
  minutes: integer('minutes'),
  interestScale: interestScale('interest_scale'),
  pushFactors: text('push_factors'),
  dominantMotivator: text('dominant_motivator'),
  timingTrigger: text('timing_trigger'),
  dealBreakers: text('deal_breakers'),
  referralsGiven: integer('referrals_given').notNull().default(0),
  compensationDiscussed: boolean('compensation_discussed').notNull().default(false),
  disposition: disposition('disposition'),
  notes: text('notes'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
