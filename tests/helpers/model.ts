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
  segmentRationale:
    'Reports to the CIO with a team of about 60 and a 40 million dollar budget: director level and ' +
    'above with organizational scope.',
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
  constraints: [],
} as const;

/**
 * A real specification that falls outside both segments: a NAV CANADA
 * Technologist posting, an entry level field electronics role maintaining air
 * navigation equipment. No minimum years of experience, a qualification
 * standing in for experience, an explicit statement that prior sector
 * experience is not required, and a training salary band.
 *
 * This fixture exists because running the real thing through the engine is what
 * found the segment triage defect. It stays as a regression test.
 */
export const NAV_CANADA_TECHNOLOGIST_EXTRACTION = {
  title: 'Technologist',
  segment: 'out_of_scope',
  segmentRationale:
    'Entry level. The specification requires a diploma completed within the last ten years rather ' +
    'than any minimum experience, states plainly that previous aviation sector experience is not ' +
    'required, and quotes a training salary band before a qualified band. There is no seniority ' +
    'marker in the title or the responsibilities. This is neither a senior executive nor a senior ' +
    'IT consultant.',
  functionDomain: 'Electronic maintenance of air navigation systems',
  location: null,
  engagementType: 'permanent',
  firstYearOutcomes: null,
  operatingRange: null,
  careerMoveCase: null,
  titleVariants: [
    { term: 'Technologist', confidence: 0.9 },
    { term: 'Electronics Technologist', confidence: 0.6 },
  ],
  mustHaveSkills: [{ term: 'Engineering Technology', confidence: 0.8 }],
  exclusions: [],
  targetCompanies: [],
  constraints: [
    {
      kind: 'language',
      severity: 'disqualifying',
      statement: 'Bilingual in English and French',
      sourceQuote: 'Language Requirements: Bilingual (English and French)',
      inferred: false,
    },
    {
      kind: 'licence_or_credential',
      severity: 'disqualifying',
      statement: 'Valid driver licence',
      sourceQuote: 'A valid driver\'s license',
      inferred: false,
    },
  ],
} as const;

/**
 * A genuinely in scope specification: Senior Database Administrator, enterprise
 * Oracle and SQL Server with Azure migration and DBaaS platform work.
 *
 * Kept as a regression test because running it found that the engine handled
 * the role correctly and then lost every one of six hard constraints, none of
 * which is a search term and several of which decide the size of the
 * addressable market.
 */
export const SENIOR_DBA_EXTRACTION = {
  title: 'Senior Database Administrator',
  segment: 'senior_it_consultant',
  segmentRationale:
    'Senior individual contributor: guides technical decisions and influences across infrastructure, ' +
    'cloud, security and application teams, with no direct reports. Borderline on tenure, since the ' +
    'specification asks for five or more years where this segment usually implies eight or more.',
  functionDomain:
    'Enterprise Oracle and SQL Server administration with Azure database migration and DBaaS platform development',
  location: null,
  engagementType: 'permanent',
  firstYearOutcomes:
    'Migrate on-premises SQL Server and Oracle workloads to Azure SQL Managed Instance, and evolve the ' +
    'standardized Database-as-a-Service platform including provisioning and recovery automation.',
  operatingRange: 'Critical production enterprise estate across on-premises and Azure, with an on-call rotation.',
  careerMoveCase:
    'Moves a production DBA from running an estate to shaping the platform: guiding migration decisions ' +
    'and defining the standards and guardrails other application teams onboard to.',
  titleVariants: [
    { term: 'Senior Database Administrator', confidence: 0.95 },
    { term: 'Senior Database Engineer', confidence: 0.75 },
    { term: 'Cloud Database Engineer', confidence: 0.6 },
    { term: 'Database Platform Engineer', confidence: 0.5 },
  ],
  mustHaveSkills: [
    { term: 'Oracle', confidence: 0.95 },
    { term: 'SQL Server', confidence: 0.95 },
    { term: 'Azure SQL Managed Instance', confidence: 0.85 },
  ],
  exclusions: [{ term: 'junior', confidence: 0.7 }],
  targetCompanies: [],
  constraints: [
    {
      kind: 'security_clearance',
      severity: 'disqualifying',
      statement: 'Must be eligible to obtain Secret clearance',
      sourceQuote: 'Security level required: Be eligible to obtain Secret',
      inferred: false,
    },
    {
      kind: 'citizenship_or_status',
      severity: 'strong_preference',
      statement: 'Priority given to Canadian citizens and permanent residents',
      sourceQuote: 'Priority will be given to Canadian citizens and permanent residents',
      inferred: false,
    },
    {
      kind: 'location_or_onsite',
      severity: 'disqualifying',
      statement:
        'On site a minimum of 12 days per month, must live in Canada within commuting distance of the office, no relocation assistance',
      sourceQuote:
        'expected on site at the Bank location a minimum of 12 days per month ... There will be no relocation assistance provided',
      inferred: false,
    },
    {
      kind: 'schedule',
      severity: 'disqualifying',
      statement: 'Participation in an on-call rotation is required',
      sourceQuote: 'Participation in an on-call rotation is required, with additional compensation provided.',
      inferred: false,
    },
    {
      kind: 'language',
      severity: 'nice_to_have',
      statement: 'English or French essential; second language encouraged but not required',
      sourceQuote: 'the position language requirement is English or French essential',
      inferred: false,
    },
  ],
} as const;
