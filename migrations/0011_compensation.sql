-- Searchical: compensation.
--
-- Three places in this system already refer to a compensation band that does
-- not exist:
--
--   1. Factor 8 of the receptivity scoring model is "Compensation openness and
--      fit", worth five points, and there is nothing to score it against.
--   2. calls.compensation_discussed is a boolean with no figure behind it, so
--      the system knows pay was raised and not whether it landed.
--   3. The intake gaps never ask for a band, so a search can run to offer
--      before anyone discovers the number does not work.
--
-- The third is the expensive one. A search that dies at offer on a number that
-- was knowable at intake has burned the whole sequence budget, the client's
-- patience and the candidate's goodwill, and it is the single most common way a
-- senior search fails late.
--
-- Currency is CAD by default and stored explicitly on every row. The practice
-- quotes Canadian dollars; the system identifies talent globally, so a person's
-- expectation may well arrive in another currency and a band that assumes its
-- own units is a band that will eventually be compared against the wrong one.
--
-- Money is stored in cents as bigint. Never a float: 0.1 + 0.2 is not 0.3, and
-- a rounding error in a compensation band is an error a candidate notices.

CREATE TYPE compensation_period AS ENUM ('annual', 'daily', 'hourly');

-- What a recorded figure IS. The distinction is legal, not cosmetic: British
-- Columbia's Pay Transparency Act and Prince Edward Island's Employment
-- Standards Act both prohibit employers from asking an applicant what previous
-- employers paid them. Whether a third party search firm acting as the
-- employer's agent is caught by those provisions is a question for counsel and
-- is NOT resolved here. The system takes the conservative reading: it records
-- what a person says they want, refuses to hold what they are currently paid
-- unless a lawful basis is recorded against it, and makes the difference
-- visible in the schema so the question can be answered rather than assumed.
CREATE TYPE compensation_figure_kind AS ENUM ('expectation', 'current_package');

