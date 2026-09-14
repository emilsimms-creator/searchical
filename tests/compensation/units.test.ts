import { describe, expect, it } from 'vitest';
import {
  analyseGap, factor8Guidance, formatRange, mentionsMoney, missingBandQuestion,
  normaliseCurrency, parseAmount, payHistoryRestrictedAt, ruleForLocation, toCents,
  type CompensationBand, type ProspectFigure,
} from '@/compensation';

const band = (over: Partial<CompensationBand> = {}): CompensationBand => ({
  id: 'b1', mandateId: 'm1', version: 1, currency: 'CAD', period: 'annual',
  baseMinCents: toCents(185_000), baseMaxCents: toCents(225_000), bonusTargetPct: 20,
  equityNote: null, pensionNote: null, otherNote: null,
  inferred: false, sourceQuote: 'Base salary $185,000 to $225,000',
  confirmedBy: 'emil', confirmedAt: new Date('2026-09-01'),
  supersededAt: null, supersededReason: null, ...over,
});

const wants = (dollars: number, over: Partial<ProspectFigure> = {}): ProspectFigure => ({
  id: 'f1', prospectId: 'p1', figureKind: 'expectation', currency: 'CAD', period: 'annual',
  amountCents: toCents(dollars), amountMaxCents: null, volunteered: true, note: null, ...over,
});

