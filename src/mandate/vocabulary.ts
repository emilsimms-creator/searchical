import type { MandateTerm } from './types';

/**
 * Observed frequency of a candidate title within the target universe.
 *
 * Phase one ships the interface and a fixture implementation. The live one is a
 * query against the licensed professional data provider, behind the connector
 * abstraction so the provider is swappable. See architecture.md s10.3.
 */
export interface TitleFrequencySource {
  readonly id: string;
  /**
   * How many people in the target universe actually hold each term as a title.
   * Returns a count for EVERY term asked about, including zero, because a zero
   * is information the recruiter needs.
   */
  observedCounts(
    terms: readonly string[],
    universe: { targetCompanies: readonly string[]; location: string | null },
  ): Promise<ReadonlyMap<string, number>>;
}

export interface ValidatedVocabulary {
  readonly terms: readonly MandateTerm[];
  /** Terms the market does not use, kept visible rather than dropped. */
  readonly zeroCount: readonly MandateTerm[];
  readonly checkedAgainst: string | null;
  readonly note: string;
}

/**
 * Validate proposed title variants against observed reality.
 *
 * This is the step everything else depends on. A language model will write an
 * excellent search string for the wrong search, because it does not know that
 * this market calls the role something else or that the title the hiring
 * manager invented does not exist at the companies you should be targeting.
 *
 * Variants are ranked by observed frequency. A variant that appears zero times
 * is returned separately so the interface can show it struck through with its
 * count, because a zero is a finding rather than a null result. Nothing is
 * silently dropped, and nothing is auto confirmed: a human still accepts or
 * edits the list before the mandate goes live. See architecture.md s5.2.
 */
export async function validateVocabulary(
  proposed: readonly MandateTerm[],
  universe: { targetCompanies: readonly string[]; location: string | null },
  source: TitleFrequencySource | null,
): Promise<ValidatedVocabulary> {
  const titles = proposed.filter((t) => t.kind === 'title_variant');
  const others = proposed.filter((t) => t.kind !== 'title_variant');

  if (source === null) {
    return {
      terms: proposed,
      zeroCount: [],
      checkedAgainst: null,
      note:
        'No title frequency source configured, so the variants are unvalidated model output. ' +
        'Treat every one as a hypothesis and confirm against your own market knowledge.',
    };
  }

  const counts = await source.observedCounts(
    titles.map((t) => t.term),
    universe,
  );

  const scored: MandateTerm[] = titles
    .map((t) => ({ ...t, observedCount: counts.get(t.term) ?? 0 }))
    .sort((a, b) => (b.observedCount ?? 0) - (a.observedCount ?? 0))
    .map((t, index) => ({ ...t, rank: index }));

  const present = scored.filter((t) => (t.observedCount ?? 0) > 0);
  const zero = scored.filter((t) => (t.observedCount ?? 0) === 0);

  return {
    terms: [...present, ...zero, ...others],
    zeroCount: zero,
    checkedAgainst: source.id,
    note:
      zero.length === 0
        ? `All ${present.length} proposed titles appear in the target universe. Ranked by observed frequency.`
        : `${zero.length} of ${scored.length} proposed titles appear nowhere in the target universe. ` +
          `They are shown with a zero count rather than dropped: either the market calls the role something ` +
          `else, or the target company list is wrong.`,
  };
}

/** A fixture backed source for tests and for running before a provider is contracted. */
export function fixtureTitleFrequency(
  counts: Record<string, number>,
  id = 'fixture-title-frequency',
): TitleFrequencySource {
  return {
    id,
    async observedCounts(terms) {
      return new Map(terms.map((t) => [t, counts[t] ?? 0]));
    },
  };
}