-- ---------------------------------------------------------------------------
-- The mandate band
--
-- Versioned rather than edited. A band gets revised mid search more often than
-- any other field on a mandate, and a silent overwrite destroys the answer to
-- the only question that matters afterwards: what were we telling candidates in
-- week two? One live version per mandate, enforced by a partial unique index,
-- exactly as score_models and sequences do it.
-- ---------------------------------------------------------------------------
CREATE TABLE mandate_compensation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id          uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  version             integer NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'CAD',
  period              compensation_period NOT NULL DEFAULT 'annual',

  base_min_cents      bigint,
  base_max_cents      bigint,
  -- Executives are quoted a bonus as a percentage of base; contractors are not
  -- quoted one at all. Both nullable, and both meaningless without a base.
  bonus_target_pct    numeric(5,2),
  -- Long term incentive, units, options, carry. Rarely a number at intake and
  -- almost never one the client will commit to in writing, so it is prose.
  equity_note         text,
  -- Deliberately its own field rather than a line in equity_note. A defined
  -- benefit pension is a material part of total reward at exactly the kind of
  -- Canadian employer this practice recruits for, the Bank of Canada, NAV
  -- CANADA, Hydro One, the provincial Crowns, and a base salary compared
  -- against a private sector band without it is a comparison that misleads the
  -- candidate and the recruiter in the same direction.
  pension_note        text,
  other_note          text,

  -- Provenance, the same contract the mandate constraints carry.
  inferred            boolean NOT NULL,
  source_quote        text,

  -- A band is a proposal until the hiring leader confirms it, for the same
  -- reason the market vocabulary is. A specification's stated range is often
  -- stale, often the posting range rather than the real one, and is in any case
  -- the client's to stand behind rather than ours to quote on their behalf.
  confirmed_by        text,
  confirmed_at        timestamptz,

  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz,
  superseded_reason   text,

  UNIQUE (mandate_id, version),

  -- A range that runs backwards is not a range.
  CONSTRAINT mandate_compensation_range_ordered CHECK (
    base_min_cents IS NULL OR base_max_cents IS NULL OR base_max_cents >= base_min_cents
  ),
  CONSTRAINT mandate_compensation_non_negative CHECK (
    COALESCE(base_min_cents, 0) >= 0 AND COALESCE(base_max_cents, 0) >= 0
    AND COALESCE(bonus_target_pct, 0) >= 0
  ),
  -- A band with no base and no prose says nothing. Refuse the empty row rather
  -- than let a mandate look as though it has a band when it does not.
  CONSTRAINT mandate_compensation_says_something CHECK (
    base_min_cents IS NOT NULL OR base_max_cents IS NOT NULL
    OR equity_note IS NOT NULL OR pension_note IS NOT NULL OR other_note IS NOT NULL
  ),
  -- An inferred band is a guess about the market. It may inform a conversation
  -- with the client; it must never be presented as the client's number, so it
  -- cannot be confirmed without a human replacing it with a stated one.
  CONSTRAINT mandate_compensation_inferred_not_confirmable CHECK (
    NOT (inferred AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT mandate_compensation_confirmation_complete CHECK (
    (confirmed_by IS NULL) = (confirmed_at IS NULL)
  )
);

CREATE UNIQUE INDEX mandate_compensation_one_live_idx
  ON mandate_compensation (mandate_id) WHERE superseded_at IS NULL;
CREATE INDEX mandate_compensation_lookup_idx ON mandate_compensation (tenant_id, mandate_id);

-- ---------------------------------------------------------------------------
-- The prospect's number
--
-- Held against the prospect rather than the person, because an expectation is
-- stated for a particular role and does not travel: the same person will name a
-- different figure for a different job, and carrying one search's number into
-- the next is how a recruiter talks a candidate down without meaning to.
-- ---------------------------------------------------------------------------
CREATE TABLE prospect_compensation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prospect_id    uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  figure_kind    compensation_figure_kind NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'CAD',
  period         compensation_period NOT NULL DEFAULT 'annual',
  amount_cents   bigint,
  amount_max_cents bigint,
  note           text,
  -- Volunteered, or asked for. Only the person's own volunteered figure is
  -- safe ground under the pay transparency statutes, and a system that cannot
  -- tell the two apart cannot demonstrate which it did.
  volunteered    boolean NOT NULL,
  -- Required when figure_kind is current_package: the reason it is lawful to
  -- hold this, in this jurisdiction, for this person.
  lawful_basis   text,
  stated_at      timestamptz NOT NULL,
  recorded_by    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prospect_compensation_range_ordered CHECK (
    amount_cents IS NULL OR amount_max_cents IS NULL OR amount_max_cents >= amount_cents
  ),
  CONSTRAINT prospect_compensation_non_negative CHECK (
    COALESCE(amount_cents, 0) >= 0 AND COALESCE(amount_max_cents, 0) >= 0
  ),
  -- Pay history is held only on a recorded basis, and only where the person
  -- offered it. The check is the conservative reading described above.
  CONSTRAINT prospect_compensation_history_needs_basis CHECK (
    figure_kind <> 'current_package' OR (volunteered AND lawful_basis IS NOT NULL)
  )
);

CREATE INDEX prospect_compensation_lookup_idx
  ON prospect_compensation (tenant_id, prospect_id, figure_kind);

-- The call already records that compensation was discussed. Point it at the
-- figure that came out of the discussion, so the boolean stops being the whole
-- of what the system knows.
ALTER TABLE calls ADD COLUMN compensation_figure_id uuid REFERENCES prospect_compensation(id);

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
ALTER TABLE mandate_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandate_compensation FORCE ROW LEVEL SECURITY;
CREATE POLICY mandate_compensation_tenant_isolation ON mandate_compensation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE prospect_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_compensation FORCE ROW LEVEL SECURITY;
CREATE POLICY prospect_compensation_tenant_isolation ON prospect_compensation
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A band version is a record of what the practice was telling the market at a
-- point in time. It is superseded, never rewritten, and never deleted: UPDATE
-- is granted only so a version can be retired and confirmed, and the trigger
-- below holds everything else immutable.
-- INSERT is withheld deliberately. compensation_record_band() below is the only
-- way a band comes into existence, so the supersede and the insert happen in one
-- statement and a caller cannot leave two live versions behind by forgetting the
-- first half. UPDATE is granted for the confirmation and the supersede only, and
-- the trigger above holds every figure immutable.
GRANT SELECT, UPDATE ON mandate_compensation TO searchical_app;
GRANT SELECT, INSERT ON prospect_compensation TO searchical_app;

