import {
  pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, bigserial, pgEnum, index, unique,
} from 'drizzle-orm/pg-core';
import { organizations, persons, tenants } from './tables';

/** Mirrors migrations/0003_mandate.sql, which is the source of truth. */

export const mandateSegment = pgEnum('mandate_segment', ['senior_executive', 'senior_it_consultant']);
export const engagementTypeEnum = pgEnum('engagement_type', ['permanent', 'contract', 'either']);
export const mandateStatus = pgEnum('mandate_status', ['draft', 'awaiting_confirmation', 'live', 'closed']);
export const confidentialityLevel = pgEnum('confidentiality_level', [
  'fully_confidential', 'client_named_at_stage', 'open',
]);
export const termKind = pgEnum('term_kind', ['title_variant', 'must_have_skill', 'exclusion']);
export const termOrigin = pgEnum('term_origin', ['extracted', 'recruiter', 'market_observed']);
export const termStatus = pgEnum('term_status', ['proposed', 'confirmed', 'rejected']);
export const channelPriority = pgEnum('channel_priority', ['primary', 'secondary', 'skip']);
export const targetCompanyKind = pgEnum('target_company_kind', [
  'competitor', 'academy', 'adjacent_sector', 'client_named', 'late_stage',
]);
export const searchStringKind = pgEnum('search_string_kind', [
  'linkedin_recruiter_boolean', 'github_xray', 'conference_talks_xray', 'provider_query',
]);

export const mandates = pgTable('mandates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  segment: mandateSegment('segment').notNull(),
  functionDomain: text('function_domain').notNull(),
  location: text('location'),
  engagementType: engagementTypeEnum('engagement_type').notNull().default('permanent'),
  confidentialityLevel: confidentialityLevel('confidentiality_level').notNull().default('fully_confidential'),
  status: mandateStatus('status').notNull().default('draft'),
  firstYearOutcomes: text('first_year_outcomes'),
  operatingRange: text('operating_range'),
  careerMoveCase: text('career_move_case'),
  sourceDocumentRef: text('source_document_ref'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedBy: text('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (t) => [index('mandates_tenant_status_idx').on(t.tenantId, t.status)]);

export const intakeGaps = pgTable('intake_gaps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  field: text('field').notNull(),
  question: text('question').notNull(),
  answer: text('answer'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mandateTerms = pgTable('mandate_terms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  kind: termKind('kind').notNull(),
  term: text('term').notNull(),
  origin: termOrigin('origin').notNull(),
  status: termStatus('status').notNull().default('proposed'),
  observedCount: integer('observed_count'),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  extractionConfidence: numeric('extraction_confidence', { precision: 4, scale: 3 }),
  rank: integer('rank').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.mandateId, t.kind, t.term)]);

export const targetCompanies = pgTable('target_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  kind: targetCompanyKind('kind').notNull(),
  rationale: text('rationale'),
  watchlisted: boolean('watchlisted').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.mandateId, t.name)]);

export const channelRatings = pgTable('channel_ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  ordinal: integer('ordinal').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  roleInProcess: text('role_in_process').notNull(),
  howExpertsUseIt: text('how_experts_use_it').notNull(),
  etiquette: text('etiquette').notNull(),
  evidenceStrength: text('evidence_strength').notNull(),
  keySource: text('key_source').notNull(),
  fitSeniorExecutive: integer('fit_senior_executive').notNull(),
  fitSeniorItConsultant: integer('fit_senior_it_consultant').notNull(),
  tunedAt: timestamp('tuned_at', { withTimezone: true }),
  tunedReason: text('tuned_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.code)]);

export const channelSelections = pgTable('channel_selections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  channelCode: text('channel_code').notNull(),
  fit: integer('fit').notNull(),
  priority: channelPriority('priority').notNull(),
  reason: text('reason').notNull(),
  owner: text('owner'),
  status: text('status').notNull().default('not_started'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.mandateId, t.channelCode)]);

export const searchStrings = pgTable('search_strings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  kind: searchStringKind('kind').notNull(),
  value: text('value').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pipelineProjections = pgTable('pipeline_projections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  targetConversations: integer('target_conversations').notNull(),
  longListSize: integer('long_list_size').notNull(),
  responseRate: numeric('response_rate', { precision: 4, scale: 3 }).notNull(),
  interestedShare: numeric('interested_share', { precision: 4, scale: 3 }).notNull(),
  touchesPerPerson: integer('touches_per_person').notNull(),
  contactsRequired: integer('contacts_required').notNull(),
  touchesRequired: integer('touches_required').notNull(),
  longListSufficient: boolean('long_list_sufficient').notNull(),
  ratesSource: text('rates_source').notNull(),
  ratesSampleSize: integer('rates_sample_size'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sourceOfHireEvents = pgTable('source_of_hire_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  mandateId: uuid('mandate_id').notNull().references(() => mandates.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'set null' }),
  channelCode: text('channel_code').notNull(),
  stage: text('stage').notNull(),
  detail: jsonb('detail').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
