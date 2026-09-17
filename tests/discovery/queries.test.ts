import { describe, expect, it } from 'vitest';
import { generateDiscoveryQueries, sourceById } from '@/discovery';
import type { MandateTerm } from '@/mandate/types';

const term = (
  kind: MandateTerm['kind'], value: string, rank: number, status: MandateTerm['status'] = 'confirmed',
): MandateTerm => ({
  kind, term: value, origin: 'extracted', status, observedCount: null, rank,
});

const VOCABULARY: readonly MandateTerm[] = [
  term('title_variant', 'Vice President, Engineering', 1),
  term('title_variant', 'VP Engineering', 2),
  term('must_have_skill', 'Kubernetes', 1),
  term('must_have_skill', 'Terraform', 2),
];

const byId = (queries: readonly { sourceId: string; query: string; rationale: string }[], id: string) =>
  queries.find((q) => q.sourceId === id);

describe('discovery queries', () => {
  /** The same rule the outreach search strings follow, for the same reason. */
  it('refuses to build anything from unconfirmed vocabulary', () => {
    const proposed = VOCABULARY.map((t) => ({ ...t, status: 'proposed' as const }));
    const out = generateDiscoveryQueries({
      terms: proposed, segment: 'senior_it_consultant', location: null,
    });
    expect(out.queries).toEqual([]);
    expect(out.warnings[0]).toMatch(/searches for the wrong person very efficiently/);
  });

  it('shapes each surface differently rather than firing one template at every site', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_it_consultant', location: 'Toronto, Ontario',
    });

    // A code host indexes what people build, so a title query finds nothing there.
    const github = byId(out.queries, 'github_xray')!;
    expect(github.query).toContain('site:github.com');
    expect(github.query).toContain('"Kubernetes"');
    expect(github.query).not.toContain('Vice President');
    expect(github.rationale).toMatch(/Skill led/);

    // A speaker programme is found by the words a programme page uses.
    const conf = byId(out.queries, 'conference_programmes')!;
    expect(conf.query).toMatch(/speaker OR keynote/);
    expect(conf.query).toContain('-jobs');
  });

  it('excludes the advert words, which is what stops a title search returning job boards', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_executive', location: null,
    });
    const leadership = byId(out.queries, 'corporate_leadership_pages')!;
    for (const exclusion of ['-jobs', '-hiring', '-apply', '-careers', '-recruiter']) {
      expect(leadership.query, exclusion).toContain(exclusion);
    }
  });

  it('bounds the leadership search to the target companies, and says so when it cannot', () => {
    const bounded = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_executive', location: null,
      targetCompanies: ['Shopify', 'Telus'],
    });
    const withList = byId(bounded.queries, 'corporate_leadership_pages')!;
    expect(withList.query).toContain('"Shopify"');
    expect(withList.rationale).toMatch(/market map rather than a web search/);

    const unbounded = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_executive', location: null,
    });
    expect(byId(unbounded.queries, 'corporate_leadership_pages')!.rationale)
      .toMatch(/will be noisy/);
  });

  it('never aims a code host query at an executive search', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_executive', location: null,
    });
    expect(byId(out.queries, 'github_xray')).toBeUndefined();
    expect(byId(out.queries, 'foundation_contributors')).toBeUndefined();
  });

  it('skips a surface whose axis the mandate never confirmed, rather than guessing', () => {
    const titlesOnly = VOCABULARY.filter((t) => t.kind === 'title_variant');
    const out = generateDiscoveryQueries({
      terms: titlesOnly, segment: 'senior_it_consultant', location: null,
    });
    // No confirmed skills, so the skill led surfaces produce nothing and say why.
    expect(byId(out.queries, 'github_xray')).toBeUndefined();
    expect(out.warnings.some((w) => w.includes('GitHub'))).toBe(true);
  });

  it('warns that most surfaces can be searched but not recorded', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_it_consultant', location: null,
    });
    const warning = out.warnings.find((w) => w.includes('terms have not been read'))!;
    expect(warning).toMatch(/pointers for a human/);
  });

  it('does not send a licensed provider through a search engine', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_executive', location: null,
    });
    expect(byId(out.queries, 'licensed_provider')).toBeUndefined();
    expect(out.warnings.some((w) => w.includes('through its own API'))).toBe(true);
    expect(sourceById('licensed_provider')!.access).toBe('licensed');
  });

  it('puts the location in every query that carries geography', () => {
    const out = generateDiscoveryQueries({
      terms: VOCABULARY, segment: 'senior_it_consultant', location: 'Toronto, Ontario',
    });
    expect(byId(out.queries, 'github_xray')!.query).toContain('"Toronto, Ontario"');
  });
});
