import { describe, expect, it } from 'vitest';
import { admitsNotStated, deriveIntakeGaps } from '@/mandate/extraction';
import type { MandateDraft } from '@/mandate/types';

/** Verbatim from the live uOttawa run that found this. */
const HEDGED_OUTCOMES =
  'Twelve months in, this person should have designed, developed and implemented IAM solutions on ' +
  'the University\'s enterprise platforms ... The specification does not state targets, dates or a ' +
  'named programme, so the outcome measures themselves are a question for the hiring leader.';

const HEDGED_CAREER =
  'The stretch the specification itself establishes is the move from senior individual contribution ' +
  'to leading senior people ... everything beyond scope and authority is unevidenced and should be ' +
  'put to the hiring leader.';

const draft = (intake: MandateDraft['intake']): MandateDraft => ({
  title: 'Lead Analyst, IT Security', segment: 'senior_it_consultant', segmentRationale: 'x',
  outOfScopeReason: null, functionDomain: 'IAM', location: 'Ottawa', engagementType: 'permanent',
  intake,
  terms: [
    { kind: 'title_variant', term: 'IAM Architect', origin: 'extracted', status: 'proposed', observedCount: null, rank: 1 },
    { kind: 'title_variant', term: 'Lead IAM Engineer', origin: 'extracted', status: 'proposed', observedCount: null, rank: 2 },
    { kind: 'must_have_skill', term: 'SAML', origin: 'extracted', status: 'proposed', observedCount: null, rank: 1 },
  ],
  targetCompanies: [{ name: 'Example', kind: 'competitor' }],
  constraints: [],
  compensation: {
    currency: 'CAD', period: 'annual', baseMin: 100_000, baseMax: 120_000, bonusTargetPct: null,
    pensionNote: null, equityNote: null, sourceQuote: 'x',
  },
});

describe('a hedged intake answer still raises the question', () => {
  it('recognises the admissions the live run actually produced', () => {
    expect(admitsNotStated(HEDGED_OUTCOMES)).toBe(true);
    expect(admitsNotStated(HEDGED_CAREER)).toBe(true);
  });

  it('does not flag an answer the specification genuinely supports', () => {
    expect(admitsNotStated(
      'Consolidate three regional data centres onto a hybrid Azure and AWS footprint within the first year.',
    )).toBe(false);
    expect(admitsNotStated('A team of about 60 across four sites, with a 40 million dollar budget.')).toBe(false);
  });

  /**
   * The failure: the field was not null, so no gap was raised, and the model's
   * own caveat sat in prose a recruiter reads past.
   */
  it('raises a gap for a filled field that admits the spec does not settle it', () => {
    const gaps = deriveIntakeGaps(draft({
      firstYearOutcomes: HEDGED_OUTCOMES,
      operatingRange: 'Supervises 4 FTE Senior Analysts.',
      careerMoveCase: HEDGED_CAREER,
    }));
    expect(gaps.map((g) => g.field).sort()).toEqual(['careerMoveCase', 'firstYearOutcomes']);
    expect(gaps[0]!.question).toMatch(/an inference rather than the client's answer/);
  });

  it('still raises the plain gap for a null field', () => {
    const gaps = deriveIntakeGaps(draft({
      firstYearOutcomes: null, operatingRange: 'Supervises 4 FTE Senior Analysts.', careerMoveCase: null,
    }));
    expect(gaps.map((g) => g.field).sort()).toEqual(['careerMoveCase', 'firstYearOutcomes']);
    expect(gaps[0]!.question).not.toMatch(/inference/);
  });
});
