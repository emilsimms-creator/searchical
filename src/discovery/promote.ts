import type { Lead } from './harvest';
import { isAllowed, parseRobots, robotsUrlFor, type RobotsVerdict } from './robots';
import { sourceById } from './sources';
import { DiscoveryError, type DiscoverySource } from './types';

/**
 * Promote a lead from snippet depth to profile depth, by actually reading the
 * page.
 *
 * This is the first place the system reaches out and takes content, so three
 * things become real at once: the site's terms, its robots.txt, and the load we
 * put on it. All three are enforced here rather than trusted to the caller.
 *
 * WHAT IS KEPT
 *
 * Nothing. This module writes to no table. It returns the text so the screening
 * layer can read it in memory, along with the retention the source's terms
 * allow, and the caller is expected to discard the body once a verdict exists.
 * Everything currently in the catalogue comes back `ephemeral`, because no
 * source has cleared terms, so today promotion sharpens a judgment without
 * creating a record. That is the correct default and not a limitation.
 *
 * FAILING CLOSED
 *
 * A robots.txt that cannot be reached is not permission. The usual crawler
 * default is to proceed when the file is missing or the request errors; this
 * refuses instead, because the thing being fetched is a page about a named
 * individual and the cost of being wrong is not symmetrical.
 */

export const USER_AGENT =
  'SearchicalBot/0.1 (+https://github.com/emilsimms-creator/searchical; executive search research)';

/** Politeness floor, applied per host even where robots names no crawl delay. */
const DEFAULT_CRAWL_DELAY_MS = 2_000;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * How much load one run may put on other people's servers.
 *
 * The crawl delay bounds the RATE and bounds nothing else, which is how a
 * mandate with a wide market and a permissive robots file quietly sends several
 * hundred requests to a small conference site over an afternoon. Politeness at
 * two seconds a request is still a lot of requests.
 *
 * Counted per host and in total, and every request counts: robots.txt, the
 * page, and each redirect hop. Undercounting here would defeat the purpose,
 * because a redirect chain is three requests to someone's server however it is
 * described in the code.
 *
 * Exhausting the budget is a stop, not a failure. The leads not reached keep
 * their snippet verdict and say why they were not read.
 */
export interface FetchBudget {
  readonly perHost: number;
  readonly total: number;
}

export const DEFAULT_FETCH_BUDGET: FetchBudget = { perHost: 25, total: 250 };

export interface PageFetcher {
  readonly id: string;
  fetchText(url: string, init: { userAgent: string; timeoutMs: number }): Promise<{
    status: number;
    contentType: string;
    body: string;
    /** Set on a 3xx. Absolute or relative; the promoter resolves it. */
    location?: string | null;
  }>;
}

type RobotsFile = ReturnType<typeof parseRobots> | 'unreachable';

class BudgetExhausted extends Error {
  readonly scope: 'host' | 'total';
  readonly host: string;
  constructor(scope: 'host' | 'total', host: string, limit: number) {
    super(scope === 'host'
      ? `Fetch budget for ${host} is spent (${limit} requests). Raise it deliberately, or accept ` +
        'that the rest of this surface goes unread rather than leaning on a stranger\'s server.'
      : `Total fetch budget for this run is spent (${limit} requests).`);
    this.scope = scope;
    this.host = host;
  }
}

export type PromotionRefusal =
  | { reason: 'source_forbids_automated_fetch'; detail: string }
  | { reason: 'robots_disallows'; detail: string }
  | { reason: 'robots_unreachable'; detail: string }
  | { reason: 'not_html'; detail: string }
  | { reason: 'http_error'; detail: string }
  | { reason: 'fetch_failed'; detail: string }
  | { reason: 'too_many_redirects'; detail: string }
  | { reason: 'budget_exhausted'; detail: string };

export interface Promotion {
  readonly lead: Lead;
  readonly promoted: boolean;
  /** Page text, present only when promoted. The caller must not persist it. */
  readonly text: string | null;
  /** A place the page states about itself. Never inferred from anything else. */
  readonly statedLocation: string | null;
  readonly retention: 'ephemeral' | 'may_persist';
  readonly refusal: PromotionRefusal | null;
  /** The robots decision, kept so a refusal can be shown rather than asserted. */
  readonly robots: RobotsVerdict | null;
  /**
   * Every URL actually requested, in order, starting with the lead's own.
   *
   * More than one entry means the page redirected. The last entry is what was
   * really read, and it is what a citation should name: citing the URL you
   * asked for when a different one answered is a small lie that becomes a
   * problem the first time somebody checks.
   */
  readonly chain: readonly string[];
}

/**
 * Fetches pages politely, once per lead, for the life of one run.
 *
 * Holds the robots cache, the per host timing and the fetch budget, so those
 * are properties of a run rather than of a call. Construct one per mandate.
 */
