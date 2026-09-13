import { describe, expect, it } from 'vitest';
import { generateSearchStrings, MandateError, type MandateTerm } from '@/mandate';

const term = (kind: MandateTerm['kind'], t: string, status: MandateTerm['status'] = 'confirmed', rank = 0): MandateTerm => ({
  kind, term: t, origin: 'recruiter', status, observedCount: null, rank,
});

const workedExampleA: MandateTerm[] = [
  term('title_variant', 'VP Infrastructure', 'confirmed', 0),
  term('title_variant', 'Director, Cloud Infrastructure', 'confirmed', 1),
  term('title_variant', 'Head of Cloud and Infrastructure', 'confirmed', 2),
  term('must_have_skill', 'hybrid cloud', 'confirmed', 0),
  term('must_have_skill', 'Azure', 'confirmed', 1),
  term('must_have_skill', 'AWS', 'confirmed', 2),
  term('exclusion', 'sales', 'confirmed', 0),
];

describe('search string generation', () => {
  it('reproduces the workbook Boolean exactly', () => {
    const { strings } = generateSearchStrings({ terms: workedExampleA, location: 'Ottawa' });
    const boolean = strings.find((s) => s.kind === 'linkedin_recruiter_boolean');
    expect(boolean?.value).toBe(
      '("VP Infrastructure" OR "Director, Cloud Infrastructure" OR "Head of Cloud and Infrastructure") ' +
        'AND ("hybrid cloud" OR "Azure" OR "AWS") NOT ("sales")',
    );
  });

  it('capitalises the operators, because a lowercase or is read as a word', () => {
    const { strings } = generateSearchStrings({ terms: workedExampleA, location: null });
    for (const s of strings.filter((x) => x.kind !== 'provider_query')) {
      // Only the text OUTSIDE quoted phrases is operator territory. A phrase
      // like "Head of Cloud and Infrastructure" legitimately contains a
      // lowercase "and" and must be left exactly as the market writes it.
      const outsideQuotes = s.value.replace(/"[^"]*"/g, '');
      expect(outsideQuotes, s.kind).not.toMatch(/\b(or|and|not)\b/);
    }
  });

  it('strips advert noise from every open web search', () => {
    const { strings } = generateSearchStrings({ terms: workedExampleA, location: 'Ottawa' });
    for (const kind of ['github_xray', 'conference_talks_xray'] as const) {
      const s = strings.find((x) => x.kind === kind);
      expect(s?.value).toContain('-jobs -hiring -apply -careers');
    }
  });

  it('searches the code host on skills, not titles', () => {
    const { strings } = generateSearchStrings({ terms: workedExampleA, location: 'Ottawa' });
    const github = strings.find((s) => s.kind === 'github_xray');
    expect(github?.value).toBe('site:github.com ("hybrid cloud" OR "Azure" OR "AWS") "Ottawa" -jobs -hiring -apply -careers');
    expect(github?.value).not.toContain('VP Infrastructure');
  });

  it('emits a structured query for the licensed provider', () => {
    const { strings } = generateSearchStrings({ terms: workedExampleA, location: 'Ottawa' });
    const provider = strings.find((s) => s.kind === 'provider_query');
    expect(JSON.parse(provider!.value)).toEqual({
      anyOfTitles: ['VP Infrastructure', 'Director, Cloud Infrastructure', 'Head of Cloud and Infrastructure'],
      allOfSkillsAnyMatch: ['hybrid cloud', 'Azure', 'AWS'],
      noneOfTerms: ['sales'],
      location: 'Ottawa',
    });
  });

  it('uses only confirmed terms: a proposed term never reaches a search', () => {
    const withProposed = [...workedExampleA, term('title_variant', 'Chief Infrastructure Evangelist', 'proposed', 9)];
    const { strings } = generateSearchStrings({ terms: withProposed, location: null });
    expect(strings[0]!.value).not.toContain('Evangelist');
  });

  it('refuses to generate anything without a confirmed title', () => {
    const allProposed = workedExampleA.map((t) => ({ ...t, status: 'proposed' as const }));
    expect(() => generateSearchStrings({ terms: allProposed, location: null })).toThrow(MandateError);
    expect(() => generateSearchStrings({ terms: allProposed, location: null })).toThrow(
      /confirm the market vocabulary/,
    );
  });

  it('warns rather than silently failing on a LinkedIn stop word', () => {
    const terms = [...workedExampleA, term('must_have_skill', 'for', 'confirmed', 5)];
    const { warnings } = generateSearchStrings({ terms, location: null });
    expect(warnings.find((w) => w.term === 'for')?.warning).toMatch(/ignores this word/);
  });

  it('explains why no code host search was produced when there is no skill', () => {
    const titlesOnly = workedExampleA.filter((t) => t.kind === 'title_variant');
    const { strings, warnings } = generateSearchStrings({ terms: titlesOnly, location: null });
    expect(strings.find((s) => s.kind === 'github_xray')).toBeUndefined();
    expect(warnings.some((w) => /indexes work, not titles/.test(w.warning))).toBe(true);
  });

  it('omits the skill clause entirely rather than emitting an empty group', () => {
    const titlesOnly = workedExampleA.filter((t) => t.kind === 'title_variant');
    const { strings } = generateSearchStrings({ terms: titlesOnly, location: null });
    expect(strings[0]!.value).toBe(
      '("VP Infrastructure" OR "Director, Cloud Infrastructure" OR "Head of Cloud and Infrastructure")',
    );
  });
});
