/**
 * Who is off limits for a mandate.
 *
 * The first thing a contract search should settle is who not to approach, and
 * the hardest to see later: the client's own staff, the vendors who work for
 * them, anyone under a non solicit. Recorded here before names are worked, so a
 * screen can say so instead of leaving it to somebody's memory.
 */

export type OffLimitsBasis = 'client_vendor' | 'client_staff' | 'non_solicit' | 'other';

export const OFF_LIMITS_BASES: readonly OffLimitsBasis[] = ['client_vendor', 'client_staff', 'non_solicit', 'other'];

export interface OffLimitsEntry {
  readonly name: string;
  /** Other names the same organisation goes by, only once confirmed to be the same one. */
  readonly aliases: readonly string[];
  readonly basis: OffLimitsBasis;
  /** Who said so, and when. */
  readonly source: string;
}

export interface OffLimitsHit {
  readonly entry: OffLimitsEntry;
  /** The name that matched, as the entry spells it. */
  readonly matchedName: string;
}

const normalise = (text: string): string =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether a piece of evidence names an off limits organisation.
 *
 * Whole words only, so "FCI" does not match inside "Pacific", and deliberately
 * generous in the other direction: "FCI Connectors" matches too. A false hit
 * costs a recruiter a look. A false miss approaches somebody the client said not
 * to, which is the thing this exists to prevent, so every hit is a question for
 * a person and never a verdict.
 */
export function matchOffLimits(text: string, entries: readonly OffLimitsEntry[]): OffLimitsHit | null {
  const haystack = normalise(text);
  for (const entry of entries) {
    for (const name of [entry.name, ...entry.aliases]) {
      const n = name.trim().toLowerCase();
      if (n === '') continue;
      const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s,]+');
      // Lookarounds rather than \b: a name that ends in punctuation, such as "Inc.", has no word boundary after it.
      if (new RegExp(`(?<![\\w])${escaped}(?![\\w])`).test(haystack)) return { entry, matchedName: name };
    }
  }
  return null;
}