export class Promoter {
  readonly #fetcher: PageFetcher;
  readonly #robotsFiles = new Map<string, RobotsFile>();
  readonly #lastFetchAt = new Map<string, number>();
  readonly #requestsByHost = new Map<string, number>();
  readonly #budget: FetchBudget;
  readonly #sleep: (ms: number) => Promise<void>;
  #totalRequests = 0;

  constructor(
    fetcher: PageFetcher,
    opts: { sleep?: (ms: number) => Promise<void>; budget?: Partial<FetchBudget> } = {},
  ) {
    this.#fetcher = fetcher;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#budget = { ...DEFAULT_FETCH_BUDGET, ...opts.budget };
  }

  /** What this run has spent so far, so a caller can report it honestly. */
  spend(): { total: number; byHost: ReadonlyMap<string, number>; budget: FetchBudget } {
    return { total: this.#totalRequests, byHost: new Map(this.#requestsByHost), budget: this.#budget };
  }

  async promote(lead: Lead): Promise<Promotion> {
    const source = sourceById(lead.sourceId);
    if (!source) throw new DiscoveryError(`no such source: ${lead.sourceId}`);

    const retention = retentionFor(source);
    const chain: string[] = [];
    const stop = (refusal: PromotionRefusal, robots: RobotsVerdict | null = null): Promotion => ({
      lead, promoted: false, text: null, statedLocation: null, retention, refusal, robots,
      chain: [...chain],
    });

    if (source.automatedFetch === 'never') {
      return stop({
        reason: 'source_forbids_automated_fetch',
        detail: `${source.name} is never fetched automatically. ${source.etiquette}`,
      });
    }

    let url = lead.url;

    for (let hop = 0; ; hop += 1) {
      if (hop > MAX_REDIRECTS) {
        return stop({
          reason: 'too_many_redirects',
          detail: `More than ${MAX_REDIRECTS} redirects from ${lead.url}. A chain that long is ` +
            'either a loop or a page that does not want to be read.',
        });
      }
      chain.push(url);

      let host: string;
      try {
        host = new URL(url).host;
      } catch {
        return stop({ reason: 'fetch_failed', detail: `not a URL: ${url}` });
      }

      // Robots is re-checked on EVERY hop, against the host that will actually
      // answer. A redirect can cross hosts, and the first host's rules say
      // nothing whatever about the second one's. Fetching under them was a real
      // defect: a site that disallows this crawler could be reached anyway by
      // any page elsewhere that happened to redirect to it.
      let robotsFile: RobotsFile;
      try {
        robotsFile = await this.#robotsFor(host, url);
      } catch (error) {
        if (error instanceof BudgetExhausted) {
          return stop({ reason: 'budget_exhausted', detail: error.message });
        }
        throw error;
      }

      if (robotsFile === 'unreachable') {
        return stop({
          reason: 'robots_unreachable',
          detail:
            `Could not read robots.txt for ${host}. An unreadable robots file is not permission: ` +
            'this is a page about a named individual and the cost of being wrong is not symmetrical.',
        });
      }

      const verdict = isAllowed(robotsFile, USER_AGENT, url);
      if (!verdict.allowed) {
        return stop({
          reason: 'robots_disallows',
          detail: hop === 0
            ? `${host} says ${verdict.rule}`
            : `redirected to ${host}, which says ${verdict.rule}`,
        }, verdict);
      }

      await this.#waitForHost(host, verdict.crawlDelayMs);

      let res: Awaited<ReturnType<PageFetcher['fetchText']>>;
      try {
        res = await this.#request(host, url);
      } catch (error) {
        if (error instanceof BudgetExhausted) {
          return stop({ reason: 'budget_exhausted', detail: error.message }, verdict);
        }
        return stop({
          reason: 'fetch_failed',
          detail: error instanceof Error ? error.message : String(error),
        }, verdict);
      }

      if (res.status >= 300 && res.status < 400) {
        if (!res.location) {
          return stop({ reason: 'http_error', detail: `${res.status} from ${host} with no location` }, verdict);
        }
        try {
          url = new URL(res.location, url).toString();
        } catch {
          return stop({ reason: 'fetch_failed', detail: `bad redirect target: ${res.location}` }, verdict);
        }
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        return stop({ reason: 'http_error', detail: `${res.status} from ${host}` }, verdict);
      }
      if (!/^text\/(html|plain)/i.test(res.contentType)) {
        return stop({ reason: 'not_html', detail: `content type ${res.contentType || 'unknown'}` }, verdict);
      }

      const body = res.body.length > MAX_BYTES ? res.body.slice(0, MAX_BYTES) : res.body;
      const text = htmlToText(body);
      return {
        lead, promoted: true, text, statedLocation: statedLocationIn(body, text),
        retention, refusal: null, robots: verdict, chain: [...chain],
      };
    }
  }

  /**
   * Every request to someone else's server goes through here, so the budget
   * counts exactly what was sent rather than what the code meant to send.
   */
  async #request(host: string, url: string) {
    const spentHere = this.#requestsByHost.get(host) ?? 0;
    if (spentHere >= this.#budget.perHost) throw new BudgetExhausted('host', host, this.#budget.perHost);
    if (this.#totalRequests >= this.#budget.total) throw new BudgetExhausted('total', host, this.#budget.total);

    this.#requestsByHost.set(host, spentHere + 1);
    this.#totalRequests += 1;
    return this.#fetcher.fetchText(url, { userAgent: USER_AGENT, timeoutMs: TIMEOUT_MS });
  }

  async #robotsFor(host: string, url: string): Promise<RobotsFile> {
    const cached = this.#robotsFiles.get(host);
    if (cached !== undefined) return cached;
    try {
      const res = await this.#request(host, robotsUrlFor(url));
      // A 404 means no rules were published, which IS an answer: the standard
      // treats an absent file as unrestricted. An error status is not an answer.
      const parsed = res.status === 404
        ? parseRobots('')
        : res.status >= 200 && res.status < 300
          ? parseRobots(res.body)
          : 'unreachable' as const;
      this.#robotsFiles.set(host, parsed);
      return parsed;
    } catch (error) {
      if (error instanceof BudgetExhausted) throw error;
      this.#robotsFiles.set(host, 'unreachable');
      return 'unreachable' as const;
    }
  }

  async #waitForHost(host: string, crawlDelayMs: number | null): Promise<void> {
    const delay = Math.max(crawlDelayMs ?? 0, DEFAULT_CRAWL_DELAY_MS);
    const last = this.#lastFetchAt.get(host);
    const now = Date.now();
    if (last !== undefined && now - last < delay) await this.#sleep(delay - (now - last));
    this.#lastFetchAt.set(host, Date.now());
  }
}

