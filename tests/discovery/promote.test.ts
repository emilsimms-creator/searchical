import { describe, expect, it } from 'vitest';
import {
  Promoter, USER_AGENT, htmlToText, statedLocationIn, sourceById, type Lead, type PageFetcher,
} from '@/discovery';

const lead = (sourceId: string, url = 'https://conf.example.org/speakers/ada'): Lead => ({
  sourceId, url, title: 'Ada Okafor', snippet: 'talk on Kubernetes', rank: 1,
  disposition: 'human_reads_it', termsUnverified: true,
});

/** A fetcher over recorded pages, so nothing here touches a network. */
function recorded(pages: Record<string, { status?: number; contentType?: string; body: string }>): PageFetcher & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    id: 'recorded',
    calls,
    async fetchText(url) {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error(`no recorded page for ${url}`);
      return { status: page.status ?? 200, contentType: page.contentType ?? 'text/html', body: page.body };
    },
  };
}

const noSleep = { sleep: async () => {} };
const PROFILE = '<html><body><h1>Ada Okafor</h1><p>VP Engineering. Kubernetes at scale.</p></body></html>';

describe('promoting a lead to profile depth', () => {
  /**
   * LinkedIn's User Agreement prohibits automated access, so the page is never
   * fetched at any depth. Not a robots decision: the system does not even ask.
   */
  it('never fetches a surface whose terms forbid automated access', async () => {
    const fetcher = recorded({});
    const p = await new Promoter(fetcher, noSleep).promote(lead('linkedin_public_xray', 'https://www.linkedin.com/in/ada'));
    expect(p.promoted).toBe(false);
    expect(p.refusal?.reason).toBe('source_forbids_automated_fetch');
    expect(fetcher.calls).toEqual([]);
    expect(sourceById('linkedin_public_xray')!.automatedFetch).toBe('never');
  });

  it('reads robots.txt before the page, and honours a refusal', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /speakers' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.promoted).toBe(false);
    expect(p.refusal?.reason).toBe('robots_disallows');
    expect(p.robots?.rule).toBe('Disallow: /speakers');
    // robots.txt was read; the page itself never was.
    expect(fetcher.calls).toEqual(['https://conf.example.org/robots.txt']);
  });

  /** The usual crawler default is to proceed. This one refuses. */
  it('treats an unreachable robots.txt as refusal, not permission', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { status: 500, body: '' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.promoted).toBe(false);
    expect(p.refusal?.reason).toBe('robots_unreachable');
    expect(p.refusal?.detail).toMatch(/not symmetrical/);
    expect(fetcher.calls).not.toContain('https://conf.example.org/speakers/ada');
  });

  /** An absent file is an answer under the standard; an error is not. */
  it('treats a 404 robots.txt as unrestricted', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { status: 404, body: 'Not found' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.promoted).toBe(true);
    expect(p.text).toMatch(/VP Engineering/);
  });

  it('fetches and reads the page when everything permits it', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: 'User-agent: *\nDisallow: /admin' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.promoted).toBe(true);
    expect(p.text).toContain('Kubernetes at scale');
    expect(p.refusal).toBeNull();
  });

  it('identifies itself rather than pretending to be a browser', async () => {
    let seen: string | null = null;
    const fetcher: PageFetcher = {
      id: 'x',
      async fetchText(url, init) {
        seen = init.userAgent;
        return { status: 200, contentType: 'text/html', body: url.endsWith('robots.txt') ? '' : PROFILE };
      },
    };
    await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(seen).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/SearchicalBot/);
    expect(USER_AGENT).toMatch(/\+https:/);
  });

  it('refuses anything that is not a readable document', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: '' },
      'https://conf.example.org/speakers/ada': { contentType: 'application/pdf', body: '%PDF' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.refusal?.reason).toBe('not_html');
  });

  it('reports an HTTP failure rather than treating it as an empty page', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: '' },
      'https://conf.example.org/speakers/ada': { status: 403, body: '' },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.refusal?.reason).toBe('http_error');
    expect(p.refusal?.detail).toMatch(/403/);
  });

  it('reads robots.txt once per host, not once per page', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: '' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
      'https://conf.example.org/speakers/rav': { body: PROFILE },
    });
    const promoter = new Promoter(fetcher, noSleep);
    await promoter.promote(lead('conference_programmes'));
    await promoter.promote(lead('conference_programmes', 'https://conf.example.org/speakers/rav'));
    expect(fetcher.calls.filter((c) => c.endsWith('robots.txt'))).toHaveLength(1);
  });

  it('waits between requests to one host, honouring a stated crawl delay', async () => {
    const waits: number[] = [];
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: 'User-agent: *\nCrawl-delay: 10' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
      'https://conf.example.org/speakers/rav': { body: PROFILE },
    });
    const promoter = new Promoter(fetcher, { sleep: async (ms) => { waits.push(ms); } });
    await promoter.promote(lead('conference_programmes'));
    await promoter.promote(lead('conference_programmes', 'https://conf.example.org/speakers/rav'));
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(9_000);
  });

  /**
   * Nothing has cleared terms, so promotion currently sharpens a judgment
   * without creating a record. That is the correct default, not a gap.
   */
  it('returns ephemeral retention while no source has cleared its terms', async () => {
    const fetcher = recorded({
      'https://conf.example.org/robots.txt': { body: '' },
      'https://conf.example.org/speakers/ada': { body: PROFILE },
    });
    const p = await new Promoter(fetcher, noSleep).promote(lead('conference_programmes'));
    expect(p.retention).toBe('ephemeral');
  });
});

describe('reading a page', () => {
  it('drops the furniture that produces false skill matches', () => {
    const text = htmlToText(`
      <html><head><style>.a{color:red}</style><script>var x="Terraform"</script></head>
      <body>
        <nav>Products: Kubernetes, Terraform, Ansible</nav>
        <h1>Ada Okafor</h1><p>VP Engineering</p>
        <footer>We also sell Terraform consulting</footer>
      </body></html>`);
    expect(text).toContain('Ada Okafor');
    expect(text).toContain('VP Engineering');
    // A footer listing every product a company sells would otherwise appear to
    // prove the person knows all of them.
    expect(text).not.toContain('Terraform');
    expect(text).not.toContain('color:red');
  });

  it('decodes entities and collapses whitespace', () => {
    expect(htmlToText('<p>Ada&nbsp;&amp;&nbsp;Rav &#8212; K&#x38;s</p>')).toBe('Ada & Rav — K8s');
  });

  it('breaks blocks into lines rather than running them together', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });
});

describe('a stated location', () => {
  it('reads schema.org markup the author put there on purpose', () => {
    expect(statedLocationIn('<span itemprop="addressLocality">Toronto, Ontario</span>', ''))
      .toBe('Toronto, Ontario');
    expect(statedLocationIn('{"addressLocality":"Vancouver"}', '')).toBe('Vancouver');
  });

  it('reads an explicit label', () => {
    expect(statedLocationIn('', 'Speaker bio\nLocation: Ottawa, Ontario\nTalk')).toBe('Ottawa, Ontario');
  });

  /** Guessing a place is how a screen starts inferring what it must not. */
  it('never guesses from prose, a domain or a name', () => {
    expect(statedLocationIn('<p>Ada flew in from Toronto for the week</p>', 'Ada flew in from Toronto')).toBeNull();
    expect(statedLocationIn('<html lang="fr-CA"></html>', 'Bonjour')).toBeNull();
  });
});
