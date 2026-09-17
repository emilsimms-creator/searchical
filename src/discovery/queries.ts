import type { MandateTerm } from '@/mandate/types';
import { DISCOVERY_SOURCES, searchableSources } from './sources';
import type { DiscoveryQuery, DiscoverySource } from './types';
import type { SupportedSegment } from '@/mandate/types';

/**
 * Turn a confirmed mandate vocabulary into one query per discovery surface.
 *
 * Only CONFIRMED terms are used, for the same reason the outreach search
 * strings use only confirmed terms: the failure mode is an excellent query for
 * the wrong search, and a model's proposal that no human accepted is exactly
 * that. See architecture.md s5.2.
 *
 * Each surface gets a query shaped for what it is. A speaker programme is found
 * by title plus the words a programme page uses; a code host is found by skill,
 * because a title alone finds nothing there. This is the part the autonomous
 * tools get right and the naive X-ray generators get wrong: one query template
 * across every site returns the same mediocre results everywhere.
 */

const quote = (term: string): string => `"${term.replace(/"/g, '')}"`;
const orGroup = (terms: readonly string[]): string => terms.map(quote).join(' OR ');

const confirmed = (terms: readonly MandateTerm[], kind: MandateTerm['kind']): string[] =>
  terms
    .filter((t) => t.kind === kind && t.status === 'confirmed')
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.term.trim())
    .filter((t) => t.length > 0);

/**
 * Words that mean the page is an advert rather than a person.
 *
 * Without these a title X-ray returns job boards all the way down, which is the
 * single commonest way an open web sourcing query wastes an afternoon.
 */
const ADVERT_EXCLUSIONS = ['-jobs', '-hiring', '-apply', '-careers', '-"job description"', '-recruiter'];

export interface QueryInput {
  readonly terms: readonly MandateTerm[];
  readonly segment: SupportedSegment;
  readonly location: string | null;
  /** Companies worth naming explicitly, from the mandate's target list. */
  readonly targetCompanies?: readonly string[];
}

export interface GeneratedQueries {
  readonly queries: readonly DiscoveryQuery[];
  readonly warnings: readonly string[];
}

export function generateDiscoveryQueries(input: QueryInput): GeneratedQueries {
  const titles = confirmed(input.terms, 'title_variant');
  const skills = confirmed(input.terms, 'must_have_skill');
  const warnings: string[] = [];
  const queries: DiscoveryQuery[] = [];

  if (titles.length === 0 && skills.length === 0) {
    return {
      queries: [],
      warnings: [
        'No confirmed titles or skills, so no query can be formed. Confirm the market vocabulary ' +
        'first: a query built from unconfirmed terms searches for the wrong person very efficiently.',
      ],
    };
  }

  const place = input.location ? quote(input.location) : '';
  const titleGroup = titles.length > 0 ? `(${orGroup(titles)})` : '';
  const skillGroup = skills.length > 0 ? `(${orGroup(skills)})` : '';

  for (const source of searchableSources(input.segment)) {
    const built = queryFor(source, { titleGroup, skillGroup, place, titles, skills, input });
    if (built === null) {
      warnings.push(
        `${source.name}: no query formed. ${
          source.access === 'licensed'
            ? 'A licensed provider is queried through its own API, not through a search engine.'
            : 'This surface needs a term kind the mandate has not confirmed.'
        }`,
      );
      continue;
    }
    queries.push(built);
  }

  const unverified = DISCOVERY_SOURCES.filter(
    (s) => s.segments.includes(input.segment) && s.persistence === 'persist' && !s.terms.verified,
  );
  if (unverified.length > 0) {
    warnings.push(
      `${unverified.length} surface(s) can be searched but not recorded, because their terms have ` +
      `not been read: ${unverified.map((s) => s.name).join('; ')}. Results are pointers for a human ` +
      'until somebody reads the terms and dates the reading.',
    );
  }

  return { queries, warnings };
}

interface Parts {
  titleGroup: string;
  skillGroup: string;
  place: string;
  titles: readonly string[];
  skills: readonly string[];
  input: QueryInput;
}