CREATE OR REPLACE FUNCTION mandate_compensation_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'this compensation version is superseded. A superseded band is the record of '
                    'what candidates were told at the time; supersede the live version with a new '
                    'one instead of editing history';
  END IF;
  IF NEW.base_min_cents   IS DISTINCT FROM OLD.base_min_cents
  OR NEW.base_max_cents   IS DISTINCT FROM OLD.base_max_cents
  OR NEW.bonus_target_pct IS DISTINCT FROM OLD.bonus_target_pct
  OR NEW.currency         IS DISTINCT FROM OLD.currency
  OR NEW.period           IS DISTINCT FROM OLD.period
  OR NEW.equity_note      IS DISTINCT FROM OLD.equity_note
  OR NEW.pension_note     IS DISTINCT FROM OLD.pension_note
  OR NEW.inferred         IS DISTINCT FROM OLD.inferred
  OR NEW.source_quote     IS DISTINCT FROM OLD.source_quote
  OR NEW.version          IS DISTINCT FROM OLD.version
  OR NEW.mandate_id       IS DISTINCT FROM OLD.mandate_id THEN
    RAISE EXCEPTION 'a compensation band is versioned, not edited. Supersede this version and '
                    'record a new one, so the band quoted in week two survives the revision in '
                    'week six';
  END IF;
  IF OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'this band is already confirmed. A confirmation is the client standing behind '
                    'a number and cannot be reassigned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mandate_compensation_immutable_trg
  BEFORE UPDATE ON mandate_compensation
  FOR EACH ROW EXECUTE FUNCTION mandate_compensation_immutable();

-- ---------------------------------------------------------------------------
-- The write path
-- ---------------------------------------------------------------------------

-- Supersede the live version and record the next one, atomically. Two live
-- bands for one mandate means two different numbers in two recruiters' mouths.
CREATE OR REPLACE FUNCTION compensation_record_band(
  p_mandate_id       uuid,
  p_currency         char(3),
  p_period           compensation_period,
  p_base_min_cents   bigint,
  p_base_max_cents   bigint,
  p_bonus_target_pct numeric,
  p_equity_note      text,
  p_pension_note     text,
  p_other_note       text,
  p_inferred         boolean,
  p_source_quote     text,
  p_actor            text,
  p_reason           text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant  uuid := current_tenant();
  v_version integer;
  v_id      uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mandates WHERE id = p_mandate_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'mandate % is not in this tenant', p_mandate_id;
  END IF;

  UPDATE mandate_compensation
     SET superseded_at = now(), superseded_reason = p_reason
   WHERE mandate_id = p_mandate_id AND tenant_id = v_tenant AND superseded_at IS NULL;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM mandate_compensation WHERE mandate_id = p_mandate_id AND tenant_id = v_tenant;

  INSERT INTO mandate_compensation (
    tenant_id, mandate_id, version, currency, period,
    base_min_cents, base_max_cents, bonus_target_pct,
    equity_note, pension_note, other_note, inferred, source_quote, created_by
  ) VALUES (
    v_tenant, p_mandate_id, v_version, COALESCE(p_currency, 'CAD'), COALESCE(p_period, 'annual'),
    p_base_min_cents, p_base_max_cents, p_bonus_target_pct,
    p_equity_note, p_pension_note, p_other_note, p_inferred, p_source_quote, p_actor
  ) RETURNING id INTO v_id;

  PERFORM audit_write('user'::actor_type, p_actor, 'record_band', 'mandate_compensation',
                      v_id::text,
                      jsonb_build_object('version', v_version, 'inferred', p_inferred));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION compensation_record_band(uuid, char(3), compensation_period, bigint, bigint,
                                                numeric, text, text, text, boolean, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compensation_record_band(uuid, char(3), compensation_period, bigint, bigint,
                                                   numeric, text, text, text, boolean, text, text, text)
  TO searchical_app;
