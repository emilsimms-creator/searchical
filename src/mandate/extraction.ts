import { z } from 'zod';
import type { PromptVersion } from '@/llm/gateway';
import type { IntakeGap, MandateDraft, MandateTerm, PerformanceIntake, Segment } from './types';

/**
 * A term that will be dropped verbatim into a quoted Boolean phrase.
 *
 * The first real extraction run produced terms like
 *   "Azure database platforms (Azure SQL Managed Instance, Azure Database for PostgreSQL, ...)"
 * which read as an excellent summary of the role and match nobody on any
 * platform. A search term is the token a person writes on their own profile,
 * not a description of the requirement.
 *
 * Validated rather than merely requested, because the confirmation gate cannot
 * catch this: a plausible looking description is exactly what a recruiter would
 * confirm, and the broken Boolean would only surface as an empty result set.
 */
const searchableTerm = z
  .string()
  .min(1)
  .max(48, 'a search term must be a token a person writes on their profile, not a description')
  // Commas are deliberately allowed: "Director, Cloud Infrastructure" and
  // "VP, Engineering" are how the market actually writes those titles. Brackets
  // and semicolons never are, and the length cap catches the descriptions.
  .refine((t) => !/[()\[\];]/.test(t), {
    message: 'a search term must not contain brackets or semicolons: split it into separate terms',
  })
  .refine((t) => !/\.\s|\.$/.test(t), { message: 'a search term is not a sentence' });

/** A place a search can be bounded by, not a paragraph about where the office is. */
const placeName = z
  .string()
  .min(1)
  .max(60, 'location must be a place name; if the specification does not name one, return null')
  .refine((t) => !/\.\s|\.$/.test(t), { message: 'location must be a place name, not a sentence' })
  .nullable();

const scoredTerm = z.object({ term: searchableTerm, confidence: z.number().min(0).max(1) });

const ExtractionOutput = z.object({
  title: z.string().min(1),
  segment: z.enum(['senior_executive', 'senior_it_consultant', 'out_of_scope']),
  segmentRationale: z.string().min(1),
  functionDomain: z.string().min(1),
  location: placeName,
  engagementType: z.enum(['permanent', 'contract', 'either', 'unstated']),
  firstYearOutcomes: z.string().nullable(),
  operatingRange: z.string().nullable(),
  careerMoveCase: z.string().nullable(),
  titleVariants: z.array(scoredTerm).max(8),
  mustHaveSkills: z.array(scoredTerm).max(6),
  exclusions: z.array(scoredTerm).max(4),
  targetCompanies: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.enum(['competitor', 'academy', 'adjacent_sector', 'client_named', 'late_stage']),
      rationale: z.string().optional(),
    }),
  ).max(30),
  constraints: z.array(
    z.object({
      kind: z.enum([
        'security_clearance', 'citizenship_or_status', 'location_or_onsite', 'schedule',
        'language', 'licence_or_credential', 'prior_experience', 'travel', 'other',
      ]),
      severity: z.enum(['disqualifying', 'strong_preference', 'nice_to_have']),
      statement: z.string().min(1),
      sourceQuote: z.string().optional(),
    }),
  ).max(12),
});

export type ExtractionOutputType = z.infer<typeof ExtractionOutput>;

/**
 * Render the permitted values straight out of the schema.
 *
 * The first real extraction run failed because the prompt described the fields
 * in prose while only the schema knew the enum values, the numeric types and the
 * array caps. The model invented a sensible taxonomy of its own and every one of
 * its guesses was rejected. Deriving the contract from the schema means the
 * instruction and the validation can never disagree again.
 */
const values = (schema: z.ZodTypeAny): string =>
  (schema as unknown as { options: readonly string[] }).options.map((o) => `"${o}"`).join(' | ');

const shape = ExtractionOutput.shape;
const itemShape = (arr: z.ZodTypeAny) =>
  (arr as unknown as { element: { shape: Record<string, z.ZodTypeAny> } }).element.shape;
