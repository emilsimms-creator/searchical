-- Searchical Phase 2: the Receptivity Engine.
--
-- Determines who to approach and when. This is the Candidate Receptivity
-- Scorecard as software, with the event model the spreadsheet could not express.
-- See architecture.md s6.

-- Signal types gain the field that makes the two clocks real: which subject a
-- signal attaches to. An employer trigger attaches to an ORGANIZATION and fans
-- out to everyone tracked there; every other signal attaches to a PERSON.
ALTER TABLE signal_types ADD COLUMN subject_type subject_type NOT NULL DEFAULT 'person';
ALTER TABLE signal_types ADD COLUMN indicates text;
ALTER TABLE signal_types ADD COLUMN window_note text;
ALTER TABLE signal_types ADD COLUMN ordinal integer;

COMMENT ON COLUMN signal_types.recency_window_days IS
  'How long this signal counts for. NOT from the source research, which gives a single 30 day '
  'stacking window and says only that stale signals expire. These per signal lifetimes are practice '
  'defaults and are tenant data to be tuned.';

-- ---------------------------------------------------------------------------
-- The employer watchlist
--
-- Organizations are watched whether or not a mandate against them is open,
-- because the employer clock runs independently of the person clock and a
-- trigger fires before any individual behaviour does. Every target company from
-- every mandate lands here permanently.
-- ---------------------------------------------------------------------------

CREATE TABLE employer_watchlist (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Which mandate first put this employer on the list. Kept for provenance;
  -- the entry outlives the mandate.
  added_from_mandate_id uuid REFERENCES mandates(id) ON DELETE SET NULL,
  reason           text NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, organization_id)
);

CREATE INDEX employer_watchlist_active_idx ON employer_watchlist (tenant_id, active);

-- ---------------------------------------------------------------------------
-- Identity resolution
--
-- People arrive from several sources with partial identifiers. Every merge and
-- split is an audited, reversible event, because a bad merge in a system
-- holding consent records is a compliance incident rather than a data quality
-- annoyance. See architecture.md s6.5.
-- ---------------------------------------------------------------------------

CREATE TYPE identity_kind AS ENUM ('verified_email', 'provider_id', 'profile_url', 'name_employer_window');

CREATE TABLE person_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind         identity_kind NOT NULL,
  -- Normalised: lowercased, trimmed. Hashed by the caller where the raw value
  -- is sensitive.
  value        text NOT NULL,
  confidence   numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_id  uuid NOT NULL REFERENCES evidence(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, value)
);

CREATE TABLE identity_merges (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kept_person_id   uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  merged_person_id uuid NOT NULL,
  confidence    numeric(4,3) NOT NULL,
  method        text NOT NULL,   -- deterministic, heuristic, recruiter_confirmed
  actor_id      text NOT NULL,
  reversed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Prospects: a person considered for a mandate
-- ---------------------------------------------------------------------------

CREATE TYPE interest_scale AS ENUM ('no', 'maybe', 'yes');
CREATE TYPE disposition AS ENUM ('candidate', 'prospect', 'source', 'opted_out');
CREATE TYPE tier AS ENUM ('hot', 'warm', 'cool');

CREATE TABLE prospects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id    uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  owner         text,
  interest_scale interest_scale,
  -- A Source who gives two strong referrals is a successful call at a low
  -- receptivity score, so disposition sits outside the score deliberately.
  disposition   disposition,
  consent_to_stay_in_touch boolean,
  first_contacted_at       timestamptz,
  last_meaningful_touch_at timestamptz,
  referrals_given integer NOT NULL DEFAULT 0,
  -- Factors three to eight, scored by the recruiter from the exploratory call.
  -- One and two are derived and are deliberately absent here.
  f3_buying_cues     integer CHECK (f3_buying_cues BETWEEN 0 AND 5),
  f4_push_factors    integer CHECK (f4_push_factors BETWEEN 0 AND 5),
  f5_motivator_match integer CHECK (f5_motivator_match BETWEEN 0 AND 5),
  f6_timing          integer CHECK (f6_timing BETWEEN 0 AND 5),
  f7_deal_breakers   integer CHECK (f7_deal_breakers BETWEEN 0 AND 5),
  f8_compensation    integer CHECK (f8_compensation BETWEEN 0 AND 5),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, person_id)
);

CREATE INDEX prospects_lookup_idx ON prospects (tenant_id, mandate_id, disposition);

-- ---------------------------------------------------------------------------
-- The scoring model, versioned
--
-- Weights, decay, tiers and cadence are DATA. Changing any of them creates a
-- new version; historical scores keep the version that produced them and are
-- never rewritten. That is what lets a practitioner heuristic be backtested
-- rather than merely believed. See architecture.md s6.4.
-- ---------------------------------------------------------------------------

CREATE TABLE score_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version     text NOT NULL,
  definition  jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT false,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version)
);

-- Exactly one active model per tenant, enforced rather than assumed.
CREATE UNIQUE INDEX score_models_one_active_idx ON score_models (tenant_id) WHERE active;

CREATE TABLE scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id    uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  model_version  text NOT NULL,
  raw_score      numeric(5,1) NOT NULL,
  decayed_score  numeric(5,1) NOT NULL,
  tier           tier NOT NULL,
  next_touch_due_at timestamptz,
  -- Everything needed to answer "why this person, why now" without recomputing
  -- against a model that may since have changed.
  explanation    jsonb NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  -- True when produced by a backtest rather than by live operation, so a replay
  -- can never be mistaken for history.
  is_backtest    boolean NOT NULL DEFAULT false
);

CREATE INDEX scores_prospect_idx ON scores (tenant_id, prospect_id, computed_at DESC);
CREATE INDEX scores_live_idx ON scores (tenant_id, tier, computed_at DESC) WHERE NOT is_backtest;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'employer_watchlist', 'person_identities', 'identity_merges', 'prospects', 'score_models', 'scores'
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

-- Working records may be edited. A score may not: it is an observation of what
-- the model said at a moment, and rewriting one destroys the only thing that
-- makes a model change measurable.
GRANT UPDATE ON employer_watchlist, person_identities, prospects, score_models TO searchical_app;
REVOKE UPDATE, DELETE ON scores, identity_merges FROM searchical_app;

GRANT USAGE, SELECT ON SEQUENCE identity_merges_id_seq TO searchical_app;
