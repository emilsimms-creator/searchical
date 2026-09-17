import { describe, expect, it } from 'vitest';
import { promoteAndRescreen, screenLeads } from '@/screening';
import type { Lead, Promotion } from '@/discovery';
import type { MandateConstraint, MandateTerm } from '@/mandate/types';

const lead = (title: string, snippet: string, url: string): Lead => ({
  sourceId: 'conference_programmes', url, title, snippet, rank: 1,
  disposition: 'human_reads_it', termsUnverified: true,
});

const TERMS: readonly MandateTerm[] = [
  { kind: 'title_variant', term: 'VP Engineering', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
  { kind: 'must_have_skill', term: 'Kubernetes', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
  { kind: 'must_have_skill', term: 'Terraform', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 2 },
  { kind: 'exclusion', term: 'Junior', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
];

const ONSITE: MandateConstraint = {
  kind: 'location_or_onsite', severity: 'disqualifying',
  statement: 'On site in Toronto twelve days a month.', inferred: false,
};

/** A promoter over scripted outcomes, so nothing here touches a network. */
function promoter(pages: Record<string, { text?: string; statedLocation?: string; refused?: string }>) {
  const asked: string[] = [];
  return {
    asked,
    async promote(l: Lead): Promise<Promotion> {
      asked.push(l.url);
      const page = pages[l.url];
      if (!page || page.refused) {
        return {
          lead: l, promoted: false, text: null, statedLocation: null, retention: 'ephemeral',
          robots: null, chain: [l.url],
          refusal: { reason: 'robots_disallows', detail: page?.refused ?? 'no page' },
        };
      }
      return {
        lead: l, promoted: true, text: page.text ?? '', statedLocation: page.statedLocation ?? null,
        retention: 'ephemeral', refusal: null, chain: [l.url],
        robots: { allowed: true, rule: 'no rule matches this path', crawlDelayMs: null },
      };
    },
  };
}

describe('promoting only what earned it', () => {
  /**
   * Promotion costs a request to somebody else's server. Nothing a page could
   * say would change a rejection, so fetching it would be load on a stranger's
   * site in exchange for nothing.
   */
  it('never fetches a lead the snippet screen already rejected', async () => {
    const leads = [
      lead('Rav', 'Junior engineer, Kubernetes', 'https://x.org/rav'),
      lead('Ada', 'VP Engineering, Kubernetes', 'https://x.org/ada'),
    ];
    const p = promoter({ 'https://x.org/ada': { text: 'Ada Okafor. VP Engineering. Kubernetes and Terraform.' } });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, []);

    expect(p.asked).toEqual(['https://x.org/ada']);
    expect(out.find((o) => o.lead.title === 'Rav')!.verdict).toBe('reject');
    expect(out.find((o) => o.lead.title === 'Rav')!.promotion).toBeNull();
  });

  it('fetches a hold, because that is exactly what thin evidence needs', async () => {
    const leads = [lead('Ada', 'spoke at the conference', 'https://x.org/ada')];
    const p = promoter({ 'https://x.org/ada': { text: 'Ada Okafor, VP Engineering. Kubernetes at scale.' } });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, []);

    expect(p.asked).toEqual(['https://x.org/ada']);
    // Held on the snippet, advanced once the page was read. That is the whole
    // reason promotion exists.
    expect(out[0]!.verdict).toBe('advance');
    expect(out[0]!.depth).toBe('profile');
  });

  it('re-screens at profile depth, so the deeper evidence is what counts', async () => {
    const leads = [lead('Ada', 'VP Engineering', 'https://x.org/ada')];
    const p = promoter({
      'https://x.org/ada': { text: 'Ada Okafor. VP Engineering. Kubernetes, Terraform, Junior mentoring programme.' },
    });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, []);
    // The page contains an excluded word the snippet never showed, and the
    // deeper read is what the verdict now rests on.
    expect(out[0]!.verdict).toBe('reject');
    expect(out[0]!.depth).toBe('profile');
  });

  it('keeps the snippet verdict when the page could not be read, and says why', async () => {
    const leads = [lead('Ada', 'VP Engineering, Kubernetes', 'https://x.org/ada')];
    const p = promoter({ 'https://x.org/ada': { refused: 'x.org says Disallow: /' } });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, []);

    expect(out[0]!.verdict).toBe('advance');
    expect(out[0]!.depth).toBe('snippet');
    expect(out[0]!.promotion!.refusal!.detail).toMatch(/Disallow/);
  });

  /** A stated location is real information and still only weak evidence. */
  it('uses a stated location as a conversation, never as a rejection', async () => {
    const leads = [lead('Ada', 'VP Engineering', 'https://x.org/ada')];
    const p = promoter({
      'https://x.org/ada': {
        text: 'Ada Okafor. VP Engineering. Kubernetes.', statedLocation: 'Vancouver, British Columbia',
      },
    });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, [ONSITE]);

    expect(out[0]!.verdict).not.toBe('reject');
    const finding = out[0]!.matches.find((m) => m.matched === 'Vancouver, British Columbia')!;
    expect(finding.statement).toMatch(/still a conversation/);
  });

  it('still refuses to screen a protected ground at profile depth', async () => {
    const leads = [lead('Ada', 'VP Engineering', 'https://x.org/ada')];
    const p = promoter({
      'https://x.org/ada': { text: 'Ada Okafor. VP Engineering. Kubernetes.', statedLocation: 'Toronto' },
    });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, [{
      kind: 'citizenship_or_status', severity: 'disqualifying',
      statement: 'Canadian citizens and permanent residents.', inferred: false,
    }]);
    expect(out[0]!.prohibitedChecksSkipped).toEqual(['citizenship_or_status']);
  });

  it('re-orders once the deeper evidence is in', async () => {
    const leads = [
      lead('Thin', 'attended', 'https://x.org/thin'),
      lead('Deep', 'attended', 'https://x.org/deep'),
    ];
    const p = promoter({
      'https://x.org/thin': { text: 'Attended the conference.' },
      'https://x.org/deep': { text: 'VP Engineering. Kubernetes and Terraform at scale.' },
    });
    const out = await promoteAndRescreen(screenLeads(leads, TERMS, []), p, TERMS, []);
    expect(out[0]!.lead.title).toBe('Deep');
    expect(out[0]!.verdict).toBe('advance');
    expect(out[1]!.verdict).toBe('hold');
  });

  it('does nothing surprising with an empty list', async () => {
    const p = promoter({});
    expect(await promoteAndRescreen([], p, TERMS, [])).toEqual([]);
    expect(p.asked).toEqual([]);
  });
});
