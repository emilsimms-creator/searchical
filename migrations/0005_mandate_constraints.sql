-- Searchical: mandate constraints.
--
-- Found by running a real Senior Database Administrator specification through
-- the Mandate Engine. The engine handled the role correctly and then lost every
-- one of six hard constraints, because the mandate model had nowhere to put a
-- requirement that is not a search term:
--
--   eligible to obtain Secret clearance
--   priority to Canadian citizens and permanent residents
--   no relocation assistance
--   on site 12 days per month, within commuting distance of an unnamed office
--   on-call rotation required
--   English or French essential
--
-- These are not decoration. Three consequences follow from losing them.
--
-- First, the pipeline arithmetic silently overstates the addressable market.
-- The published default rates were measured on unconstrained senior searches; a
-- clearance requirement plus a commuting radius is a different market, and a
-- long list sized as if it were not is too small.
--
-- Second, the sequence wastes its scarce capacity. Nothing stopped a recruiter
-- running five touches at someone who cannot obtain clearance or will not
-- commute, which is precisely the capacity the system exists to protect.
--
-- Third, it contradicts the scoring model. Factor 7 of the receptivity score is
-- freedom from deal-breakers, and a deal-breaker is a property of the mandate.
-- Phase 2 would have had nothing to score factor 7 against.

CREATE TYPE constraint_kind AS ENUM (
  'security_clearance',
  'citizenship_or_status',
  'location_or_onsite',
  'schedule',          -- on-call, shift work, travel cadence
  'language',
  'licence_or_credential',
  'travel',
  'other'
);

-- How hard the constraint is. Only `disqualifying` removes people from the
-- addressable market; the others shape the conversation rather than the map.
CREATE TYPE constraint_severity AS ENUM ('disqualifying', 'strong_preference', 'nice_to_have');

CREATE TABLE mandate_constraints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id    uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  kind          constraint_kind NOT NULL,
  severity      constraint_severity NOT NULL,
  statement     text NOT NULL,
  -- The words from the specification that established it, so a recruiter can
  -- check the constraint against the source rather than trusting a paraphrase.
  source_quote  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mandate_id, kind, statement)
);

CREATE INDEX mandate_constraints_lookup_idx
  ON mandate_constraints (tenant_id, mandate_id, severity);

ALTER TABLE mandate_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandate_constraints FORCE ROW LEVEL SECURITY;
CREATE POLICY mandate_constraints_tenant_isolation ON mandate_constraints
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON mandate_constraints TO searchical_app;