const maxOf = (arr: z.ZodTypeAny) =>
  (arr as unknown as { _def: { maxLength: { value: number } } })._def.maxLength.value;

const FIELD_CONTRACT = `EXACT OUTPUT CONTRACT. Every value below is checked, and anything outside it is
rejected outright rather than repaired.

  title              string
  segment            ${values(shape.segment)}
  segmentRationale   string, always required
  functionDomain     string
  location           a PLACE NAME only, at most 60 characters, or null.
                     Good: "Ottawa" / "Ottawa, Ontario" / "Toronto or Montreal" / null
                     Bad:  "Canada, within commuting distance of the office; the city is not named"
                     If the specification imposes a commuting or on-site rule but never names the
                     city, the answer is null and the rule is a constraint. Null is the finding: it
                     raises the question with the hiring leader. A sentence here is dropped straight
                     into a search query, where it matches nothing.
  engagementType     ${values(shape.engagementType)}
                     Use "unstated" when the specification does not say. Do not guess, and do not
                     explain in this field: the explanation belongs nowhere, the null belongs here.
  firstYearOutcomes  string, or null
  operatingRange     string, or null
  careerMoveCase     string, or null

  titleVariants      array, at most ${maxOf(shape.titleVariants)} items of {term: string, confidence: number}
  mustHaveSkills     array, at most ${maxOf(shape.mustHaveSkills)} items of {term: string, confidence: number}
  exclusions         array, at most ${maxOf(shape.exclusions)} items of {term: string, confidence: number}

                     confidence is a NUMBER between 0 and 1, written as 0.85, never as a string,
                     a percentage or a word.

                     EVERY term goes verbatim into a quoted Boolean phrase, so it must be the token
                     a person writes on their own profile, not a description of the requirement.
                     At most 48 characters. No brackets or semicolons. Not a sentence. A comma is
                     fine where the market writes one, as in "Director, Cloud Infrastructure".
                       Good: "Azure SQL Managed Instance" / "Always On" / "Oracle RAC" / "Terraform"
                       Bad:  "Azure database platforms (Azure SQL MI, PostgreSQL, Oracle@Azure)"
                       Bad:  "On-premises to cloud database migration (assessment, cutover)"
                     Split a compound requirement into separate terms rather than describing it.
                     Terms must be unique within their list.

  targetCompanies    array, at most ${maxOf(shape.targetCompanies)} items of
                     {name: string, kind: <enum>, rationale: string}
                     name is the company or sector itself. kind is one of:
                       ${values(itemShape(shape.targetCompanies).kind!)}
                     Put the sector in name and the classification in kind. They are not the same
                     field.

  constraints        array, at most ${maxOf(shape.constraints)} items of
                     {kind: <enum>, severity: <enum>, statement: string, sourceQuote: string}
                     kind is one of:
                       ${values(itemShape(shape.constraints).kind!)}
                     severity is one of:
                       ${values(itemShape(shape.constraints).severity!)}
                     Use "other" rather than inventing a kind. A kind outside this list is rejected
                     and the constraint is lost, which is worse than an imprecise label.

Return ONLY the JSON object. No preamble, no commentary, no markdown fence.`;

