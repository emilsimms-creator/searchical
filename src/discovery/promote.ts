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

export interface PageFetcher {
  readonly id: string;
  fetchText(url: string, init: { userAgent: string; timeoutMs: number }): Promise<{
    status: number;
    contentType: string;
    body: string;
  }>;
}

export type PromotionRefusal =
  | { reason: 'source_forbids_automated_fetch'; detail: string }
  | { reason: 'robots_disallows'; detail: string }
  | { reason: 'robots_unreachable'; detail: string }
  | { reason: 'not_html'; detail: string }
  | { reason: 'http_error'; detail: string }
  | { reason: 'fetch_failed'; detail: string };

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
}

/** Caches robots.txt per host for the life of one promoter. */
export class Promoter {
  readonly #fetcher: PageFetcher;
  readonly #robotsFiles = new Map<string, ReturnType<typeof parseRobots> | 'unreachable'>();
  readonly #lastFetchAt = new Map<string, number>();
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(fetcher: PageFetcher, opts: { sleep?: (ms: number) => Promise<void> } = {}) {
    this.#fetcher = fetcher;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async promote(lead: Lead): Promise<Promotion> {
    const source = sourceById(lead.sourceId);
    if (!source) throw new DiscoveryError(`no such source: ${lead.sourceId}`);

    const base = { lead, promoted: false, text: null, statedLocation: null, robots: null } as const;
    const retention = retentionFor(source);

    if (source.automatedFetch === 'never') {
      return {
        ...base, retention,
        refusal: {
          reason: 'source_forbids_automated_fetch',
          detail: `${source.name} is never fetched automatically. ${source.etiquette}`,
        },
      };
    }

    let host: string;
    try {
      host = new URL(lead.url).host;
    } catch {
      return { ...base, retention, refusal: { reason: 'fetch_failed', detail: `not a URL: ${lead.url}` } };
    }

    const robotsFile = await this.#robotsFor(host, lead.url);
    if (robotsFile === 'unreachable') {
      return {
        ...base, retention,
        refusal: {
          reason: 'robots_unreachable',
          detail:
            `Could not read robots.txt for ${host}. An unreadable robots file is not permission: ` +
            'this is a page about a named individual and the cost of being wrong is not symmetrical.',
        },
      };
    }

    const verdict = isAllowed(robotsFile, USER_AGENT, lead.url);
    if (!verdict.allowed) {
      return {
        ...base, retention, robots: verdict,
        refusal: { reason: 'robots_disallows', detail: `${host} says ${verdict.rule}` },
      };
    }

    await this.#waitForHost(host, verdict.crawlDelayMs);

    let res: Awaited<ReturnType<PageFetcher['fetchText']>>;
    try {
      res = await this.#fetcher.fetchText(lead.url, { userAgent: USER_AGENT, timeoutMs: TIMEOUT_MS });
    } catch (error) {
      return {
        ...base, retention, robots: verdict,
        refusal: { reason: 'fetch_failed', detail: error instanceof Error ? error.message : String(error) },
      };
    }

    if (res.status < 200 || res.status >= 300) {
      return {
        ...base, retention, robots: verdict,
        refusal: { reason: 'http_error', detail: `${res.status} from ${host}` },
      };
    }
    if (!/^text\/(html|plain)/i.test(res.contentType)) {
      return {
        ...base, retention, robots: verdict,
        refusal: { reason: 'not_html', detail: `content type ${res.contentType || 'unknown'}` },
      };
    }

    const body = res.body.length > MAX_BYTES ? res.body.slice(0, MAX_BYTES) : res.body;
    const text = htmlToText(body);
    return {
      lead, promoted: true, text, statedLocation: statedLocationIn(body, text),
      retention, refusal: null, robots: verdict,
    };
  }

  async #robotsFor(host: string, url: string) {
    const cached = this.#robotsFiles.get(host);
    if (cached !== undefined) return cached;
    try {
      const res = await this.#fetcher.fetchText(robotsUrlFor(url), {
        userAgent: USER_AGENT, timeoutMs: TIMEOUT_MS,
      });
      // A 404 means no rules were published, which IS an answer: the standard
      // treats an absent file as unrestricted. An error status is not an answer.
      const parsed = res.status === 404
        ? parseRobots('')
        : res.status >= 200 && res.status < 300
          ? parseRobots(res.body)
          : 'unreachable' as const;
      this.#robotsFiles.set(host, parsed);
      return parsed;
    } catch {
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
          redirect: 'follow',
          signal: controller.signal,
        });
        const contentType = res.headers.get('content-type') ?? '';
        // Read at most MAX_BYTES rather than trusting a content-length header,
        // which a server is free to lie about or omit.
        const body = await readCapped(res, MAX_BYTES);
        return { status: res.status, contentType, body };
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
