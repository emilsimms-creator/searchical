import { DiscoveryError, type SearchHit, type SearchRequest, type WebSearchProvider } from './types';

/**
 * Web search, behind one interface.
 *
 * The autonomous sourcing tools reach the open web through a commercial search
 * API, and so does this. Which one is a commercial decision that should not
 * reach into the code, so the choice lives at the edge and everything inland
 * depends only on the interface. This is the same shape as `LanguageModel`, and
 * for the same reason.
 */

/**
 * A provider backed by recorded results.
 *
 * Not a mock in the testing sense. It is how the whole discovery layer is built
 * and tested without a key, a network or a bill, and it is how a regression is
 * pinned once a real query has produced a surprising result: record the hits,
 * feed them back in, and the failure is reproducible forever after.
 */
export function fixtureSearchProvider(
  fixtures: ReadonlyMap<string, readonly SearchHit[]>,
): WebSearchProvider {
  return {
    id: 'fixture',
    displayName: 'Recorded search results',
    async search(request: SearchRequest): Promise<readonly SearchHit[]> {
      const hits = fixtures.get(request.query);
      if (hits === undefined) {
        throw new DiscoveryError(
          `no recorded result for this query, and the fixture provider will not invent one:\n  ${request.query}`,
        );
      }
      return hits.slice(0, request.limit ?? hits.length);
    },
  };
}

export class MissingSearchCredentialsError extends DiscoveryError {}

/**
 * Brave Search, as the reference real adapter.
 *
 * Chosen because it runs its own index rather than reselling another engine's,
 * publishes its terms plainly and does not require a business agreement to
 * start. Swapping it is one file: nothing above this line knows which engine
 * answered.
 *
 * NOTE, and it is an honest one: this adapter has never made a live call. The
 * environment it was written in has no key and its egress proxy blocks every
 * search API host. The request shaping and the response mapping are written
 * from the published API and are covered by tests against recorded payloads,
 * but the first real call will be made by whoever runs this with a key, and
 * they should expect to fix something.
 */
export function braveSearchProvider(opts: {
  apiKey?: string | undefined;
  endpoint?: string;
  fetchImpl?: typeof fetch;
} = {}): WebSearchProvider {
  const endpoint = opts.endpoint ?? 'https://api.search.brave.com/res/v1/web/search';
  return {
    id: 'brave',
    displayName: 'Brave Search API',
    async search(request: SearchRequest): Promise<readonly SearchHit[]> {
      const key = opts.apiKey ?? process.env['BRAVE_SEARCH_API_KEY'];
      if (!key) {
        throw new MissingSearchCredentialsError(
          'No Brave Search key. Set BRAVE_SEARCH_API_KEY, or pass a fixture provider to run the ' +
            'discovery layer without one.',
        );
      }
      const url = new URL(endpoint);
      url.searchParams.set('q', request.query);
      url.searchParams.set('count', String(Math.min(request.limit ?? 20, 20)));
      if (request.region) url.searchParams.set('country', request.region.toUpperCase());

      const doFetch = opts.fetchImpl ?? fetch;
      const res = await doFetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      });
      if (!res.ok) {
        throw new DiscoveryError(`Brave Search returned ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as { web?: { results?: unknown[] } };
      return mapBraveResults(body);
    },
  };
}

/** Separated so the mapping can be tested against a recorded payload. */
export function mapBraveResults(body: { web?: { results?: unknown[] } }): readonly SearchHit[] {
  const results = body.web?.results ?? [];
  return results.flatMap((raw, index) => {
    const r = raw as { url?: unknown; title?: unknown; description?: unknown };
    if (typeof r.url !== 'string' || r.url === '') return [];
    return [{
      url: r.url,
      title: typeof r.title === 'string' ? stripTags(r.title) : '',
      snippet: typeof r.description === 'string' ? stripTags(r.description) : '',
      rank: index + 1,
    }];
  });
}

/** Search APIs return highlighted fragments. The markup is not part of the text. */
const stripTags = (s: string): string =>
  s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
