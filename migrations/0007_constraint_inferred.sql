-- Searchical: mark whether a constraint was stated or inferred.
--
-- Found on the third live extraction run, a Senior Cybersecurity Specialist
-- (GRC) specification. The model produced:
--
--   disqualifying / other
--   "Work falls within a NERC CIP compliance program, which typically carries
--    personnel risk assessment and background screening obligations for access
--    to in-scope systems."
--   source: "Support the compliance sustainment and continuous improvement
--            efforts associated with Hydro One's NERC CIP compliance program."
--
-- The quote is genuinely in the specification. It does not establish the claim.
-- The screening obligation is domain knowledge, and it is probably correct and
-- genuinely useful to the recruiter, but the document never says it.
--
-- Marked disqualifying and left unflagged, it silently narrowed the pipeline
-- arithmetic on the strength of the model's background knowledge. A source
-- quote that is present but non-probative is the worst case of all, because it
-- manufactures exactly the confidence the quote was introduced to earn.
--
-- An inferred constraint is now surfaced for the recruiter to confirm with the
-- client and is excluded from the market narrowing until they do.

ALTER TABLE mandate_constraints
  ADD COLUMN inferred boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN mandate_constraints.inferred IS
  'True when the constraint follows from domain knowledge rather than from the specification. '
  'Surfaced for confirmation; never narrows the addressable market on its own authority.';