describe('money', () => {
  it('stores cents as integers, because a rounding error in a band is one a candidate notices', () => {
    expect(toCents(185_000)).toBe(18_500_000n);
    expect(toCents(0)).toBe(0n);
    expect(() => toCents(-1)).toThrow(/cannot be negative/);
    expect(() => toCents(10.005)).toThrow(/finer than a cent/);
  });

  it('defaults to CAD and refuses anything that is not a currency code', () => {
    expect(normaliseCurrency(undefined)).toBe('CAD');
    expect(normaliseCurrency('usd')).toBe('USD');
    expect(() => normaliseCurrency('dollars')).toThrow(/ISO 4217/);
  });

  it('reads the money a specification actually writes', () => {
    expect(parseAmount('$185,000')).toEqual({ cents: toCents(185_000), currency: null });
    expect(parseAmount('185k')).toEqual({ cents: toCents(185_000), currency: null });
    expect(parseAmount('CAD 185,000')).toEqual({ cents: toCents(185_000), currency: 'CAD' });
    expect(parseAmount('$1,200/day')).toEqual({ cents: toCents(1_200), currency: null });
  });

  it('returns null rather than guessing, because a misread band is worse than an absent one', () => {
    expect(parseAmount('competitive')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('over detects money in a draft, because a false negative cannot be taken back', () => {
    expect(mentionsMoney('The base is $210,000.')).toBe(true);
    expect(mentionsMoney('around 210k')).toBe(true);
    expect(mentionsMoney('The compensation is competitive.')).toBe(true);
    expect(mentionsMoney('Your KubeCon talk on multi-cluster failover stood out.')).toBe(false);
  });

  it('formats a band the way a recruiter would say it', () => {
    expect(formatRange(toCents(185_000), toCents(225_000))).toMatch(/185,000.*225,000/);
    expect(formatRange(toCents(185_000), null)).toMatch(/and up/);
    expect(formatRange(null, null)).toBe('no band');
  });
});

describe('the pay transparency rules', () => {
  it('knows Ontario exempts roles above two hundred thousand, which most of these are', () => {
    const on = ruleForLocation('Toronto, Ontario')!;
    expect(on.jurisdiction).toBe('ON');
    expect(on.exemptAboveAnnualCents).toBe(20_000_000n);
    expect(on.maximumRangeWidthCents).toBe(5_000_000n);
    expect(on.employerHeadcountFloor).toBe(25);
  });

  it('knows British Columbia has no such exemption and restricts pay history', () => {
    const bc = ruleForLocation('Vancouver')!;
    expect(bc.exemptAboveAnnualCents).toBeNull();
    expect(bc.payHistoryRestricted).toBe(true);
  });

  it('does not guess at an unrecognised place, because the answer becomes a sentence to a client', () => {
    expect(ruleForLocation('Kingston, Jamaica')).toBeNull();
    expect(ruleForLocation(null)).toBeNull();
  });

  it('treats an unknown jurisdiction as restricting pay history', () => {
    // The safe default for a question nobody needs to ask is not to ask it.
    expect(payHistoryRestrictedAt(null)).toBe(true);
    expect(payHistoryRestrictedAt('Toronto, Ontario')).toBe(false);
  });

  it('asks for the band, and never announces a compliance finding', () => {
    const ontario = missingBandQuestion('Toronto, Ontario');
    expect(ontario).toMatch(/not as a finding/);
    expect(ontario).toMatch(/\$200,000/);
    expect(ontario).not.toMatch(/non.?compliant|breach|violation/i);

    const bc = missingBandQuestion('Vancouver');
    expect(bc).toMatch(/no upper exemption/);

    expect(missingBandQuestion(null)).toMatch(/dies on at offer/);
  });
});

describe('the gap that kills searches at offer', () => {
  it('compares only a confirmed band', () => {
    expect(analyseGap(band({ confirmedAt: null, confirmedBy: null }), wants(200_000)).verdict)
      .toBe('unknown');
    expect(analyseGap(null, wants(200_000)).verdict).toBe('unknown');
    expect(analyseGap(band(), null).verdict).toBe('unknown');
  });

  it('calls an expectation inside the band no obstacle', () => {
    const a = analyseGap(band(), wants(200_000));
    expect(a.verdict).toBe('within');
    expect(a.suggestedFactor8).toBe(5);
  });

  it('warns at the ceiling, where there is no room left to concede', () => {
    const a = analyseGap(band(), wants(220_000));
    expect(a.verdict).toBe('at_ceiling');
    expect(a.headline).toMatch(/no room left/);
  });

  it('measures how far over, and says stop when it is unbridgeable', () => {
    const near = analyseGap(band(), wants(240_000));
    expect(near.verdict).toBe('above_band');
    expect(Math.round(near.overBy! * 100)).toBe(7);
    expect(near.suggestedFactor8).toBe(3);

    const far = analyseGap(band(), wants(300_000));
    expect(far.suggestedFactor8).toBe(0);
    expect(far.headline).toMatch(/kills searches at offer/);
  });

  it('takes the top of a candidate range, because that is what they hold out for', () => {
    const a = analyseGap(band(), wants(200_000, { amountMaxCents: toCents(260_000) }));
    expect(a.verdict).toBe('above_band');
  });

  it('flags an expectation under the floor as a level problem, not a bargain', () => {
    const a = analyseGap(band(), wants(120_000));
    expect(a.verdict).toBe('below_band');
    expect(a.headline).toMatch(/check the level/);
  });

  it('refuses to compare across currencies without a rate', () => {
    const a = analyseGap(band(), wants(200_000, { currency: 'USD' }));
    expect(a.verdict).toBe('incomparable');
    expect(a.headline).toMatch(/not comparable without a rate/);
    expect(a.suggestedFactor8).toBeNull();
  });

  it('refuses to compare an annual band against a day rate', () => {
    expect(analyseGap(band(), wants(1_200, { period: 'daily' })).verdict).toBe('incomparable');
  });

  it('notes when a base only band understates the real gap', () => {
    const a = analyseGap(band({ bonusTargetPct: null }), wants(240_000));
    expect(a.caveat).toMatch(/base only/);
  });

  it('will not decide factor 8, because openness is not arithmetic', () => {
    const a = analyseGap(band(), wants(200_000));
    expect(factor8Guidance(a, false)).toMatch(/openness alone/);
    expect(factor8Guidance(a, true)).toMatch(/suggests 5 out of 5/);
    expect(factor8Guidance(a, true)).toMatch(/other half of this factor/);
  });
});
