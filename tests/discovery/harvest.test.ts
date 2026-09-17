import { describe, expect, it } from 'vitest';
import {
  fixtureSearchProvider, harvest, harvestSummary, mapBraveResults, braveSearchProvider,
  MissingSearchCredentialsError, DiscoveryError, type SearchHit,
} from '@/discovery';

const hit = (url: string, rank: number, title = 'A Person'): SearchHit =>
  ({ url, title, snippet: 'talk on multi-cluster failover', rank });

const provider = (pairs: [string, SearchHit[]][]) =>
  fixtureSearchProvider(new Map(pairs));

describe('harvesting leads', () => {
  /**
   * The separation this whole layer rests on: finding a page and asserting a
   * fact about a person are different steps with different rules.
   */
  it('marks a pointer surface as something a human opens, never a record', async () => {
    const out = await harvest(
      provider([['q', [hit('https://www.linkedin.com/in/example', 1)]]]),
      [{ sourceId: 'linkedin_public_xray', query: 'q', rationale: 'x' }],
    );
    expect(out.leads[0]!.disposition).toBe('human_reads_it');
  });

  it('holds an unread surface at human entry however its catalogue entry reads', async () => {
    const out = await harvest(
      provider([['q', [hit('https://conf.example.org/speakers/ada', 1)]]]),
      [{ sourceId: 'conference_programmes', query: 'q', rationale: 'x' }],
    );
    // conference_programmes declares persist, but its terms are unread.
    expect(out.leads[0]!.disposition).toBe('human_reads_it');
    expect(out.leads[0]!.termsUnverified).toBe(true);
  });

  it('drops job boards and listing pages that survived the query exclusions', async () => {
    const out = await harvest(
      provider([['q', [
        hit('https://example.org/people/ada', 1),
        hit('https://www.indeed.com/jobs?q=vp', 2),
        hit('https://example.org/careers/vp-engineering', 3),
        hit('https://example.org/tag/kubernetes', 4),
      ]]]),
      [{ sourceId: 'conference_programmes', query: 'q', rationale: 'x' }],
    );
    expect(out.leads.map((l) => l.url)).toEqual(['https://example.org/people/ada']);
  });

  it('says so when a surface came back with nothing but adverts', async () => {
    const out = await harvest(
      provider([['q', [hit('https://www.glassdoor.com/jobs/x', 1)]]]),
      [{ sourceId: 'conference_programmes', query: 'q', rationale: 'x' }],
    );
    expect(out.leads).toHaveLength(0);
    expect(out.warnings[0]).toMatch(/cold for this mandate/);
  });

  it('deduplicates the same person found twice across surfaces', async () => {
    const out = await harvest(
      provider([
        ['a', [hit('https://example.org/people/ada', 1)]],
        ['b', [hit('https://example.org/people/ada/?utm_source=x#bio', 1)]],
      ]),
      [
        { sourceId: 'conference_programmes', query: 'a', rationale: 'x' },
        { sourceId: 'technical_writing', query: 'b', rationale: 'x' },
      ],
    );
    expect(out.leads).toHaveLength(1);
  });

  /** One surface failing is not the search failing. */
  it('keeps going when a surface fails, and reports which', async () => {
    const out = await harvest(
      provider([['good', [hit('https://example.org/people/ada', 1)]]]),
      [
        { sourceId: 'conference_programmes', query: 'missing', rationale: 'x' },
        { sourceId: 'technical_writing', query: 'good', rationale: 'x' },
      ],
    );
    expect(out.leads).toHaveLength(1);
    expect(out.failures.map((f) => f.sourceId)).toEqual(['conference_programmes']);
  });

  it('throws only when every surface failed', async () => {
    await expect(harvest(
      provider([]),
      [{ sourceId: 'conference_programmes', query: 'missing', rationale: 'x' }],
    )).rejects.toThrow(/every surface failed/);
  });

  it('refuses to invent a result the fixture never recorded', async () => {
    await expect(provider([]).search({ query: 'unknown' }))
      .rejects.toThrow(DiscoveryError);
  });

  /** Reach must never be overstated: pointers are not records. */
  it('reports pointers and records as different numbers', async () => {
    const out = await harvest(
      provider([['q', [hit('https://www.linkedin.com/in/ada', 1), hit('https://www.linkedin.com/in/rav', 2)]]]),
      [{ sourceId: 'linkedin_public_xray', query: 'q', rationale: 'x' }],
    );
    const summary = harvestSummary(out);
    expect(summary).toMatch(/2 lead\(s\)/);
    expect(summary).toMatch(/2 are pointers for a human to open/);
    expect(summary).not.toMatch(/may be recorded/);
  });
});

describe('the search provider at the edge', () => {
  it('maps a recorded Brave payload, stripping the highlight markup', () => {
    const hits = mapBraveResults({
      web: {
        results: [
          { url: 'https://example.org/a', title: '<strong>Ada</strong> Okafor', description: 'Talk on <em>Kubernetes</em> &amp; failover' },
          { title: 'no url, dropped', description: 'x' },
          { url: 'https://example.org/b', title: 'Ravi Menon', description: 'Maintainer' },
        ],
      },
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      url: 'https://example.org/a', title: 'Ada Okafor',
      snippet: 'Talk on Kubernetes & failover', rank: 1,
    });
    // Rank 3, not 2: the unusable middle entry was dropped but the provider's
    // own ordering is preserved rather than quietly renumbered.
    expect(hits[1]!.rank).toBe(3);
  });

  it('handles an empty payload without inventing anything', () => {
    expect(mapBraveResults({})).toEqual([]);
    expect(mapBraveResults({ web: {} })).toEqual([]);
  });

  it('says plainly when there is no key, and offers the fixture route', async () => {
    const p = braveSearchProvider({ apiKey: undefined });
    const previous = process.env['BRAVE_SEARCH_API_KEY'];
    delete process.env['BRAVE_SEARCH_API_KEY'];
    try {
      await expect(p.search({ query: 'x' })).rejects.toThrow(MissingSearchCredentialsError);
      await expect(p.search({ query: 'x' })).rejects.toThrow(/pass a fixture provider/);
    } finally {
      if (previous !== undefined) process.env['BRAVE_SEARCH_API_KEY'] = previous;
    }
  });

  it('shapes the request the way the published API documents', async () => {
    let seen: URL | null = null;
    const p = braveSearchProvider({
      apiKey: 'test-key',
      fetchImpl: (async (url: URL) => {
        seen = url;
        return { ok: true, json: async () => ({ web: { results: [] } }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    await p.search({ query: 'site:github.com "Kubernetes"', limit: 50, region: 'ca' });
    const url = seen as unknown as URL;
    expect(url.searchParams.get('q')).toBe('site:github.com "Kubernetes"');
    // The published ceiling is twenty per request, so a larger ask is clamped
    // rather than sent and rejected.
    expect(url.searchParams.get('count')).toBe('20');
    expect(url.searchParams.get('country')).toBe('CA');
  });

  it('surfaces an HTTP failure rather than returning nothing', async () => {
    const p = braveSearchProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' }) as unknown as Response) as unknown as typeof fetch,
    });
    await expect(p.search({ query: 'x' })).rejects.toThrow(/429 Too Many Requests/);
  });
});
