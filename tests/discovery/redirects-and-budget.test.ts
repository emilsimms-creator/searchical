import { describe, expect, it } from 'vitest';
import { DEFAULT_FETCH_BUDGET, Promoter, type Lead, type PageFetcher } from '@/discovery';

const lead = (url: string): Lead => ({
  sourceId: 'conference_programmes', url, title: 'Ada', snippet: 'talk', rank: 1,
  disposition: 'human_reads_it', termsUnverified: true,
});

const PAGE = '<html><body><p>Ada Okafor, VP Engineering</p></body></html>';

function recorded(pages: Record<string, {
  status?: number; contentType?: string; body?: string; location?: string;
}>): PageFetcher & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'recorded', calls,
    async fetchText(url) {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error(`no recorded page for ${url}`);
      return {
        status: page.status ?? 200,
        contentType: page.contentType ?? 'text/html',
        body: page.body ?? PAGE,
        location: page.location ?? null,
      };
    },
  };
}

const noSleep = { sleep: async () => {} };

describe('redirects are re-checked against the host that answers', () => {
  /**
   * The defect this fixes: a site that disallows this crawler could be reached
   * anyway by any page elsewhere that happened to redirect to it.
   */
  it('refuses a redirect to a host whose robots disallows it', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { status: 301, location: 'https://b.example.org/ada' },
      'https://b.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/ada'));

    expect(p.promoted).toBe(false);
    expect(p.refusal?.reason).toBe('robots_disallows');
    expect(p.refusal?.detail).toMatch(/redirected to b\.example\.org, which says Disallow: \//);
    // The second host's page was never requested, only its robots.txt.
    expect(fetcher.calls).not.toContain('https://b.example.org/ada');
  });

  it('follows a redirect the new host permits, and reads the page there', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { status: 302, location: 'https://b.example.org/people/ada' },
      'https://b.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /admin' },
      'https://b.example.org/people/ada': { body: PAGE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/ada'));

    expect(p.promoted).toBe(true);
    expect(p.text).toContain('VP Engineering');
    // The chain is what was really read, and it is what a citation should name.
    expect(p.chain).toEqual(['https://a.example.org/ada', 'https://b.example.org/people/ada']);
  });

  it('resolves a relative redirect against the page it came from', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/speakers/ada': { status: 301, location: '/people/ada' },
      'https://a.example.org/people/ada': { body: PAGE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/speakers/ada'));
    expect(p.promoted).toBe(true);
    expect(p.chain[1]).toBe('https://a.example.org/people/ada');
  });

  it('applies the new host own robots rules, not the first host permissive ones', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: 'User-agent: *\nAllow: /' },
      'https://a.example.org/ada': { status: 301, location: 'https://b.example.org/private/ada' },
      'https://b.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /private' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/ada'));
    expect(p.refusal?.reason).toBe('robots_disallows');
  });

  it('stops a redirect loop rather than chasing it', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/one': { status: 302, location: 'https://a.example.org/two' },
      'https://a.example.org/two': { status: 302, location: 'https://a.example.org/one' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/one'));
    expect(p.refusal?.reason).toBe('too_many_redirects');
    expect(p.chain.length).toBeGreaterThan(2);
  });

  it('treats a redirect with no location as the error it is', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { status: 301 },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('https://a.example.org/ada'));
    expect(p.refusal?.reason).toBe('http_error');
    expect(p.refusal?.detail).toMatch(/no location/);
  });

  it('waits for the second host before fetching it', async () => {
    const waits: number[] = [];
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { status: 301, location: 'https://b.example.org/ada' },
      'https://b.example.org/robots.txt': { body: 'User-agent: *\nCrawl-delay: 30' },
      'https://b.example.org/ada': { body: PAGE },
    });
    const promoter = new Promoter(fetcher, { sleep: async (ms) => { waits.push(ms); } });
    await promoter.promote(lead('https://a.example.org/ada'));
    await promoter.promote(lead('https://b.example.org/ada'));
    // The second host names thirty seconds, and it is honoured on its own terms.
    expect(waits.some((w) => w > 29_000)).toBe(true);
  });
});

