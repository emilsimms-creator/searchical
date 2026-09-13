-- Searchical Phase 0: tenancy, immutability and the ledger write path.
--
-- This migration is where three of the architecture's principles stop being
-- documentation and become properties of the database:
--
--   Principle 1  provenance or it does not exist
--   Principle 2  signals are immutable events
--   Principle 8  single tenant launch, multi tenant schema
--
-- Tenancy is enforced by the database, not by application code, because
-- application level tenancy filtering is a bug waiting for a missing WHERE
-- clause. See architecture.md s15.

-- ---------------------------------------------------------------------------
-- The application role
--
-- The application deliberately does NOT connect as the owner of these tables.
-- It is subject to row level security (which FORCE applies even to the owner,
-- but a non owner role makes the intent unambiguous) and it holds no UPDATE or
-- DELETE on any append only table.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'searchical_app') THEN
    CREATE ROLE searchical_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO searchical_app;

-- ---------------------------------------------------------------------------
-- Tenant resolution
-- ---------------------------------------------------------------------------

-- Reads the tenant claim set for this transaction by withTenant() in
-- src/db/client.ts. Raises rather than returning NULL, because a query that
-- silently runs without a tenant is the failure mode this whole mechanism
-- exists to prevent.
CREATE FUNCTION current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  raw text := current_setting('app.tenant_id', true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RAISE EXCEPTION 'no tenant in session: set app.tenant_id before querying'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN raw::uuid;
END;
$$;

-- The RLS predicate. Written as a plain comparison rather than a function call
-- so the planner can use the tenant_id index.
-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tenant_scoped text[] := ARRAY[
    'users', 'sources', 'evidence', 'organizations', 'persons', 'employments',
    'attributes', 'sensitive_attributes', 'signal_types', 'signals',
    'consents', 'suppressions', 'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so that the table owner is subject to the policy too. Without this,
    -- any migration or maintenance connection silently sees every tenant.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

-- The tenants table itself is keyed by id rather than tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_tenant_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Grants: read broadly, write narrowly, never mutate history
-- ---------------------------------------------------------------------------

-- Everything is readable within the tenant. RLS does the confining.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO searchical_app;

-- Tables the application may append to directly. These hold identity and
-- configuration rather than claims about a person.
GRANT INSERT ON organizations, persons, sources, signal_types, users, suppressions
  TO searchical_app;

-- The only mutable rows in the system, and each for a stated reason. `persons`
-- is updatable solely so the forget operation can set forgotten_at;
-- `organizations` so a rename lands; `sources` so a connector's display name or
-- terms reference can be corrected. None of these is a claim about a person,
-- which is the line this grant list draws.
GRANT UPDATE ON persons, organizations, sources TO searchical_app;

-- Append only, and not even INSERT is granted: these tables are written
-- exclusively through the ledger functions below, which is what makes
-- "a fact can be written only through the ledger" a property rather than a
-- convention. Attempting a direct INSERT fails with permission denied.
REVOKE INSERT, UPDATE, DELETE ON
  evidence, attributes, sensitive_attributes, signals, employments, consents, audit_log
  FROM searchical_app;

-- Nothing in the system may delete history.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM searchical_app;

-- ---------------------------------------------------------------------------
-- The ledger write path
--
-- SECURITY DEFINER functions owned by the schema owner. They bypass RLS by
-- definition, so each one validates the tenant claim explicitly. search_path is
-- pinned on every function to close the usual SECURITY DEFINER hijack.
-- ---------------------------------------------------------------------------

CREATE FUNCTION ledger_record_evidence(
  p_source_id          uuid,
  p_collection_method  collection_method,
  p_collected_at       timestamptz,
  p_lawful_basis       lawful_basis,
  p_jurisdiction       text,
  p_confidence         numeric,
  p_expires_at         timestamptz DEFAULT NULL,
  p_raw_ref            text DEFAULT NULL,
  p_citation           text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id uuid;
BEGIN
  -- The source must belong to the calling tenant. Without this check a
  -- SECURITY DEFINER function is a cross tenant hole.
  IF NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = p_source_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'source % does not belong to tenant %', p_source_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO evidence (
    tenant_id, source_id, collection_method, collected_at, lawful_basis,
    jurisdiction, confidence, expires_at, raw_ref, citation
  ) VALUES (
    v_tenant, p_source_id, p_collection_method, p_collected_at, p_lawful_basis,
    p_jurisdiction, p_confidence, p_expires_at, p_raw_ref, p_citation
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE FUNCTION ledger_record_attribute(
  p_person_id    uuid,
  p_key          text,
  p_value        text,
  p_evidence_id  uuid,
  p_sensitive    boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = p_person_id AND p.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'person % does not belong to tenant %', p_person_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = p_evidence_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'evidence % does not belong to tenant %', p_evidence_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_sensitive THEN
    INSERT INTO sensitive_attributes (tenant_id, person_id, key, value, evidence_id)
    VALUES (v_tenant, p_person_id, p_key, p_value, p_evidence_id)
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO attributes (tenant_id, person_id, key, value, evidence_id)
    VALUES (v_tenant, p_person_id, p_key, p_value, p_evidence_id)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE FUNCTION ledger_record_signal(
  p_subject_type    subject_type,
  p_subject_id      uuid,
  p_signal_type_id  uuid,
  p_observed_at     timestamptz,
  p_evidence_id     uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_window integer;
  v_id uuid;
BEGIN
  SELECT st.recency_window_days INTO v_window
  FROM signal_types st
  WHERE st.id = p_signal_type_id AND st.tenant_id = v_tenant;

  IF v_window IS NULL THEN
    RAISE EXCEPTION 'signal type % does not belong to tenant %', p_signal_type_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = p_evidence_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'evidence % does not belong to tenant %', p_evidence_id, v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Expiry is derived from the signal type's recency window rather than passed
  -- in, so "stale signals expire" cannot be bypassed by a caller. See
  -- architecture.md s6.2.
  INSERT INTO signals (
    tenant_id, subject_type, subject_id, signal_type_id, observed_at, expires_at, evidence_id
  ) VALUES (
    v_tenant, p_subject_type, p_subject_id, p_signal_type_id, p_observed_at,
    p_observed_at + make_interval(days => v_window), p_evidence_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE FUNCTION ledger_record_employment(
  p_person_id        uuid,
  p_organization_id  uuid,
  p_title            text,
  p_evidence_id      uuid,
  p_started_on       date DEFAULT NULL,
  p_ended_on         date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = p_person_id AND p.tenant_id = v_tenant)
  OR NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_organization_id AND o.tenant_id = v_tenant)
  OR NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = p_evidence_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'employment references a row outside tenant %', v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO employments (
    tenant_id, person_id, organization_id, title, started_on, ended_on, evidence_id
  ) VALUES (
    v_tenant, p_person_id, p_organization_id, p_title, p_started_on, p_ended_on, p_evidence_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE FUNCTION ledger_record_consent(
  p_person_id    uuid,
  p_basis        consent_basis,
  p_captured_at  timestamptz,
  p_evidence_id  uuid,
  p_expires_at   timestamptz DEFAULT NULL,
  p_cp_published_by_subject boolean DEFAULT NULL,
  p_cp_no_refusal_notice    boolean DEFAULT NULL,
  p_cp_relevant_to_role     boolean DEFAULT NULL,
  p_source_url              text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM persons p WHERE p.id = p_person_id AND p.tenant_id = v_tenant)
  OR NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = p_evidence_id AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'consent references a row outside tenant %', v_tenant
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO consents (
    tenant_id, person_id, basis, captured_at, expires_at, evidence_id,
    cp_published_by_subject, cp_no_refusal_notice, cp_relevant_to_role, source_url
  ) VALUES (
    v_tenant, p_person_id, p_basis, p_captured_at, p_expires_at, p_evidence_id,
    p_cp_published_by_subject, p_cp_no_refusal_notice, p_cp_relevant_to_role, p_source_url
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE FUNCTION audit_write(
  p_actor_type   actor_type,
  p_actor_id     text,
  p_action       text,
  p_entity_type  text,
  p_entity_id    text DEFAULT NULL,
  p_detail       jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := current_tenant();
  v_id bigint;
BEGIN
  INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, entity_type, entity_id, detail)
  VALUES (v_tenant, p_actor_type, p_actor_id, p_action, p_entity_type, p_entity_id, p_detail)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Functions are granted to PUBLIC by default. Close that, then grant
-- deliberately.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  current_tenant(),
  ledger_record_evidence(uuid, collection_method, timestamptz, lawful_basis, text, numeric, timestamptz, text, text),
  ledger_record_attribute(uuid, text, text, uuid, boolean),
  ledger_record_signal(subject_type, uuid, uuid, timestamptz, uuid),
  ledger_record_employment(uuid, uuid, text, uuid, date, date),
  ledger_record_consent(uuid, consent_basis, timestamptz, uuid, timestamptz, boolean, boolean, boolean, text),
  audit_write(actor_type, text, text, text, text, jsonb)
TO searchical_app;
