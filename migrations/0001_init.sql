-- Searchical Phase 0: foundational schema.
--
-- Migrations are hand written and are the source of truth for this schema.
-- The architecture calls for "migrations you can read" because this is an audit
-- heavy system where you must be able to see exactly what runs. The Drizzle
-- schema in src/db/schema mirrors this file for typed queries, and
-- tests/schema-parity.test.ts fails if the two drift apart.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- How a fact reached us. This is not decoration: it decides what may lawfully
-- be done with the fact and which policy rules apply. See architecture.md s8.
CREATE TYPE collection_method AS ENUM (
  'provider_licensed',   -- from a contracted data provider
  'public_evidence',     -- published by or about the person, terms permitting
  'recruiter_entered',   -- typed in by a human, including from a LinkedIn seat
  'candidate_provided',  -- given to us by the person themselves
  'inferred'             -- derived by the system from other facts
);

-- The basis relied on for processing. Recorded per fact, per jurisdiction.
CREATE TYPE lawful_basis AS ENUM (
  'legitimate_interest',
  'consent',
  'contract',
  'legal_obligation',
  'publicly_available_exemption'  -- PIPEDA publicly available information
);

CREATE TYPE subject_type AS ENUM ('person', 'organization');

CREATE TYPE actor_type AS ENUM ('user', 'system', 'connector');

CREATE TYPE signal_category AS ENUM (
  'linkedin_platform',
  'linkedin_behaviour',
  'career_stage',
  'employer_trigger',
  'compensation_cycle',
  'personal',
  'personal_brand',
  'engagement_data',
  'relationship'
);

CREATE TYPE signal_strength AS ENUM ('low', 'medium', 'medium_high', 'high');

-- Canada's anti spam legislation recognises express consent and four implied
-- categories. The category determines the expiry clock. See architecture.md s9.1.
CREATE TYPE consent_basis AS ENUM (
  'express',
  'implied_conspicuous_publication',
  'implied_existing_business_relationship',
  'implied_inquiry',
  'implied_non_business_relationship'
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  region      text NOT NULL DEFAULT 'ca-central-1',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  full_name   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------------------
-- The evidence ledger
--
-- Principle 1: provenance or it does not exist. Nothing factual exists in this
-- system except by pointing at a row in `evidence`. Every fact table below
-- carries a NOT NULL foreign key to it, so a bare fact is not representable.
-- ---------------------------------------------------------------------------

-- A registered origin of facts. Mirrors a Connector in src/connectors.
CREATE TABLE sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id  text NOT NULL,
  display_name  text NOT NULL,
  terms_ref     text NOT NULL,   -- the contract or policy relied on
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, connector_id)
);

CREATE TABLE evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id          uuid NOT NULL REFERENCES sources(id),
  collection_method  collection_method NOT NULL,
  collected_at       timestamptz NOT NULL,
  lawful_basis       lawful_basis NOT NULL,
  jurisdiction       text NOT NULL,          -- ISO 3166 code the basis was assessed under
  confidence         numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  expires_at         timestamptz,            -- NULL means it does not expire by policy
  raw_ref            text,                   -- pointer into object storage
  citation           text,                   -- human readable, e.g. a talk or byline URL
  superseded_by      uuid REFERENCES evidence(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_tenant_source_idx ON evidence (tenant_id, source_id);
CREATE INDEX evidence_expiry_idx ON evidence (tenant_id, expires_at) WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- People and organizations
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  domain      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Set by the forget operation. The row is tombstoned rather than removed so
  -- that the deletion itself remains auditable. See architecture.md s13.3.
  forgotten_at  timestamptz
);

CREATE TABLE employments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id        uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            text NOT NULL,
  started_on       date,
  ended_on         date,
  evidence_id      uuid NOT NULL REFERENCES evidence(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Ordinary descriptive facts about a person.
CREATE TABLE attributes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  evidence_id  uuid NOT NULL REFERENCES evidence(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attributes_person_idx ON attributes (tenant_id, person_id, key);

-- Protected and sensitive grounds live in their own table with their own
-- grants. They may inform timing and prioritisation but are excluded from every
-- scoring input by schema rather than by convention, and every read is logged.
-- See architecture.md s6.2.
CREATE TABLE sensitive_attributes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  evidence_id  uuid NOT NULL REFERENCES evidence(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Signals
--
-- Principle 2: signals are immutable events; scores are derivations. A
-- contradicting observation is a new row, never an update. The two clocks in
-- architecture.md s6.1 are this table filtered by subject_type.
-- ---------------------------------------------------------------------------

CREATE TABLE signal_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                 text NOT NULL,
  label                text NOT NULL,
  category             signal_category NOT NULL,
  strength             signal_strength NOT NULL,
  points               integer NOT NULL,
  recency_window_days  integer NOT NULL,
  source_citation      text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_type    subject_type NOT NULL,
  subject_id      uuid NOT NULL,
  signal_type_id  uuid NOT NULL REFERENCES signal_types(id),
  observed_at     timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  evidence_id     uuid NOT NULL REFERENCES evidence(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signals_subject_idx ON signals (tenant_id, subject_type, subject_id, observed_at DESC);
CREATE INDEX signals_live_idx ON signals (tenant_id, expires_at);

-- ---------------------------------------------------------------------------
-- Consent and suppression
-- ---------------------------------------------------------------------------

CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  basis        consent_basis NOT NULL,
  captured_at  timestamptz NOT NULL,
  expires_at   timestamptz,
  evidence_id  uuid NOT NULL REFERENCES evidence(id),
  -- The three conditions that must hold together for implied consent through
  -- conspicuous publication. Recorded individually because the burden of proof
  -- sits with the sender. See architecture.md s9.1.
  cp_published_by_subject  boolean,
  cp_no_refusal_notice     boolean,
  cp_relevant_to_role      boolean,
  source_url               text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- If the basis is conspicuous publication, all three conditions and the
  -- source URL must be recorded. The database will not accept a half answer.
  CONSTRAINT consents_conspicuous_publication_complete CHECK (
    basis <> 'implied_conspicuous_publication' OR (
      cp_published_by_subject IS NOT NULL AND
      cp_no_refusal_notice    IS NOT NULL AND
      cp_relevant_to_role     IS NOT NULL AND
      source_url              IS NOT NULL
    )
  )
);

CREATE INDEX consents_person_idx ON consents (tenant_id, person_id, basis);

-- Suppression deliberately outlives the person record and holds no personal
-- data. A person who asks to be forgotten leaves a hashed identifier here so
-- that re-acquisition from a data provider next month is caught and blocked
-- rather than quietly starting the relationship over.
--
-- This table must never be cascaded away by a delete, which is why it has no
-- foreign key to persons.
CREATE TABLE suppressions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_hash   text NOT NULL,     -- SHA-256 of the normalised identifier
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_hash)
);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type   actor_type NOT NULL,
  actor_id     text NOT NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (tenant_id, entity_type, entity_id);
