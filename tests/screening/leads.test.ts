import { describe, expect, it } from 'vitest';
import { evidenceFromLead, screenLeads, screeningSummary } from '@/screening';
import type { Lead } from '@/discovery';
import type { MandateConstraint, MandateTerm } from '@/mandate/types';

const lead = (title: string, snippet: string, url = `https://example.org/${title}`): Lead => ({
  sourceId: 'conference_programmes', url, title, snippet, rank: 1,
  disposition: 'human_reads_it', termsUnverified: true,
});

const TERMS: readonly MandateTerm[] = [
  { kind: 'title_variant', term: 'VP Engineering', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
  { kind: 'must_have_skill', term: 'Kubernetes', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
  { kind: 'exclusion', term: 'Junior', origin: 'extracted', status: 'confirmed', observedCount: null, rank: 1 },
];

const CLEARANCE: MandateConstraint = {
  kind: 'security_clearance', severity: 'disqualifying',
  statement: 'Must be eligible for Secret clearance.', inferred: false,
};

describe('screening a harvest', () => {
  /** A search snippet is a snippet, and the depth must not be flattered. */
  it('screens a lead at snippet depth, never higher', () => {
    expect(evidenceFromLead(lead('Ada', 'talk on Kubernetes')).depth).toBe('snippet');
    // Promoting to profile depth means fetching the page, which is a separate
    // step with its own terms position and does not happen here.
    expect(evidenceFromLead(lead('Ada', 'x')).statedLocation).toBeNull();
  });

  it('orders a harvest so the recruiter works top down', () => {
    const screened = screenLeads(
      [
        lead('Someone', 'attended the conference'),
        lead('Junior person', 'Junior engineer, Kubernetes'),
        lead('Ada Okafor', 'VP Engineering, talk on Kubernetes failover'),
      ],
      TERMS, [CLEARANCE],
    );
    expect(screened.map((s) => s.verdict)).toEqual(['advance', 'hold', 'reject']);
    expect(screened[0]!.lead.title).toBe('Ada Okafor');
  });

  it('keeps each verdict attached to the lead that earned it', () => {
    const screened = screenLeads(
      [lead('Ada', 'VP Engineering Kubernetes'), lead('Rav', 'Junior')],
      TERMS, [],
    );
    const ada = screened.find((s) => s.lead.title === 'Ada')!;
    const rav = screened.find((s) => s.lead.title === 'Rav')!;
    expect(ada.verdict).toBe('advance');
    expect(rav.verdict).toBe('reject');
  });

  it('reports what cannot be settled from search results at all', () => {
    const screened = screenLeads([lead('Ada', 'VP Engineering Kubernetes')], TERMS, [CLEARANCE]);
    const summary = screeningSummary(screened);
    expect(summary).toMatch(/1 to look at, 0 too thin to say, 0 excluded/);
    expect(summary).toMatch(/belong in the first conversation: security_clearance/);
  });

  it('does not overstate a thin harvest', () => {
    const screened = screenLeads(
      [lead('A', 'attended'), lead('B', 'also attended')],
      TERMS, [],
    );
    expect(screeningSummary(screened)).toMatch(/0 to look at, 2 too thin to say/);
  });

  /**
   * Found by running the screen against a sample harvest: a "Junior Platform
   * Engineer" advanced, which looked like a bug and was not. The mandate had no
   * confirmed exclusions, so the screen had no power to reject anyone.
   */
  it('says plainly when a mandate has given the screen no power to reject', () => {
    const noExclusions = TERMS.filter((t) => t.kind !== 'exclusion');
    const screened = screenLeads([lead('Rav', 'Junior engineer, Kubernetes')], noExclusions, []);
    expect(screened[0]!.verdict).toBe('advance');
    expect(screeningSummary(screened, noExclusions))
      .toMatch(/cannot reject anyone: every verdict here is advance or hold by construction/);
  });

  it('stays quiet about that once the exclusions are confirmed', () => {
    const screened = screenLeads([lead('Rav', 'Junior engineer, Kubernetes')], TERMS, []);
    expect(screened[0]!.verdict).toBe('reject');
    expect(screeningSummary(screened, TERMS)).not.toMatch(/cannot reject anyone/);
  });

  it('handles an empty harvest without inventing a verdict', () => {
    expect(screenLeads([], TERMS, [CLEARANCE])).toEqual([]);
    expect(screeningSummary([])).toMatch(/0 lead\(s\) screened/);
  });
});
