-- Searchical: who is off limits for a mandate, recorded before any names are worked.
--
-- Found on the Algonquin College Network Designer search. The domain pack named
-- cabling contractors as the likeliest source of candidates and, in the same
-- breath, the class most exposed to a non solicit, because the client's own
-- cabling vendors are in it. The operator put the question to the client and
-- the answer was a single vendor, FCI. Until now that answer had nowhere to go
-- except a sentence in a document, so nothing stopped a screen from advancing
-- somebody who works there.
--
-- Off limits is a fact about a mandate, and it outlives the person who knew it.
-- This table holds it. Nothing is ever deleted or renamed: an entry is lifted,
-- with who lifted it and why, because "we approached them after the client said
-- no" and "we approached them after the client lifted the restriction" must stay
-- distinguishable years later.

CREATE TABLE mandate_off_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id   uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  -- The organisation, as the client named it.
  name         text NOT NULL,
  -- Other names it goes by, recorded only once somebody has confirmed they are
  -- the same organisation. A guess here is a wrong exclusion in both directions.
  aliases      text[] NOT NULL DEFAULT '{}',
  basis        text NOT NULL,
  -- Who said so, and when. Never blank, because an exclusion nobody can trace
  -- is one nobody will dare lift.
  source       text NOT NULL,
  recorded_by  text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at    timestamptz,
  lifted_by    text,
  lifted_reason text,
  CONSTRAINT off_limits_name_substantive CHECK (char_length(btrim(name)) >= 2),
  CONSTRAINT off_limits_basis_known CHECK (basis IN ('client_vendor', 'client_staff', 'non_solicit', 'other')),
  CONSTRAINT off_limits_source_substantive CHECK (char_length(btrim(source)) >= 10),
  CONSTRAINT off_limits_lift_complete CHECK (
    (lifted_at IS NULL AND lifted_by IS NULL AND lifted_reason IS NULL)
    OR (lifted_at IS NOT NULL AND lifted_by IS NOT NULL AND char_length(btrim(lifted_reason)) >= 20)
  )
);

-- One live entry per organisation per mandate, however it is capitalised.
CREATE UNIQUE INDEX mandate_off_limits_one_active
  ON mandate_off_limits (mandate_id, lower(btrim(name))) WHERE lifted_at IS NULL;

ALTER TABLE mandate_off_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandate_off_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY mandate_off_limits_tenant_isolation ON mandate_off_limits
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON mandate_off_limits TO searchical_app;
-- The only thing that may change on a recorded entry is that it was lifted.
GRANT UPDATE (lifted_at, lifted_by, lifted_reason) ON mandate_off_limits TO searchical_app;
