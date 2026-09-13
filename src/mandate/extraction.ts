import { z } from 'zod';
import type { PromptVersion } from '@/llm/gateway';
import type { IntakeGap, MandateDraft, MandateTerm, PerformanceIntake, Segment } from './types';

const ExtractionOutput = z.object({
  title: z.string().min(1),
  segment: z.enum(['senior_executive', 'senior_it_consultant', 'out_of_scope']),
  segmentRationale: z.string().min(1),
  functionDomain: z.string().min(1),
  location: z.string().nullable(),
  engagementType: z.enum(['permanent', 'contract', 'either']),
  firstYearOutcomes: z.string().nullable(),
  operatingRange: z.string().nullable(),
  careerMoveCase: z.string().nullable(),
  titleVariants: z.array(z.object({ term: z.string().min(1), confidence: z.number().min(0).max(1) })).max(8),
  mustHaveSkills: z.array(z.object({ term: z.string().min(1), confidence: z.number().min(0).max(1) })).max(6),
  exclusions: z.array(z.object({ term: z.string().min(1), confidence: z.number().min(0).max(1) })).max(4),
  targetCompanies: z.array(
    z.object({
      name: z.string().min(1),
      kind: z.enum(['competitor', 'academy', 'adjacent_sector', 'client_named', 'late_stage']),
      rationale: z.string().optional(),
    }),
  ).max(30),
});

export type ExtractionOutputType = z.infer<typeof ExtractionOutput>;

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

4. OUTCOMES, NOT A SKILLS CHECKLIST. For firstYearOutcomes, describe what this person must have
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

Return only JSON matching the requested shape. No commentary.`;

export const jobSpecExtraction: PromptVersion<{ jobSpec: string }, ExtractionOutputType> = {
  id: 'mandate.job_spec_extraction',
  version: '1.0.0',
  outputSchema: ExtractionOutput,
  render({ jobSpec }) {
    return {
      system: SYSTEM,
      user: `Extract the mandate from this job specification.

Return JSON with exactly these keys: title, segment, segmentRationale, functionDomain, location,
engagementType, firstYearOutcomes, operatingRange, careerMoveCase, titleVariants, mustHaveSkills,
exclusions, targetCompanies.

titleVariants, mustHaveSkills and exclusions are arrays of {term, confidence}.
targetCompanies is an array of {name, kind, rationale}.
location is null if the specification does not name one.

--- JOB SPECIFICATION ---
${jobSpec}
--- END ---`,
    };
  },
};

const toTerms = (
  items: readonly { term: string; confidence: number }[],
  kind: MandateTerm['kind'],
): MandateTerm[] =>
  items.map((item, index) => ({
    kind,
    term: item.term.trim(),
    origin: 'extracted' as const,
    // Nothing a model proposes is confirmed. A human moves it.
    status: 'proposed' as const,
    observedCount: null,
    extractionConfidence: item.confidence,
    rank: index,
  }));

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
    gaps.push({
      field: 'location',
      question:
        'The specification names no location. Where is this role based, and what is genuinely ' +
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
