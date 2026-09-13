import { describe, expect, it } from 'vitest';
import { fixtureTitleFrequency, validateVocabulary, type MandateTerm } from '@/mandate';

const proposed = (term: string, rank: number): MandateTerm => ({
  kind: 'title_variant', term, origin: 'extracted', status: 'proposed', observedCount: null, rank,
});

const universe = { targetCompanies: ['National Bank of Example'], location: 'Ottawa' };

describe('market vocabulary validation', () => {
  it('ranks variants by how often the market actually uses them', async () => {
    const result = await validateVocabulary(
      [proposed('Chief Infrastructure Evangelist', 0), proposed('VP Infrastructure', 1), proposed('Director, Cloud Infrastructure', 2)],
      universe,
      fixtureTitleFrequency({ 'VP Infrastructure': 240, 'Director, Cloud Infrastructure': 96, 'Chief Infrastructure Evangelist': 0 }),
    );

    expect(result.terms.map((t) => t.term)).toEqual([
      'VP Infrastructure',
      'Director, Cloud Infrastructure',
      'Chief Infrastructure Evangelist',
    ]);
    expect(result.terms[0]!.rank).toBe(0);
  });

  it('keeps a zero count term visible rather than dropping it', async () => {
    const result = await validateVocabulary(
      [proposed('VP Infrastructure', 0), proposed('Chief Infrastructure Evangelist', 1)],
      universe,
      fixtureTitleFrequency({ 'VP Infrastructure': 240 }),
    );

    expect(result.zeroCount.map((t) => t.term)).toEqual(['Chief Infrastructure Evangelist']);
    // Still present in the list, with its count, so the recruiter can see it.
    expect(result.terms.find((t) => t.term === 'Chief Infrastructure Evangelist')?.observedCount).toBe(0);
    expect(result.note).toMatch(/appear nowhere in the target universe/);
    expect(result.note).toMatch(/or the target company list is wrong/);
  });

  it('never auto confirms: validation ranks, a human decides', async () => {
    const result = await validateVocabulary(
      [proposed('VP Infrastructure', 0)],
      universe,
      fixtureTitleFrequency({ 'VP Infrastructure': 500 }),
    );
    expect(result.terms.every((t) => t.status === 'proposed')).toBe(true);
  });

  it('says plainly when there is no source to validate against', async () => {
    const result = await validateVocabulary([proposed('VP Infrastructure', 0)], universe, null);
    expect(result.checkedAgainst).toBeNull();
    expect(result.note).toMatch(/unvalidated model output/);
    expect(result.terms[0]!.observedCount).toBeNull();
  });

  it('leaves skills and exclusions alone', async () => {
    const terms: MandateTerm[] = [
      proposed('VP Infrastructure', 0),
      { kind: 'must_have_skill', term: 'Azure', origin: 'extracted', status: 'proposed', observedCount: null, rank: 0 },
    ];
    const result = await validateVocabulary(terms, universe, fixtureTitleFrequency({ 'VP Infrastructure': 10 }));
    expect(result.terms.find((t) => t.kind === 'must_have_skill')?.observedCount).toBeNull();
  });
});
