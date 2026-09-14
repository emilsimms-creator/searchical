import {
  pgTable, uuid, text, timestamp, integer, boolean, bigint, numeric, char, pgEnum, index, unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tables';
import { mandates } from './mandate';
import { prospects } from './receptivity';

/** Mirrors migrations/0011_compensation.sql, which is the source of truth. */

export const compensationPeriod = pgEnum('compensation_period', ['annual', 'daily', 'hourly']);
export const compensationFigureKind = pgEnum('compensation_figure_kind', [
  'expectation', 'current_package',
]);

export const mandateCompensation = pgTable('mandate_compensation', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('CAD'),
  period: compensationPeriod('period').notNull().default('annual'),
  baseMinCents: bigint('base_min_cents', { mode: 'bigint' }),
  baseMaxCents: bigint('base_max_cents', { mode: 'bigint' }),
  bonusTargetPct: numeric('bonus_target_pct', { precision: 5, scale: 2 }),
  equityNote: text('equity_note'),
  pensionNote: text('pension_note'),
  otherNote: text('other_note'),
  inferred: boolean('inferred').notNull(),
  sourceQuote: text('source_quote'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  supersededReason: text('superseded_reason'),
}, (t) => ({
  perMandateVersion: unique('mandate_compensation_mandate_id_version_key').on(t.mandateId, t.version),
  lookup: index('mandate_compensation_lookup_idx').on(t.tenantId, t.mandateId),
}));

export const prospectCompensation = pgTable('prospect_compensation', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  figureKind: compensationFigureKind('figure_kind').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('CAD'),
  period: compensationPeriod('period').notNull().default('annual'),
  amountCents: bigint('amount_cents', { mode: 'bigint' }),
  amountMaxCents: bigint('amount_max_cents', { mode: 'bigint' }),
  note: text('note'),
  volunteered: boolean('volunteered').notNull(),
  lawfulBasis: text('lawful_basis'),
  statedAt: timestamp('stated_at', { withTimezone: true }).notNull(),
  recordedBy: text('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  lookup: index('prospect_compensation_lookup_idx').on(t.tenantId, t.prospectId, t.figureKind),
}));