describe('the fetch budget', () => {
  /**
   * The crawl delay bounds the rate and nothing else. Politeness at two seconds
   * a request is still several hundred requests over an afternoon.
   */
  it('stops at the per host cap and says what happened', async () => {
    const pages: Record<string, { body: string }> = { 'https://small.example.org/robots.txt': { body: '' } };
    for (let i = 0; i < 20; i += 1) pages[`https://small.example.org/p${i}`] = { body: PAGE };
    const fetcher = recorded(pages);
    // Three requests total for this host: robots, then two pages.
    const promoter = new Promoter(fetcher, { ...noSleep, budget: { perHost: 3 } });

    const first = await promoter.promote(lead('https://small.example.org/p0'));
    const second = await promoter.promote(lead('https://small.example.org/p1'));
    const third = await promoter.promote(lead('https://small.example.org/p2'));

    expect(first.promoted).toBe(true);
    expect(second.promoted).toBe(true);
    expect(third.promoted).toBe(false);
    expect(third.refusal?.reason).toBe('budget_exhausted');
    expect(third.refusal?.detail).toMatch(/budget for small\.example\.org is spent \(3 requests\)/);
    expect(third.refusal?.detail).toMatch(/leaning on a stranger's server/);
    expect(fetcher.calls).toHaveLength(3);
  });

  /** robots.txt is a request to somebody's server like any other. */
  it('counts robots.txt, the page and every redirect hop', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { status: 301, location: 'https://a.example.org/people/ada' },
      'https://a.example.org/people/ada': { body: PAGE },
    });
    const promoter = new Promoter(fetcher, noSleep);
    await promoter.promote(lead('https://a.example.org/ada'));

    const spend = promoter.spend();
    expect(spend.total).toBe(3);
    expect(spend.byHost.get('a.example.org')).toBe(3);
  });

  it('caps the run as a whole, across every host', async () => {
    const pages: Record<string, { body: string }> = {};
    for (let i = 0; i < 6; i += 1) {
      pages[`https://h${i}.example.org/robots.txt`] = { body: '' };
      pages[`https://h${i}.example.org/ada`] = { body: PAGE };
    }
    const promoter = new Promoter(recorded(pages), { ...noSleep, budget: { total: 5 } });

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await promoter.promote(lead(`https://h${i}.example.org/ada`)));
    }
    // Two hosts at two requests each fills five, so the third host is refused.
    expect(results.filter((r) => r.promoted)).toHaveLength(2);
    expect(results[2]!.refusal?.reason).toBe('budget_exhausted');
    expect(results[2]!.refusal?.detail).toMatch(/Total fetch budget/);
  });

  it('reports what a run has spent, so load can be stated rather than guessed', async () => {
    const fetcher = recorded({
      'https://a.example.org/robots.txt': { body: '' },
      'https://a.example.org/ada': { body: PAGE },
      'https://b.example.org/robots.txt': { body: '' },
      'https://b.example.org/rav': { body: PAGE },
    });
    const promoter = new Promoter(fetcher, noSleep);
    await promoter.promote(lead('https://a.example.org/ada'));
    await promoter.promote(lead('https://b.example.org/rav'));

    const spend = promoter.spend();
    expect(spend.total).toBe(4);
    expect([...spend.byHost.entries()].sort()).toEqual([
      ['a.example.org', 2], ['b.example.org', 2],
    ]);
    expect(spend.budget).toEqual(DEFAULT_FETCH_BUDGET);
  });

  it('ships a default budget rather than leaving it unset', () => {
    expect(DEFAULT_FETCH_BUDGET.perHost).toBeGreaterThan(0);
    expect(DEFAULT_FETCH_BUDGET.total).toBeGreaterThan(DEFAULT_FETCH_BUDGET.perHost);
  });

  it('never fetches for a source that forbids automated access, budget or not', async () => {
    const fetcher = recorded({});
    const p = await new Promoter(fetcher, noSleep).promote({
      ...lead('https://www.linkedin.com/in/ada'), sourceId: 'linkedin_public_xray',
    });
    expect(p.refusal?.reason).toBe('source_forbids_automated_fetch');
    expect(fetcher.calls).toEqual([]);
  });
});