function queryFor(source: DiscoverySource, p: Parts): DiscoveryQuery | null {
  const join = (...bits: string[]) => bits.filter((b) => b !== '').join(' ');
  const site = source.site ? `site:${source.site}` : '';

  switch (source.id) {
    case 'linkedin_public_xray':
      if (p.titleGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(site, p.titleGroup, p.skillGroup, p.place, ...ADVERT_EXCLUSIONS),
        rationale:
          'Title led, because a LinkedIn headline is a title. Returns pointers a recruiter opens ' +
          'on their own seat; nothing here is recorded.',
      };

    case 'github_xray':
      // A title alone finds nothing on a code host: nobody writes "VP
      // Engineering" in a repository. Skill is the only workable axis.
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(site, p.skillGroup, p.place, '-jobs', '-hiring'),
        rationale:
          'Skill led. A code host indexes what people build, not what their title is, so a title ' +
          'query returns nothing useful here.',
      };

    case 'conference_programmes':
      if (p.titleGroup === '' && p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(
          p.skillGroup !== '' ? p.skillGroup : p.titleGroup,
          '(speaker OR keynote OR panel OR "session abstract" OR programme OR program)',
          p.place, ...ADVERT_EXCLUSIONS,
        ),
        rationale:
          'A speaker list is a pre vetted shortlist and supplies the specific hook the ' +
          'personalisation gate requires, which is why this surface is worth more per result than ' +
          'a general title search.',
      };

    case 'corporate_leadership_pages': {
      if (p.titleGroup === '') return null;
      const companies = (p.input.targetCompanies ?? []).slice(0, 6);
      const companyGroup = companies.length > 0 ? `(${orGroup(companies)})` : '';
      return {
        sourceId: source.id,
        query: join(
          p.titleGroup,
          '(leadership OR "our team" OR "executive team" OR "senior leadership")',
          companyGroup, p.place, ...ADVERT_EXCLUSIONS,
        ),
        rationale: companies.length > 0
          ? 'Bounded to the mandate\'s own target companies, which is what makes this a market map ' +
            'rather than a web search.'
          : 'No target companies confirmed, so this runs unbounded and will be noisy. Confirm the ' +
            'target list to make it useful.',
      };
    }

    case 'technical_writing':
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(
          p.skillGroup,
          '(migration OR "lessons learned" OR postmortem OR "how we" OR retrospective)',
          '(site:dev.to OR site:hashnode.com OR site:medium.com OR inurl:blog)',
          ...ADVERT_EXCLUSIONS,
        ),
        rationale:
          'Someone who wrote up a migration they led has handed you the evidence and the hook in ' +
          'one artefact.',
      };

    case 'stack_overflow':
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(site, p.skillGroup, 'inurl:users', p.place),
        rationale: 'Profile pages rather than answer pages, so the result is a person.',
      };

    case 'foundation_contributors':
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(
          p.skillGroup,
          '(maintainer OR "technical oversight" OR "steering committee" OR contributors OR governance)',
          '(site:cncf.io OR site:apache.org OR site:linuxfoundation.org)',
        ),
        rationale:
          'Governance rosters name the most senior practitioners in a technology, published by the ' +
          'foundation itself.',
      };

    case 'vendor_ambassador_programmes':
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(
          p.skillGroup,
          '("Community Builder" OR "Most Valuable Professional" OR MVP OR "Developer Expert" OR Ambassador)',
          p.place,
        ),
        rationale:
          'The vendor has already assessed depth in its own platform and published the result. For ' +
          'a mandate naming a specific platform this is the best ratio on the open web.',
      };

    case 'orcid':
      if (p.skillGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(site, p.skillGroup, p.place),
        rationale: 'Applied research leadership, where the record holder controls what is public.',
      };

    case 'regulatory_filings':
      if (p.titleGroup === '') return null;
      return {
        sourceId: source.id,
        query: join(
          p.titleGroup,
          '(site:sedarplus.ca OR site:find-and-update.company-information.service.gov.uk OR site:sec.gov)',
          (p.input.targetCompanies ?? []).length > 0
            ? `(${orGroup((p.input.targetCompanies ?? []).slice(0, 6))})`
            : '',
        ),
        rationale:
          'Statutory filings name officers authoritatively. Authoritative on the role, silent on ' +
          'receptivity.',
      };

    // A licensed provider is queried through its own API with a structured
    // request, not through a search engine. `src/mandate/strings.ts` already
    // emits that structured query for the mandate.
    case 'licensed_provider':
      return null;

    default:
      return null;
  }
}