const SYSTEM = `You are the intake analyst for a senior technology executive search practice.

You read a job specification and return structured JSON. You are one step in a pipeline: a human
recruiter confirms or edits everything you propose before it is used, and your title variants are
separately checked against how often they actually occur in the target market. Propose, do not decide.

Four rules govern your output.

1. NEVER INVENT. If the specification does not say what the person must accomplish, what operating
   range is required, or why this is a career move rather than a lateral one, return null for that
   field. A null is useful: it becomes a specific question put to the hiring leader. A plausible
   invention is worse than useless, because it silently becomes the argument the recruiter makes to
   a candidate.

2. PROPOSE THE TITLES THE MARKET USES, not only the one the client wrote. The title a hiring manager
   invents often does not exist at the companies worth targeting. Offer the client's title plus the
   alternatives a senior person in this market would actually hold. Rank by how common you believe
   they are and set confidence honestly: low confidence is informative, false confidence is not.

3. MUST-HAVE MEANS MUST-HAVE. At most three to six skills, and only those without which the person
   genuinely cannot do the job. Be specific and inclusive rather than vague and exclusive. Keep
   exclusions minimal: one or two terms that strip obvious noise, such as junior, intern or sales.

4. CAPTURE THE CONSTRAINTS, AND KEEP THEM OUT OF THE SKILL LIST. A requirement that cannot be
   searched for is a constraint, not a skill: security clearance eligibility, citizenship or work
   status, a commuting radius or on-site day count, an on-call rotation, shift work, a travel
   cadence, a language requirement, a licence or a credential. Putting any of these in
   mustHaveSkills corrupts the Boolean, and dropping them is worse: they decide how large the
   addressable market actually is and whether a candidate can take the job at all.

   Mark severity honestly. "disqualifying" means a person without it cannot hold the role, and
   nothing else earns that label. A stated preference, or something the employer says is encouraged,
   is "strong_preference" or "nice_to_have". Quote the words from the specification that established
   each one in sourceQuote, so a recruiter can check it against the source rather than trust a
   paraphrase.

5. OUTCOMES, NOT A SKILLS CHECKLIST. For firstYearOutcomes, describe what this person must have
   delivered twelve months in, in the specification's own terms. For careerMoveCase, describe the
   stretch and growth that would make a strong, currently employed person consider this a step up.
   If the specification only lists requirements and offers no such case, return null.

SEGMENT TRIAGE. This practice recruits two populations and nothing else:

  senior_executive      Director level and above with organizational scope: a team, a budget, a
                        function. Titles like VP, Director, Head of, Chief.
  senior_it_consultant  Architects, principal engineers and senior technical specialists, including
                        contract and consulting engagements. Deep individual expertise, typically
                        eight years or more, usually with a title carrying Principal, Lead, Staff,
                        Senior or Architect.
  out_of_scope          Everything else.

Return out_of_scope whenever the specification describes a role this practice does not recruit, and
say so plainly in segmentRationale. The signals are reliable: no minimum years of experience;
entry level, graduate, apprentice or trainee framing; a training salary or training period; a
qualification such as a diploma standing in for experience; explicit statements that prior
experience is not required; junior, associate, coordinator, administrator, technician or analyst
level titles with no seniority marker.

Do NOT stretch a role into the nearest segment. A refusal costs the recruiter a minute; a
confidently wrong channel plan costs them a search. When the role sits genuinely on the boundary,
pick the closer segment and say in segmentRationale exactly what makes it borderline, so the
recruiter can overrule you.

segmentRationale is always required, on every verdict, and names the evidence in the specification
that decided it.

${FIELD_CONTRACT}`;

export const jobSpecExtraction: PromptVersion<{ jobSpec: string }, ExtractionOutputType> = {
  id: 'mandate.job_spec_extraction',
  version: '1.0.0',
  outputSchema: ExtractionOutput,
  render({ jobSpec }) {
    return {
      system: SYSTEM,
      user: `Extract the mandate from this job specification, following the output contract exactly.

--- JOB SPECIFICATION ---
${jobSpec}
--- END ---`,
    };
  },
};

const toTerms = (
  items: readonly { term: string; confidence: number }[],
  kind: MandateTerm['kind'],
): MandateTerm[] => {
  // The model repeated a title at two confidences on the first real run. The
  // database would reject the duplicate; the in-memory list would still show it
  // twice to the recruiter confirming the vocabulary.
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.term.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.map((item, index) => ({
    kind,
    term: item.term.trim(),
    origin: 'extracted' as const,
    // Nothing a model proposes is confirmed. A human moves it.
    status: 'proposed' as const,
    observedCount: null,
    extractionConfidence: item.confidence,
    rank: index,
  }));
};

