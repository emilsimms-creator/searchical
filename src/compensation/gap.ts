import { formatAmount, formatRange } from './money';
import type { CompensationBand, GapAnalysis, ProspectFigure } from './types';

/**
 * Within this proportion of the top of the band, the expectation is reachable
 * but the search has no room left. It is a practice default, not a finding: it
 * exists so the recruiter hears "at the ceiling" rather than "fine" at the
 * point where one more conversation about scope is still cheap.
 */
const CEILING_TOLERANCE = 0.05;

/** Above this much over the top, the research on offer stage failure says stop. */
const UNBRIDGEABLE = 0.2;

const NO_BAND: GapAnalysis = {
  verdict: 'unknown', overBy: null, suggestedFactor8: null, caveat: null,
  headline:
    'No confirmed band on this mandate, so there is nothing to compare an expectation against. ' +
    'Get the number from the hiring leader before the exploratory calls, not after them.',
};

/**
 * Compare what the person wants against what the client will pay.
 *
 * Only a CONFIRMED band is compared. An extracted or inferred band is the
 * system's reading of a document, and telling a recruiter their candidate is
 * "within range" on the strength of a number no client has stood behind is how
 * a search reaches offer on a figure that was never real.
 */
export function analyseGap(
  band: CompensationBand | null,
  figure: ProspectFigure | null,
): GapAnalysis {
  if (!band || band.confirmedAt === null) {
    if (band && band.confirmedAt === null) {
      return {
        ...NO_BAND,
        headline:
          `Version ${band.version} of this band is recorded but not confirmed by the hiring ` +
          'leader, so it is not a number to measure anyone against yet. Confirm it first.',
      };
    }
    return NO_BAND;
  }
  if (!figure || figure.amountCents === null) {
    return {
      verdict: 'unknown', overBy: null, suggestedFactor8: null, caveat: null,
      headline:
        `The band is ${formatRange(band.baseMinCents, band.baseMaxCents, band.currency)} base. ` +
        'Nothing recorded from the candidate yet, so factor 8 is still a judgment about the ' +
        'conversation rather than a comparison.',
    };
  }

  if (figure.currency !== band.currency || figure.period !== band.period) {
    return {
      verdict: 'incomparable', overBy: null, suggestedFactor8: null,
      headline:
        `The band is in ${band.currency} ${band.period} and the candidate's figure is in ` +
        `${figure.currency} ${figure.period}. These are not comparable without a rate and a date, ` +
        'and a conversion at an unrecorded rate is a number nobody can defend to a client.',
      caveat: 'Supply the rate and the date it was taken, or convert the band with the client.',
    };
  }

  // Where the person gave a range, the top of it is what they will hold out for.
  const wants = figure.amountMaxCents ?? figure.amountCents;
  const top = band.baseMaxCents;
  const floor = band.baseMinCents;
  const money = (c: bigint) => formatAmount(c, band.currency);
  const bandText = formatRange(floor, top, band.currency);

  if (top !== null && wants > top) {
    const overBy = Number(wants - top) / Number(top);
    const unbridgeable = overBy > UNBRIDGEABLE;
    return {
      verdict: 'above_band',
      overBy,
      suggestedFactor8: unbridgeable ? 0 : overBy > 0.1 ? 1 : 3,
      headline:
        `${money(wants)} against a band topping out at ${money(top)}: ` +
        `${Math.round(overBy * 100)} percent over. ` +
        (unbridgeable
          ? 'This is the gap that kills searches at offer. Raise it with the client now, or stop.'
          : 'Close enough to work if the bonus, pension or scope carries the difference. Establish that before the second call, not at offer.'),
      caveat: band.bonusTargetPct === null && band.pensionNote === null
        ? 'The band records base only. If there is a bonus target or a pension worth naming, the real gap may be smaller than this.'
        : null,
    };
  }

  if (floor !== null && wants < floor) {
    return {
      verdict: 'below_band',
      overBy: null,
      suggestedFactor8: 5,
      headline:
        `${money(wants)} against a band starting at ${money(floor)}. No affordability problem, ` +
        'but check the level: an expectation under the floor usually means the person has read ' +
        'the role as smaller than it is, and that misreading surfaces at offer as a different problem.',
      caveat: null,
    };
  }

  const atCeiling = top !== null && Number(top - wants) / Number(top) <= CEILING_TOLERANCE;
  return {
    verdict: atCeiling ? 'at_ceiling' : 'within',
    overBy: null,
    suggestedFactor8: atCeiling ? 4 : 5,
    headline: atCeiling
      ? `${money(wants)} sits at the top of ${bandText}. Affordable with no room left, so every ` +
        'later concession has to come from scope, title or start date rather than base.'
      : `${money(wants)} sits inside ${bandText}. No compensation obstacle on the numbers as they stand.`,
    caveat: null,
  };
}

/**
 * Factor 8 is "Compensation openness and fit". The gap answers fit. Openness,
 * whether the person would discuss it at all, is the recruiter's call, and this
 * function will not make it for them.
 */
export function factor8Guidance(analysis: GapAnalysis, discussed: boolean): string {
  if (!discussed) {
    return 'Compensation was not discussed, so factor 8 rests on openness alone. A person who ' +
      'will not discuss pay at an exploratory stage is not necessarily closed; a person who ' +
      'refuses to discuss it at all usually is.';
  }
  if (analysis.suggestedFactor8 === null) return analysis.headline;
  return `${analysis.headline} On fit alone that suggests ${analysis.suggestedFactor8} out of 5. ` +
    'Adjust for how openly they engaged with the question, which is the other half of this factor.';
}
