-- Searchical: record WHY a mandate is out of scope.
--
-- Found on the fourth live extraction run, a Director of Enterprise Strategy at
-- a credit union. Triage correctly identified it as senior_executive, because
-- the segments are defined by seniority and shape: Director level and above
-- with organizational scope, a team, a function. It then recommended the CIO
-- Association of Canada as the top channel for a corporate strategy executive
-- in financial services.
--
-- The segments are seniority definitions. The 29-channel matrix behind them was
-- researched for senior TECHNOLOGY talent. Nothing connected the two, so a
-- senior non-technology executive passed triage and received a plan aimed at
-- the wrong market entirely.
--
-- This is the NAV CANADA defect on a second axis: force fitting by domain
-- rather than by seniority. The remedy is the same. Refuse, and say which axis
-- failed, because the practice intends to open to other functions later and the
-- volume of work it is turning away on domain grounds is the number that tells
-- it when.

CREATE TYPE out_of_scope_reason AS ENUM ('seniority', 'domain', 'both');

ALTER TABLE mandates ADD COLUMN out_of_scope_reason out_of_scope_reason;

COMMENT ON COLUMN mandates.out_of_scope_reason IS
  'Which axis put this mandate out of scope. seniority: too junior or wrong shape. '
  'domain: senior enough, but outside the practice''s technology focus. Null when in scope.';
