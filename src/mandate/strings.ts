import { MandateError, type MandateTerm, type SearchString } from './types';

/**
 * LinkedIn's search ignores these words, so a term that is only a stop word
 * silently matches nothing. Surfaced as a warning rather than a silent failure.
 * Source: LinkedIn Help, Boolean search on Recruiter.
 */
const LINKEDIN_STOP_WORDS = new Set([
  'and', 'or', 'the', 'of', 'at', 'by', 'to', 'for', 'with', 'in', 'they', 'have', 'from', 'not', 'but', 'after',
]);

/** Noise that turns a people search into a job advert search. Tegze (Jul 2026). */
const ADVERT_EXCLUSIONS = ['-jobs', '-hiring', '-apply', '-careers'] as const;

export interface StringGenerationWarning {
  readonly term: string;
  readonly warning: string;
}

export interface GeneratedStrings {
  readonly strings: readonly SearchString[];
  readonly warnings: readonly StringGenerationWarning[];
}

const quote = (term: string): string => `"${term.replace(/"/g, '')}"`;

/** Capitalised OR: a lowercase `or` is treated as a word, not an operator. */
const orGroup = (terms: readonly string[]): string => terms.map(quote).join(' OR ');

const confirmed = (terms: readonly MandateTerm[], kind: MandateTerm['kind']): string[] =>
  terms
    .filter((t) => t.kind === kind && t.status === 'confirmed')
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.term.trim())
    .filter((t) => t.length > 0);

export interface StringGenerationInput {
  readonly terms: readonly MandateTerm[];
  readonly location: string | null;
  /**
   * The channel plan for this mandate, when one exists.
   *
   * A search string for a channel the same plan tells the recruiter to skip is
   * a contradiction inside one output. A live run produced a code host X-ray
   * for a corporate strategy executive while listing the code host under
   * "Skipped", which is how this was found.
   */
  readonly skippedChannels?: readonly string[];
}

/**
 * Generate the search strings for a mandate.
 *
 * Only CONFIRMED terms are used. A term a model proposed and a human has not
 * accepted never reaches a search string, because the failure mode this guards
 * against is an excellent search string for the wrong search. See
 * architecture.md s5.2.
 *
 * Formats follow the practice's own workbook (Outreach Channel Matrix, JD to
 * Channel Plan sheet) so a recruiter who knows the spreadsheet recognises the
 * output.
 */
export function generateSearchStrings(input: StringGenerationInput): GeneratedStrings {
  const titles = confirmed(input.terms, 'title_variant');
  const skills = confirmed(input.terms, 'must_have_skill');
  const exclusions = confirmed(input.terms, 'exclusion');

  if (titles.length === 0) {
    throw new MandateError(
      'no confirmed title variants: a recruiter must confirm the market vocabulary before strings are generated',
    );
  }

  const warnings: StringGenerationWarning[] = [];
  for (const term of [...titles, ...skills, ...exclusions]) {
    if (LINKEDIN_STOP_WORDS.has(term.toLowerCase())) {
      warnings.push({
        term,
        warning: 'LinkedIn ignores this word in search, so on its own it matches nothing.',
      });
    }
    if (/\b(or|and|not)\b/.test(term) && term === term.toLowerCase()) {
      warnings.push({
        term,
        warning: 'Contains a lowercase boolean word, which LinkedIn reads as a word rather than an operator.',
      });
    }
  }

  const location = input.location?.trim() ?? '';
  const titleGroup = `(${orGroup(titles)})`;
  const skillGroup = skills.length > 0 ? `(${orGroup(skills)})` : '';
  const exclusionGroup = exclusions.length > 0 ? ` NOT (${orGroup(exclusions)})` : '';

  const strings: SearchString[] = [
    {
      kind: 'linkedin_recruiter_boolean',
      value: `${titleGroup}${skillGroup ? ` AND ${skillGroup}` : ''}${exclusionGroup}`,
    },
    {
      kind: 'conference_talks_xray',
      value: [
        titleGroup,
        skillGroup,
        '(speaker OR keynote OR panel OR talk)',
        location ? quote(location) : '',
        // Excluding the noise matters more than including the keywords.
        ADVERT_EXCLUSIONS.join(' '),
      ]
        .filter(Boolean)
        .join(' '),
    },
  ];

  const skipped = new Set(input.skippedChannels ?? []);

  // The code host X-ray needs a skill to search on; a title alone finds nothing
  // there, because the evidence on that surface is the work, not the job title.
  if (skipped.has('github')) {
    warnings.push({
      term: '(code host)',
      warning:
        'No code host search was generated: the channel plan rates that surface as skipped for this ' +
        'segment. A search string for a channel the plan tells you to skip is worse than none.',
    });
  } else if (skills.length > 0) {
    strings.push({
      kind: 'github_xray',
      value: ['site:github.com', skillGroup, location ? quote(location) : '', ADVERT_EXCLUSIONS.join(' ')]
        .filter(Boolean)
        .join(' '),
    });
  } else {
    warnings.push({
      term: '(none)',
      warning:
        'No confirmed must have skill, so no code host search was generated. That surface indexes work, not titles.',
    });
  }

  if (skipped.has('conferences_and_summits')) {
    // Drop the conference X-ray the same way, and say so.
    const index = strings.findIndex((s) => s.kind === 'conference_talks_xray');
    if (index >= 0) strings.splice(index, 1);
    warnings.push({
      term: '(conferences)',
      warning: 'No conference search was generated: the channel plan rates that surface as skipped.',
    });
  }

  strings.push({
    kind: 'provider_query',
    value: JSON.stringify(
      {
        anyOfTitles: titles,
        allOfSkillsAnyMatch: skills,
        noneOfTerms: exclusions,
        ...(location ? { location } : {}),
      },
      null,
      0,
    ),
  });

  return { strings, warnings };
}
