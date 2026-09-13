-- Searchical Phase 1: the Mandate Engine.
--
-- Turns a job specification into an executable search strategy: the intake, the
-- market vocabulary, the talent universe, the channel plan, the search strings
-- and the pipeline arithmetic. This is the Outreach Channel Matrix workbook
-- expressed as software, plus the intake discipline the workbook assumes but
-- cannot enforce. See architecture.md s5.

CREATE TYPE mandate_segment AS ENUM ('senior_executive', 'senior_it_consultant');

CREATE TYPE engagement_type AS ENUM ('permanent', 'contract', 'either');

-- A mandate is not live until a human has confirmed the market vocabulary.
-- See architecture.md s5.2: this gate is not removable.
CREATE TYPE mandate_status AS ENUM ('draft', 'awaiting_confirmation', 'live', 'closed');

-- How far a generated message may go in naming the client. The executive search
-- profession's standards allow an initial discussion without naming the client
-- at all. See architecture.md s9.4.
CREATE TYPE confidentiality_level AS ENUM ('fully_confidential', 'client_named_at_stage', 'open');

CREATE TYPE term_kind AS ENUM ('title_variant', 'must_have_skill', 'exclusion');

-- Where a term came from. A term proposed by a model and one confirmed by a
-- recruiter are not the same thing and the system never conflates them.
CREATE TYPE term_origin AS ENUM ('extracted', 'recruiter', 'market_observed');

CREATE TYPE term_status AS ENUM ('proposed', 'confirmed', 'rejected');

CREATE TYPE channel_priority AS ENUM ('primary', 'secondary', 'skip');

CREATE TYPE search_string_kind AS ENUM (
  'linkedin_recruiter_boolean',
  'github_xray',
  'conference_talks_xray',
  'provider_query'
);

-- ---------------------------------------------------------------------------
-- Mandates
-- ---------------------------------------------------------------------------

CREATE TABLE mandates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                  text NOT NULL,             -- as the client names it
  segment                mandate_segment NOT NULL,
  function_domain        text NOT NULL,
  location               text,                      -- blank means national or global
  engagement_type        engagement_type NOT NULL DEFAULT 'permanent',
  confidentiality_level  confidentiality_level NOT NULL DEFAULT 'fully_confidential',
  status                 mandate_status NOT NULL DEFAULT 'draft',
  -- The performance based intake. A mandate with an empty career_move_case
  -- produces a sequence that pitches a lateral role, which the research
  -- identifies as a primary reason senior people ignore recruiters.
  first_year_outcomes    text,
  operating_range        text,
  career_move_case       text,
  source_document_ref    text,                      -- object storage pointer to the job spec
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  confirmed_by           text,
  confirmed_at           timestamptz,
  -- A live mandate must carry the human confirmation that made it live.
  CONSTRAINT mandates_live_requires_confirmation CHECK (
    status <> 'live' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX mandates_tenant_status_idx ON mandates (tenant_id, status);

-- Questions the job specification did not answer, put to the hiring leader.
CREATE TABLE intake_gaps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id   uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  field        text NOT NULL,        -- which intake field is unanswered
  question     text NOT NULL,        -- the specific question to ask
  answer       text,
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Market vocabulary
--
-- The hard part of translating a job description into a search is not Boolean
-- syntax, it is market vocabulary. A language model will write an excellent
-- search string for the wrong search. Every proposed term therefore carries its
-- origin, its observed frequency in the target universe, and a status that only
-- a human can move to confirmed. See architecture.md s5.2.
-- ---------------------------------------------------------------------------

CREATE TABLE mandate_terms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id      uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  kind            term_kind NOT NULL,
  term            text NOT NULL,
  origin          term_origin NOT NULL,
  status          term_status NOT NULL DEFAULT 'proposed',
  -- NULL means "not yet checked against the market", which is different from
  -- zero. A zero count is information the recruiter needs, so the term is shown
  -- struck through with its count rather than silently dropped.
  observed_count  integer,
  observed_at     timestamptz,
  extraction_confidence numeric(4,3) CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  rank            integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, kind, term)
);

CREATE INDEX mandate_terms_lookup_idx ON mandate_terms (tenant_id, mandate_id, kind, status);

-- ---------------------------------------------------------------------------
-- Talent universe
-- ---------------------------------------------------------------------------

CREATE TYPE target_company_kind AS ENUM ('competitor', 'academy', 'adjacent_sector', 'client_named', 'late_stage');

