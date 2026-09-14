import type { Currency } from './money';

export type CompensationPeriod = 'annual' | 'daily' | 'hourly';
export type CompensationFigureKind = 'expectation' | 'current_package';

/** One version of the mandate's band. */
export interface CompensationBand {
  readonly id: string;
  readonly mandateId: string;
  readonly version: number;
  readonly currency: Currency;
  readonly period: CompensationPeriod;
  readonly baseMinCents: bigint | null;
  readonly baseMaxCents: bigint | null;
  readonly bonusTargetPct: number | null;
  readonly equityNote: string | null;
  readonly pensionNote: string | null;
  readonly otherNote: string | null;
  readonly inferred: boolean;
  readonly sourceQuote: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly supersededAt: Date | null;
  readonly supersededReason: string | null;
}

/** What a prospect said they want, or what they are paid. Never both in one row. */
export interface ProspectFigure {
  readonly id: string;
  readonly prospectId: string;
  readonly figureKind: CompensationFigureKind;
  readonly currency: Currency;
  readonly period: CompensationPeriod;
  readonly amountCents: bigint | null;
  readonly amountMaxCents: bigint | null;
  readonly volunteered: boolean;
  readonly note: string | null;
}

export type GapVerdict =
  | 'within'          // the expectation lands inside the band
  | 'at_ceiling'      // at or within a whisker of the top: movable, but only just
  | 'above_band'      // the expectation exceeds the band
  | 'below_band'      // the expectation is under the floor
  | 'incomparable'    // different currency or different period, no rate supplied
  | 'unknown';        // no confirmed band, or no figure from the person

export interface GapAnalysis {
  readonly verdict: GapVerdict;
  /** How far above the top of the band, as a proportion. Null unless above_band. */
  readonly overBy: number | null;
  /** One sentence a recruiter can act on. */
  readonly headline: string;
  /**
   * A proposed 0 to 5 for factor 8 of the receptivity model, or null when there
   * is not enough to propose one. It is a proposal: factor 8 is openness AND
   * fit, and openness is a judgment about the conversation that no arithmetic
   * on two numbers can make.
   */
  readonly suggestedFactor8: number | null;
  readonly caveat: string | null;
}
