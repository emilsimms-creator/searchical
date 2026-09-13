import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runChecks, type CaseExpectation, type CheckResult } from '../../evals/checks';
import { toDraft } from '@/mandate';
import { NAV_CANADA_TECHNOLOGIST_EXTRACTION, SENIOR_DBA_EXTRACTION } from '../helpers/model';

/**
 * The graders are themselves tested, without spending a model call.
 *
 * A grader that silently passes everything is worse than no eval: it converts
 * an absence of measurement into a false assurance. These tests feed the
 * graders known-good and known-bad drafts and assert they can tell them apart.
 */
const DBA_SPEC = readFileSync('fixtures/senior-database-administrator.txt', 'utf8');

const DBA_EXPECT: CaseExpectation = {
  segment: 'senior_it_consultant',
  searchPlan: true,
  constraintKinds: ['security_clearance', 'location_or_onsite', 'schedule'],
  gaps: ['location'],
  skills: ['oracle', 'sql server', 'azure'],
  location: 'null',
};

const byId = (results: readonly CheckResult[], id: string): CheckResult =>
  results.find((r) => r.id === id)!;

describe('the graders pass a good extraction', () => {
  const results = runChecks(toDraft(SENIOR_DBA_EXTRACTION as never), DBA_EXPECT, DBA_SPEC);

  it('passes every check on a well formed draft', () => {
    const failed = results.filter((r) => !r.passed);
    expect(failed.map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
  });

  it('verifies the quotes against the real specification text', () => {
    expect(byId(results, 'quotes_verified').detail).toMatch(/quotes found verbatim/);
  });
});

describe('the graders catch what the live runs found', () => {
  const draft = toDraft(SENIOR_DBA_EXTRACTION as never);

  it('catches a wrong segment', () => {
    const r = runChecks({ ...draft, segment: 'senior_executive' }, DBA_EXPECT, DBA_SPEC);
    expect(byId(r, 'segment_correct').passed).toBe(false);
  });

  it('catches a description used as a search term', () => {
    const poisoned = {
      ...draft,
      terms: [
        ...draft.terms,
        {
          kind: 'must_have_skill' as const,
          term: 'Azure database platforms (Azure SQL Managed Instance, Azure Database for PostgreSQL)',
          origin: 'extracted' as const,
          status: 'proposed' as const,
          observedCount: null,
          rank: 9,
        },
      ],
    };
    expect(byId(runChecks(poisoned, DBA_EXPECT, DBA_SPEC), 'terms_searchable').passed).toBe(false);
  });

  it('catches a sentence in the location field', () => {
    const r = runChecks(
      { ...draft, location: "Canada, within commuting distance of the Bank's office. The city is not named." },
      DBA_EXPECT,
      DBA_SPEC,
    );
    expect(byId(r, 'location_shape').passed).toBe(false);
  });

  it('catches a fabricated source quote', () => {
    const r = runChecks(
      {
        ...draft,
        constraints: [{
          kind: 'security_clearance',
          severity: 'disqualifying',
          statement: 'Active Top Secret clearance required',
          sourceQuote: 'Candidates must already hold an active Top Secret clearance',
          inferred: false,
        }],
      },
      DBA_EXPECT,
      DBA_SPEC,
    );
    expect(byId(r, 'quotes_verified').passed).toBe(false);
    expect(byId(r, 'quotes_verified').detail).toMatch(/missing:/);
  });

  it('catches requirement text smuggled in as a skill', () => {
    const r = runChecks(
      {
        ...draft,
        terms: [...draft.terms, {
          kind: 'must_have_skill' as const, term: 'Secret clearance', origin: 'extracted' as const,
          status: 'proposed' as const, observedCount: null, rank: 9,
        }],
      },
      DBA_EXPECT,
      DBA_SPEC,
    );
    expect(byId(r, 'no_constraint_leakage').passed).toBe(false);
  });

  it('catches a missing required constraint kind', () => {
    const r = runChecks({ ...draft, constraints: [] }, DBA_EXPECT, DBA_SPEC);
    expect(byId(r, 'required_constraints').passed).toBe(false);
    expect(byId(r, 'required_constraints').score).toBe(0);
  });

  it('catches a stated constraint with no quote to check it against', () => {
    const r = runChecks(
      {
        ...draft,
        constraints: [{
          kind: 'schedule', severity: 'disqualifying', statement: 'On-call rotation', inferred: false,
        }],
      },
      DBA_EXPECT,
      DBA_SPEC,
    );
    expect(byId(r, 'stated_have_quotes').passed).toBe(false);
  });
});

describe('the graders handle the refusal case', () => {
  const draft = toDraft(NAV_CANADA_TECHNOLOGIST_EXTRACTION as never);
  const expectation: CaseExpectation = {
    segment: 'out_of_scope',
    outOfScopeReason: 'seniority',
    searchPlan: false,
    constraintKinds: ['language', 'licence_or_credential'],
    gaps: [],
    skills: [],
    location: 'any',
  };
  const results = runChecks(draft, expectation, readFileSync('fixtures/nav-canada-technologist.txt', 'utf8'));

  it('passes when the engine refuses', () => {
    expect(results.filter((r) => !r.passed).map((f) => `${f.id}: ${f.detail}`)).toEqual([]);
    expect(byId(results, 'no_search_plan').detail).toMatch(/refused/);
  });

  it('does not apply the search plan checks to a refused mandate', () => {
    for (const id of ['boolean_runnable', 'channel_plan', 'required_skills', 'required_gaps', 'strings_match_plan']) {
      expect(results.find((r) => r.id === id), id).toBeUndefined();
    }
  });

  it('fails if the engine were to plan channels for it anyway', () => {
    const forced = runChecks(draft, { ...expectation, searchPlan: true }, 'x');
    expect(byId(forced, 'no_search_plan').passed).toBe(false);
  });
});