CREATE TABLE target_companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id       uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  name             text NOT NULL,
  kind             target_company_kind NOT NULL,
  rationale        text,
  -- Every target company joins the employer watchlist permanently, whether or
  -- not this mandate stays open. See architecture.md s6.1.
  watchlisted      boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, name)
);

-- ---------------------------------------------------------------------------
-- Channel ratings and the channel plan
--
-- Ratings are tenant data, not constants. Phase 4 writes source of hire
-- outcomes back into them so the matrix converges on the practice's own results
-- rather than published industry averages. See architecture.md s5.4.
-- ---------------------------------------------------------------------------

CREATE TABLE channel_ratings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                  text NOT NULL,
  ordinal               integer NOT NULL,
  name                  text NOT NULL,
  category              text NOT NULL,
  role_in_process       text NOT NULL,
  how_experts_use_it    text NOT NULL,
  etiquette             text NOT NULL,
  evidence_strength     text NOT NULL,
  key_source            text NOT NULL,
  fit_senior_executive  integer NOT NULL CHECK (fit_senior_executive BETWEEN 1 AND 5),
  fit_senior_it_consultant integer NOT NULL CHECK (fit_senior_it_consultant BETWEEN 1 AND 5),
  -- Set when phase 4 moves a rating off its seeded value, so the provenance of
  -- the number is never ambiguous.
  tuned_at              timestamptz,
  tuned_reason          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE channel_selections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id     uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  channel_code   text NOT NULL,
  fit            integer NOT NULL,
  priority       channel_priority NOT NULL,
  -- Recorded for skipped channels too: knowing what was deliberately not done
  -- is part of the plan.
  reason         text NOT NULL,
  owner          text,
  status         text NOT NULL DEFAULT 'not_started',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, channel_code)
);

-- ---------------------------------------------------------------------------
-- Generated artefacts
-- ---------------------------------------------------------------------------

CREATE TABLE search_strings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id    uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  kind          search_string_kind NOT NULL,
  value         text NOT NULL,
  -- Which confirmed terms produced this string, so a regenerated string can be
  -- explained rather than just replacing the old one.
  term_ids      uuid[] NOT NULL DEFAULT '{}',
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_strings_mandate_idx ON search_strings (tenant_id, mandate_id, kind, generated_at DESC);

CREATE TABLE pipeline_projections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id           uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  target_conversations integer NOT NULL CHECK (target_conversations > 0),
  long_list_size       integer NOT NULL CHECK (long_list_size >= 0),
  response_rate        numeric(4,3) NOT NULL CHECK (response_rate > 0 AND response_rate <= 1),
  interested_share     numeric(4,3) NOT NULL CHECK (interested_share > 0 AND interested_share <= 1),
  touches_per_person   integer NOT NULL CHECK (touches_per_person BETWEEN 1 AND 6),
  contacts_required    integer NOT NULL,
  touches_required     integer NOT NULL,
  long_list_sufficient boolean NOT NULL,
  -- Whether the rates came from the practice's own history or from the
  -- published defaults, and how many observations stood behind them.
  rates_source         text NOT NULL,
  rates_sample_size    integer,
  generated_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Source of hire instrumentation
--
-- Captured from phase one, reported in phase four. A dashboard over
-- uninstrumented data is decoration, and the value of the historical record is
-- a function of how early it starts. See architecture.md principle 10.
-- ---------------------------------------------------------------------------

CREATE TABLE source_of_hire_events (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id    uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  person_id     uuid REFERENCES persons(id) ON DELETE SET NULL,
  channel_code  text NOT NULL,
  stage         text NOT NULL,   -- identified, contacted, replied, conversation, shortlisted, placed
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX source_of_hire_mandate_idx ON source_of_hire_events (tenant_id, mandate_id, channel_code, stage);

-- ---------------------------------------------------------------------------
-- Security: same posture as everything else
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'mandates', 'intake_gaps', 'mandate_terms', 'target_companies',
    'channel_ratings', 'channel_selections', 'search_strings',
    'pipeline_projections', 'source_of_hire_events'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO searchical_app', t);
  END LOOP;
END
$$;

-- Working documents may be edited. Generated artefacts and the instrumentation
-- record may not: regenerating a search string writes a new row so the old one
-- stays explicable, and a source of hire event is history.
GRANT UPDATE ON mandates, intake_gaps, mandate_terms, target_companies, channel_ratings, channel_selections
  TO searchical_app;

REVOKE UPDATE, DELETE ON search_strings, pipeline_projections, source_of_hire_events FROM searchical_app;

GRANT USAGE, SELECT ON SEQUENCE source_of_hire_events_id_seq TO searchical_app;
