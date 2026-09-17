import type { Lead } from '@/discovery/harvest';
import type { Promotion } from '@/discovery/promote';
import type { MandateConstraint, MandateTerm } from '@/mandate/types';
import { screen, screenAll } from './screen';
import type { ScreenResult, ScreeningEvidence } from './types';

/**
 * The seam between finding a page and judging a person.
 *
 * A lead is a title and forty words a search engine chose, so everything from
 * here is screened at `snippet` depth and the checkability table treats it
 * accordingly. Promoting a lead to `profile` depth requires actually fetching
 * and reading the page, which is a separate step with its own terms position
 * and does not happen here.
 */
export function evidenceFromLead(lead: Lead): ScreeningEvidence {
  return {
    text: `${lead.title}. ${lead.snippet}`,
    sourceId: lead.sourceId,
    depth: 'snippet',
    statedLocation: null,
  };
}

export interface ScreenedLead extends ScreenResult {
  readonly lead: Lead;
}

/**
 * Screen a harvest and order it for a recruiter to work top down.
 *
 * The verdict is about the evidence, not about the person: a `hold` on a
 * two-line snippet says the snippet was thin. That distinction survives into
 * the output deliberately, because a recruiter who reads `hold` as `no` will
 * discard the half of the market whose public writing is sparse, which skews
 * hard toward people who market themselves rather than people who are good.
 */
export function screenLeads(
  leads: readonly Lead[],
  terms: readonly MandateTerm[],
  constraints: readonly MandateConstraint[],
): readonly ScreenedLead[] {
  const results = screenAll(
    leads.map((lead) => ({ evidence: evidenceFromLead(lead), terms, constraints })),
  );
  return results.map((r) => ({ ...r, lead: leads[r.index]! }));
}

/**
 * What the recruiter is told about a screened harvest, without overstating it.
 *
 * `terms` is optional and worth passing. Found by running the screen against a
 * sample harvest: a "Junior Platform Engineer" advanced, which looked like a
 * bug and was not. The mandate under test had no confirmed exclusions, so the
 * screen had no power to reject anybody at all. That is a real and quiet
 * failure mode, because a screen that can only advance or hold looks like it is
 * working right up until a recruiter notices it has never said no.
 */
export function screeningSummary(
  screened: readonly ScreenedLead[],
  terms?: readonly MandateTerm[],
): string {
  const count = (v: ScreenResult['verdict']) => screened.filter((s) => s.verdict === v).length;
  const blockers = new Set(
    screened.flatMap((s) => s.openQuestions.filter((q) => q.severity === 'disqualifying').map((q) => q.kind)),
  );
  const noExclusions = terms !== undefined
    && !terms.some((t) => t.kind === 'exclusion' && t.status === 'confirmed');

  const parts = [
    `${screened.length} lead(s) screened: ${count('advance')} to look at, ${count('hold')} too thin ` +
      `to say, ${count('reject')} excluded.`,
    noExclusions
      ? 'This mandate has no confirmed exclusions, so the screen cannot reject anyone: every verdict ' +
        'here is advance or hold by construction. Confirm the exclusion terms to give it teeth.'
      : null,
    blockers.size > 0
      ? `${blockers.size} non-negotiable(s) cannot be settled from search results at all and belong ` +
        `in the first conversation: ${[...blockers].join(', ')}.`
      : null,
  ].filter((p): p is string => p !== null);
  return parts.join(' ');
}

/**
 * Screen cheaply, then read the pages that earned it.
 *
 * Promotion costs a request to somebody else's server, so it is spent only on
 * leads the snippet screen did not already settle. A lead the mandate's own
 * exclusions rejected is not fetched at all: there is nothing a page could say
 * that would change the verdict, and fetching it anyway would be load on a
 * stranger's site in exchange for nothing.
 *
 * A promotion that is refused is not a failure. The lead keeps its snippet
 * verdict and carries the reason, so a recruiter can see that the page was not
 * read and why, rather than assuming it was.
 */
export async function promoteAndRescreen(
  screened: readonly ScreenedLead[],
  promoter: { promote(lead: Lead): Promise<Promotion> },
  terms: readonly MandateTerm[],
  constraints: readonly MandateConstraint[],
): Promise<readonly (ScreenedLead & { promotion: Promotion | null })[]> {
  const out: (ScreenedLead & { promotion: Promotion | null })[] = [];

  for (const item of screened) {
    if (item.verdict === 'reject') {
      out.push({ ...item, promotion: null });
      continue;
    }
    const promotion = await promoter.promote(item.lead);
    if (!promotion.promoted || promotion.text === null) {
      out.push({ ...item, promotion });
      continue;
    }
    const deeper = screen({
      evidence: {
        text: promotion.text,
        statedLocation: promotion.statedLocation,
        sourceId: item.lead.sourceId,
        depth: 'profile',
      },
      terms,
      constraints,
    });
    out.push({ ...deeper, lead: item.lead, promotion });
  }

  const rank: Record<ScreenResult['verdict'], number> = { advance: 0, hold: 1, reject: 2 };
  return out.sort((a, b) =>
    rank[a.verdict] - rank[b.verdict] ||
    b.matches.length - a.matches.length ||
    a.openQuestions.length - b.openQuestions.length);
}
