import type { SearchHit, DiscoveryQuery, DiscoverySource, WebSearchProvider } from './types';
import { sourceById } from './sources';
import { DiscoveryError } from './types';

/**
 * Run the queries and turn hits into candidate leads.
 *
 * A LEAD IS NOT A PERSON. It is a URL, a title, a snippet and the source that
 * produced it. Nothing here writes to the ledger, and that separation is the
 * point: the step that finds things and the step that asserts facts about
 * people are different steps with different rules, and collapsing them is how a
 * sourcing tool ends up holding a database of half read web pages presented as
 * a talent map.
 *
 * What happens next depends on the source's own terms position:
 *
 *   persist            a lead may become evidence in the ledger, through the
 *                      collection gate like anything else
 *   manual_entry_only  a lead is a pointer for a human to open, and only what
 *                      that human types reaches the ledger
 *
 * Unverified terms means manual entry whatever the entry claims, which
 * `enabledSources` enforces and the tests hold.
 */

export interface Lead {
  readonly sourceId: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly rank: number;
  /** Where this may go next, decided by the source rather than by the caller. */
  readonly disposition: 'may_persist' | 'human_reads_it';
  /** Set when the surface's terms have not been read. */
  readonly termsUnverified: boolean;
}

export interface HarvestResult {
  readonly leads: readonly Lead[];
  readonly bySource: ReadonlyMap<string, number>;
  readonly failures: readonly { sourceId: string; reason: string }[];
  readonly warnings: readonly string[];
}

/** Aggregator, job board and directory noise that survives the exclusions. */
const NOT_A_PERSON = [
  /\/jobs?\//i, /\/careers?\//i, /indeed\./i, /glassdoor\./i, /ziprecruiter\./i,
  /\/search\?/i, /\/tag\//i, /\/tags\//i, /\/category\//i,
];

const looksLikeAPerson = (hit: SearchHit): boolean =>
  !NOT_A_PERSON.some((p) => p.test(hit.url));

export async function harvest(
  provider: WebSearchProvider,
  queries: readonly DiscoveryQuery[],
  opts: { limitPerQuery?: number; region?: string } = {},
): Promise<HarvestResult> {
  const leads: Lead[] = [];
  const failures: { sourceId: string; reason: string }[] = [];
  const warnings: string[] = [];
  const bySource = new Map<string, number>();
  const seen = new Set<string>();

  for (const q of queries) {
    const source = sourceById(q.sourceId);
    if (!source) {
      failures.push({ sourceId: q.sourceId, reason: 'no such source in the catalogue' });
      continue;
    }

    let hits: readonly SearchHit[];
    try {
      hits = await provider.search({
        query: q.query,
        ...(opts.limitPerQuery === undefined ? {} : { limit: opts.limitPerQuery }),
        ...(opts.region === undefined ? {} : { region: opts.region }),
      });
    } catch (error) {
      // One surface failing is not the search failing. A provider outage on the
      // code host should not cost the recruiter the speaker programmes.
      failures.push({
        sourceId: q.sourceId,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    let kept = 0;
    for (const hit of hits) {
      if (!looksLikeAPerson(hit)) continue;
      const key = hit.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push(toLead(source, hit));
      kept += 1;
    }
    bySource.set(q.sourceId, kept);
    if (kept === 0 && hits.length > 0) {
      warnings.push(
        `${source.name}: every result looked like an advert or a listing page rather than a ` +
        'person. Widen the vocabulary or accept that this surface is cold for this mandate.',
      );
    }
  }

  if (leads.length === 0 && failures.length === queries.length && queries.length > 0) {
    throw new DiscoveryError(
      `every surface failed. First reason: ${failures[0]?.reason ?? 'unknown'}`,
    );
  }

  return { leads, bySource, failures, warnings };
}

function toLead(source: DiscoverySource, hit: SearchHit): Lead {
  const mayPersist = source.persistence === 'persist' && source.terms.verified;
  return {
    sourceId: source.id,
    url: hit.url,
    title: hit.title,
    snippet: hit.snippet,
    rank: hit.rank,
    disposition: mayPersist ? 'may_persist' : 'human_reads_it',
    termsUnverified: !source.terms.verified,
  };
}

/**
 * What the recruiter is told about a harvest, in their own terms.
 *
 * Reach is never overstated here. A run that produced two hundred pointers a
 * human must open is not the same as one that produced two hundred records, and
 * a sourcing tool that blurs the two is selling the wrong number.
 */
export function harvestSummary(result: HarvestResult): string {
  const persistable = result.leads.filter((l) => l.disposition === 'may_persist').length;
  const pointers = result.leads.length - persistable;
  const parts = [
    `${result.leads.length} lead(s) across ${result.bySource.size} surface(s).`,
    persistable > 0 ? `${persistable} may be recorded.` : null,
    pointers > 0
      ? `${pointers} are pointers for a human to open, because the surface is manual entry or its ` +
        'terms have not been read.'
      : null,
    result.failures.length > 0 ? `${result.failures.length} surface(s) failed.` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(' ');
}
