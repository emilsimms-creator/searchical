-- Searchical: the third segment, and the recruiter's right to overrule triage.
--
-- Found by running a real Algonquin College Network Designer tender through the
-- Mandate Engine on 28 October 2026. Two live extractions both returned
-- out_of_scope: five years of progressively responsible experience, a title
-- with no seniority marker, and a role that coordinates rather than carries
-- design authority. Both runs said it was borderline and that a recruiter
-- could reasonably overrule. The system gave the recruiter no way to do so.
--
-- Two changes, because they are one defect.
--
-- 1. A third segment, technical_specialist: hands on technology practitioners
--    and coordinators who work without supervision, typically on contract,
--    below the principal or architect bar. A role in this band is real work
--    for this practice. It is not a senior consultant, and planning its
--    channels as if it were is how a cabling coordinator gets pointed at
--    GitHub.
--
-- 2. An overrule that is recorded. Triage will always have a boundary and the
--    model will sometimes sit on the wrong side of it, so a recruiter can
--    overrule a refusal. The overrule is an append only row naming who did it
--    and why, with the original verdict beside it, because "the model said no
--    and a person said yes" is a decision somebody may be asked about later.
--
-- Only a refusal on seniority can be overruled. A role refused on domain is
-- outside the technology market the channel matrix was researched for, and
-- overruling that would produce exactly the confidently wrong plan the
-- refusal exists to prevent. The database enforces this, not only the service.

ALTER TYPE mandate_segment ADD VALUE IF NOT EXISTS 'technical_specialist';

CREATE TABLE triage_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mandate_id         uuid NOT NULL REFERENCES mandates(id) ON DELETE CASCADE,
  -- What the model said, kept exactly as it said it.
  original_reason    out_of_scope_reason NOT NULL,
  original_rationale text NOT NULL,
  -- What the recruiter decided, and why.
  new_segment        mandate_segment NOT NULL,
  reason             text NOT NULL,
  overridden_by      text NOT NULL,
  overridden_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT triage_overrides_one_per_mandate UNIQUE (mandate_id),
  CONSTRAINT triage_overrides_in_scope_target CHECK (new_segment <> 'out_of_scope'),
  CONSTRAINT triage_overrides_seniority_only CHECK (original_reason = 'seniority'),
  CONSTRAINT triage_overrides_reason_substantive CHECK (char_length(btrim(reason)) >= 30)
);

COMMENT ON TABLE triage_overrides IS
  'A recruiter overruling a seniority refusal. Append only. The row is the record that a person, '
  'not the model, put this mandate into a segment, and why.';

ALTER TABLE triage_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY triage_overrides_tenant_isolation ON triage_overrides
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON triage_overrides TO searchical_app;
REVOKE UPDATE, DELETE ON triage_overrides FROM searchical_app;