export function toDraft(output: ExtractionOutputType): MandateDraft {
  return {
    title: output.title,
    segment: output.segment as Segment,
    segmentRationale: output.segmentRationale,
    functionDomain: output.functionDomain,
    location: output.location,
    engagementType: output.engagementType,
    intake: {
      firstYearOutcomes: output.firstYearOutcomes,
      operatingRange: output.operatingRange,
      careerMoveCase: output.careerMoveCase,
    },
    terms: [
      ...toTerms(output.titleVariants, 'title_variant'),
      ...toTerms(output.mustHaveSkills, 'must_have_skill'),
      ...toTerms(output.exclusions, 'exclusion'),
    ],
    targetCompanies: output.targetCompanies,
    constraints: output.constraints,
  };
}

const INTAKE_QUESTIONS: Record<keyof PerformanceIntake, string> = {
  firstYearOutcomes:
    'What must this person have delivered twelve months in? Name two or three concrete outcomes, ' +
    'not responsibilities. This becomes the substance of the approach.',
  operatingRange:
    'What scale and complexity must they have operated at: team size, budget, systems, stakeholders? ' +
    'This sets the talent universe and stops the search drifting up or down a level.',
  careerMoveCase:
    'Why would a strong person who is currently employed and doing well consider this a step up ' +
    'rather than a lateral move? Passive candidates are not looking for lateral transfers, so a ' +
    'mandate without an answer here produces a sequence that will be ignored.',
};

/**
 * Turn what the specification did not answer into the specific questions to put
 * to the hiring leader.
 *
 * The career move case is the one that matters most: a mandate with an empty
 * one produces a sequence that pitches a lateral role, which the research
 * identifies as a primary reason senior people ignore recruiters. See
 * architecture.md s5.3.
 */
export function deriveIntakeGaps(draft: MandateDraft): IntakeGap[] {
  const gaps: IntakeGap[] = [];

  for (const field of ['firstYearOutcomes', 'operatingRange', 'careerMoveCase'] as const) {
    const value = draft.intake[field];
    if (value === null || value.trim() === '') {
      gaps.push({ field, question: INTAKE_QUESTIONS[field] });
    }
  }

  if (draft.terms.filter((t) => t.kind === 'title_variant').length < 2) {
    gaps.push({
      field: 'title_variants',
      question:
        'Only one title was extracted. What else does this market call this role? The title on the ' +
        'specification often does not exist at the companies worth targeting.',
    });
  }

  if (draft.terms.filter((t) => t.kind === 'must_have_skill').length === 0) {
    gaps.push({
      field: 'must_have_skills',
      question: 'What are the two or three capabilities without which this person cannot do the job?',
    });
  }

  // A national employer with site based roles and no named location produces
  // search strings with no geography, which are useless. Found by running a
  // real specification through the engine.
  if (draft.location === null || draft.location.trim() === '') {
    const onsite = draft.constraints.some(
      (c) => c.kind === 'location_or_onsite' && c.severity === 'disqualifying',
    );
    gaps.push({
      field: 'location',
      question: onsite
        ? 'The specification imposes an on-site or commuting requirement but never names the office. ' +
          'Which city? Without it the search cannot be geographically bounded, and a commuting ' +
          'requirement against an unknown location is unqualifiable: every prospect would have to be ' +
          'asked, which is exactly the waste the constraint exists to prevent.'
        : 'The specification names no location. Where is this role based, and what is genuinely ' +
          'negotiable: remote, hybrid, relocation, or a specific site? Every search string carries ' +
          'geography, and a national search without one returns the wrong people everywhere.',
    });
  }

  if (draft.targetCompanies.length === 0) {
    gaps.push({
      field: 'target_companies',
      question:
        'Which companies should we be mapping: direct competitors, academy companies that train this ' +
        'capability, and the adjacent sectors where the same capability exists?',
    });
  }

  return gaps;
}
