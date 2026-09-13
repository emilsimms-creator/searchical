-- Searchical: segment triage.
--
-- Found by running a real job specification through the Mandate Engine: a
-- NAV CANADA Technologist posting, an entry level field electronics role
-- maintaining air navigation equipment, with no seniority markers and no
-- previous experience required.
--
-- The engine had no way to say "this is not a role I handle". `mandate_segment`
-- offered exactly two values, so extraction was forced to pick one, and the
-- channel planner then confidently recommended GitHub, AWS Community Builders
-- and the CNCF ambassador directories for a technician who fixes radar.
--
-- That is the "excellent search string for the wrong search" failure the
-- architecture warns about (s5.2), occurring one level higher than the
-- architecture anticipated: at the segment, not the title. A system that
-- force fits every mandate into the two segments it knows is worse than one
-- that refuses, because a refusal costs a minute and a confidently wrong
-- channel plan costs a search.
--
-- The fix is a third segment that is not a segment: an explicit out of scope
-- verdict that stops the pipeline and says why.

ALTER TYPE mandate_segment ADD VALUE IF NOT EXISTS 'out_of_scope';
ALTER TYPE mandate_status  ADD VALUE IF NOT EXISTS 'out_of_scope';

-- Why the segment was assigned. Required reading when the verdict is
-- out_of_scope, and useful on the supported segments too: a mandate sitting
-- near the boundary is exactly the one a recruiter should sanity check.
ALTER TABLE mandates ADD COLUMN segment_rationale text;
