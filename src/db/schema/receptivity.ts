import {
  pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, bigserial, pgEnum, index, unique,
} from 'drizzle-orm/pg-core';
import { evidence, organizations, persons, tenants } from './tables';
import { mandates } from './mandate';

/** Mirrors migrations/0009_receptivity.sql, which is the source of truth. */

export const identityKind = pgEnum('identity_kind', [
  'verified_email', 'provider_id', 'profile_url', 'name_employer_window',
]);
export const interestScale = pgEnum('interest_scale', ['no', 'maybe', 'yes']);
export const disposition = pgEnum('disposition', ['candidate', 'prospect', 'source', 'opted_out']);
export const tier = pgEnum('tier', ['hot', 'warm', 'cool']);

export const employerWatchlist = pgTable('employer_watchlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  addedFromMandateId: uuid('added_from_mandate_id').references(() => mandates.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.organizationId)]);

export const personIdentities = pgTable('person_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  kind: identityKind('kind').notNull(),
  value: text('value').notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.kind, t.value)]);

export const identityMerges = pgTable('identity_merges', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  keptPersonId: uuid('kept_person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  mergedPersonId: uuid('merged_person_id').notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  method: text('method').notNull(),
  actorId: text('actor_id').notNull(),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prospects = pgTable('prospects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  owner: text('owner'),
  interestScale: interestScale('interest_scale'),
  disposition: disposition('disposition'),
  consentToStayInTouch: boolean('consent_to_stay_in_touch'),
  firstContactedAt: timestamp('first_contacted_at', { withTimezone: true }),
  lastMeaningfulTouchAt: timestamp('last_meaningful_touch_at', { withTimezone: true }),
  referralsGiven: integer('referrals_given').notNull().default(0),
  f3BuyingCues: integer('f3_buying_cues'),
  f4PushFactors: integer('f4_push_factors'),
  f5MotivatorMatch: integer('f5_motivator_match'),
  f6Timing: integer('f6_timing'),
  f7DealBreakers: integer('f7_deal_breakers'),
  f8Compensation: integer('f8_compensation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.mandateId, t.personId), index('prospects_lookup_idx').on(t.tenantId, t.mandateId, t.disposition)]);

export const scoreModels = pgTable('score_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  definition: jsonb('definition').notNull(),
  active: boolean('active').notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.version)]);

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  modelVersion: text('model_version').notNull(),
  rawScore: numeric('raw_score', { precision: 5, scale: 1 }).notNull(),
  decayedScore: numeric('decayed_score', { precision: 5, scale: 1 }).notNull(),
  tier: tier('tier').notNull(),
  nextTouchDueAt: timestamp('next_touch_due_at', { withTimezone: true }),
  explanation: jsonb('explanation').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  isBacktest: boolean('is_backtest').notNull().default(false),
});