const retentionFor = (source: DiscoverySource): Promotion['retention'] =>
  source.persistence === 'persist' && source.terms.verified ? 'may_persist' : 'ephemeral';

/**
 * HTML to readable text.
 *
 * Deliberately small and dependency free. Scripts, styles and navigation
 * furniture are removed because they are the commonest source of a false skill
 * match: a page whose footer lists every product a company sells will otherwise
 * appear to prove the person knows all of them.
 */
export function htmlToText(html: string): string {
  const withoutFurniture = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  return decodeEntities(
    withoutFurniture
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
    rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…',
  };
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

/**
 * A location the page states about itself.
 *
 * Only from a machine readable declaration the page author put there on
 * purpose: schema.org address markup, or an explicit "Location:" label. Never
 * guessed from prose, a top level domain, a language or a name. Guessing a
 * place is how a screen starts inferring things it has no business inferring,
 * and the screening layer treats a stated location as weak evidence even when
 * it is real.
 */
export function statedLocationIn(html: string, text: string): string | null {
  const microdata = html.match(/itemprop=["'](?:addressLocality|location)["'][^>]*>([^<]{2,60})</i);
  if (microdata?.[1]) return clean(microdata[1]);

  const jsonLd = html.match(/"addressLocality"\s*:\s*"([^"]{2,60})"/i);
  if (jsonLd?.[1]) return clean(jsonLd[1]);

  const labelled = text.match(/^\s*(?:location|based in|based)\s*[:—-]\s*(.{2,60})$/im);
  if (labelled?.[1]) return clean(labelled[1]);

  return null;
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The real fetcher.
 *
 * Like the Brave adapter, this has never made a live call: the environment it
 * was written in blocks outbound fetches to arbitrary hosts. The size cap, the
 * timeout and the redirect handling are written from the platform's documented
 * behaviour and covered by tests against a recorded fetch, but whoever runs it
 * against the open web first should expect to fix something.
 */
export function httpPageFetcher(fetchImpl: typeof fetch = fetch): PageFetcher {
  return {
    id: 'http',
    async fetchText(url, init) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), init.timeoutMs);
      try {
        const res = await fetchImpl(url, {
          headers: {
            'User-Agent': init.userAgent,
            Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          },
          // Manual, NOT follow. The platform would happily follow a redirect to
          // another host, and that host's robots.txt would never be consulted.
          // The promoter re-checks robots on every hop instead, so the redirect
          // has to come back here rather than being resolved underneath us.
          redirect: 'manual',
          signal: controller.signal,
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (res.status >= 300 && res.status < 400) {
          return { status: res.status, contentType, body: '', location: res.headers.get('location') };
        }
        // Read at most MAX_BYTES rather than trusting a content-length header,
        // which a server is free to lie about or omit.
        const body = await readCapped(res, MAX_BYTES);
        return { status: res.status, contentType, body, location: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
    if (out.length >= max) {
      await reader.cancel();
      return out.slice(0, max);
    }
  }
  return out + decoder.decode();
}
