import {
  pgTable, uuid, text, timestamp, numeric, integer, boolean, date, jsonb, bigserial, index, unique,
} from 'drizzle-orm/pg-core';
import {
  actorType, collectionMethod, consentBasis, lawfulBasis, signalCategory, signalStrength, subjectType,
} from './enums';

/**
 * These definitions mirror migrations/0001_init.sql, which is the source of
 * truth. tests/schema-parity.test.ts fails if the two drift apart.
 */

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  region: text('region').notNull().default('ca-central-1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.email)]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  connectorId: text('connector_id').notNull(),
  displayName: text('display_name').notNull(),
  termsRef: text('terms_ref').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.connectorId)]);

export const evidence = pgTable('evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => sources.id),
  collectionMethod: collectionMethod('collection_method').notNull(),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull(),
  lawfulBasis: lawfulBasis('lawful_basis').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  rawRef: text('raw_ref'),
  citation: text('citation'),
  supersededBy: uuid('superseded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  domain: text('domain'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  forgottenAt: timestamp('forgotten_at', { withTimezone: true }),
});

export const employments = pgTable('employments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startedOn: date('started_on'),
  endedOn: date('ended_on'),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attributes = pgTable('attributes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('attributes_person_idx').on(t.tenantId, t.personId, t.key)]);

export const sensitiveAttributes = pgTable('sensitive_attributes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const signalTypes = pgTable('signal_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  label: text('label').notNull(),
  category: signalCategory('category').notNull(),
  strength: signalStrength('strength').notNull(),
  points: integer('points').notNull(),
  recencyWindowDays: integer('recency_window_days').notNull(),
  sourceCitation: text('source_citation').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.code)]);

export const signals = pgTable('signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subjectType: subjectType('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  signalTypeId: uuid('signal_type_id').notNull().references(() => signalTypes.id),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  basis: consentBasis('basis').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  evidenceId: uuid('evidence_id').notNull().references(() => evidence.id),
  cpPublishedBySubject: boolean('cp_published_by_subject'),
  cpNoRefusalNotice: boolean('cp_no_refusal_notice'),
  cpRelevantToRole: boolean('cp_relevant_to_role'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  subjectHash: text('subject_hash').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.subjectHash)]);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  actorType: actorType('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  detail: jsonb('detail').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
