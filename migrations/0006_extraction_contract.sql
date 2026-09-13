-- Searchical: values the first real extraction run showed were missing.
--
-- Running the Senior Database Administrator specification through the engine
-- against a live model, rather than a hand authored fixture, failed validation
-- on every enum. The prompt described the fields in prose while only the schema
-- knew the permitted values, so the model invented a sensible taxonomy of its
-- own and all of it was rejected.
--
-- The prompt is now generated from the schema so the two cannot drift again.
-- Two of the model's inventions were better than the taxonomy it was given, and
-- are adopted here.

-- The specification never said whether the role is permanent, fixed term or
-- full time. "unstated" is the honest answer; forcing a guess into `permanent`
-- would have put an invented fact into the mandate.
ALTER TYPE engagement_type ADD VALUE IF NOT EXISTS 'unstated';

-- "five or more years of relevant experience" is a hard floor that is not a
-- search term and does not fit any existing kind. The model surfaced it; the
-- taxonomy lacked it.
ALTER TYPE constraint_kind ADD VALUE IF NOT EXISTS 'prior_experience';
