import type { LanguageModel } from '@/llm/gateway';

/**
 * A deterministic stand in for the model.
 *
 * Extraction quality is judged by an evaluation suite against real job
 * specifications, not by unit tests. What these tests check is the machinery
 * around the model: that nothing it proposes is auto confirmed, that gaps are
 * derived from what it left null, and that malformed output is rejected rather
 * than half trusted.
 */
export function fakeModel(response: unknown, id = 'fake-model'): LanguageModel {
  return {
    id,
    async complete() {
      return typeof response === 'string' ? response : JSON.stringify(response);
    },
  };
}

export function failingModel(message: string, id = 'failing-model'): LanguageModel {
  return {
    id,
    async complete() {
      throw new Error(message);
    },
  };
}

/** A complete, realistic extraction: worked example A from the Channel Guide. */
export const VP_INFRASTRUCTURE_EXTRACTION = {
  title: 'VP, Infrastructure and Cloud',
  segment: 'senior_executive',
  functionDomain: 'Hybrid cloud and infrastructure operations',
  location: 'Ottawa',
  engagementType: 'permanent',
  firstYearOutcomes:
    'Consolidate three regional data centres onto a hybrid Azure and AWS footprint, and stand up a ' +
    'single operations function across the merged estate.',
  operatingRange: 'A team of about 60 across four sites, with a 40 million dollar operating budget.',
  careerMoveCase:
    'First enterprise wide infrastructure remit, reporting to the CIO, with the data centre ' +
    'consolidation as a board visible programme.',
  titleVariants: [
    { term: 'VP Infrastructure', confidence: 0.9 },
    { term: 'Director, Cloud Infrastructure', confidence: 0.85 },
    { term: 'Head of Cloud and Infrastructure', confidence: 0.7 },
    { term: 'Chief Infrastructure Evangelist', confidence: 0.2 },
  ],
  mustHaveSkills: [
    { term: 'hybrid cloud', confidence: 0.95 },
    { term: 'Azure', confidence: 0.9 },
    { term: 'AWS', confidence: 0.9 },
  ],
  exclusions: [{ term: 'sales', confidence: 0.8 }],
  targetCompanies: [
    { name: 'National Bank of Example', kind: 'competitor', rationale: 'Comparable hybrid estate' },
    { name: 'Example Telecom', kind: 'adjacent_sector', rationale: 'Same operational complexity' },
  ],
} as const;
