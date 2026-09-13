import { describe, expect, it } from 'vitest';
import {
  SCORE_MODEL_V1, SIGNAL_TYPE_SEED, assertModelIsCoherent, deriveSignalFactor,
  evaluateStacking, scoreProspect, type ScoredSignal,
} from '@/receptivity';

const AS_OF = new Date('2026-09-09T00:00:00Z');
const day = (n: number) => new Date(AS_OF.getTime() - n * 86_400_000);

const signal = (over: Partial<ScoredSignal> = {}): ScoredSignal => ({
  code: 'generic', label: 'A signal', category: 'linkedin_behaviour', subjectType: 'person',
  points: 2, observedAt: day(5), expiresAt: new Date(AS_OF.getTime() + 86_400_000),
  live: true, viaEmployer: false, ...over,
});

const trigger = (over: Partial<ScoredSignal> = {}) =>
  signal({ code: 'rto', label: 'Employer return-to-office mandate', category: 'employer_trigger',
           subjectType: 'organization', points: 4, viaEmployer: true, ...over });

describe('the scoring model', () => {
  it('is coherent as shipped', () => {
    expect(() => assertModelIsCoherent(SCORE_MODEL_V1)).not.toThrow();
    expect(SCORE_MODEL_V1.factors.reduce((s, f) => s + f.weight, 0)).toBe(100);
  });

  it('rejects a model whose weights do not total 100', () => {
    const broken = { ...SCORE_MODEL_V1, factors: SCORE_MODEL_V1.factors.map((f) => ({ ...f, weight: 20 })) };
    expect(() => assertModelIsCoherent(broken)).toThrow(/total 160, not 100/);
  });

  it('rejects tiers a score could fall through', () => {
    const broken = { ...SCORE_MODEL_V1, tiers: SCORE_MODEL_V1.tiers.map((t) => ({ ...t, minimumScore: 40 })) };
    expect(() => assertModelIsCoherent(broken)).toThrow(/must start at 0/);
  });

  it('carries the caveat that the research demands', () => {
    expect(SCORE_MODEL_V1.notes).toMatch(/Decision support, not prediction/);
    expect(SCORE_MODEL_V1.notes).toMatch(/No validated predictive model/);
  });
});

/**
 * The workbook ships three example rows. Reproducing them exactly is the
 * cheapest possible proof that the arithmetic in software is the arithmetic the
 * practice already agreed to.
 */
describe("the workbook's own worked examples", () => {
  it('Example A: a hot candidate at 82 raw, 78.7 after twelve days', () => {
    // The workbook row carries F1 = 4, which this engine derives from the
    // ledger rather than accepting by hand: twelve points of live signal.
    const withSignals = scoreProspect({
      signals: [signal({ points: 6 }), trigger({ points: 6 })],
      interestScale: 'yes',
      recruiterFactors: { f3: 4, f4: 3, f5: 5, f6: 3, f7: 4, f8: 3 },
      lastMeaningfulTouchAt: new Date('2026-08-28T00:00:00Z'),
      asOf: AS_OF, model: SCORE_MODEL_V1,
    });
    expect(withSignals.explanation.factors[0]!.value).toBe(4);
    expect(withSignals.rawScore).toBe(82);
    expect(withSignals.decayedScore).toBe(78.7);
    expect(withSignals.tier).toBe('hot');
    expect(withSignals.nextTouchDueAt?.toISOString().slice(0, 10)).toBe('2026-09-27');
  });

  it('Example B: a warm prospect decayed from 64 to 49.1 after seventy days', () => {
    const result = scoreProspect({
      signals: [signal({ points: 5 }), trigger({ points: 4 })],
      interestScale: 'maybe',
      recruiterFactors: { f3: 2, f4: 3, f5: 4, f6: 2, f7: 5, f8: 3 },
      lastMeaningfulTouchAt: new Date('2026-07-01T00:00:00Z'),
      asOf: AS_OF, model: SCORE_MODEL_V1,
    });
    expect(result.explanation.factors[0]!.value).toBe(3);
    expect(result.rawScore).toBe(64);
    expect(result.decayedScore).toBe(49.1);
    expect(result.tier).toBe('warm');
    expect(result.explanation.daysSinceTouch).toBe(70);
  });

  it('Example C: a cool source at 27 raw', () => {
    const result = scoreProspect({
      signals: [signal({ points: 2 })],
      interestScale: 'no',
      recruiterFactors: { f3: 1, f4: 1, f5: 2, f6: 1, f7: 4, f8: 2 },
      lastMeaningfulTouchAt: new Date('2026-09-02T00:00:00Z'),
      asOf: AS_OF, model: SCORE_MODEL_V1,
    });
    expect(result.explanation.factors[0]!.value).toBe(1);
    expect(result.rawScore).toBe(27);
    expect(result.decayedScore).toBe(26.4);
    expect(result.tier).toBe('cool');
  });
});

describe('decay', () => {
  it('does not decay a score that has never been touched', () => {
    const r = scoreProspect({ signals: [], interestScale: 'yes', asOf: AS_OF, model: SCORE_MODEL_V1 });
    expect(r.rawScore).toBe(r.decayedScore);
    expect(r.explanation.daysSinceTouch).toBeNull();
    expect(r.nextTouchDueAt).toBeNull();
  });

  // Every factor at the top of the scale except F1, which has no signals to
  // derive from, so the ceiling here is 90 rather than 100. That gap is the
  // ten percent the model assigns to pre-contact evidence.
  const perfectExceptSignals = (days: number) => scoreProspect({
    signals: [], interestScale: 'yes',
    recruiterFactors: { f3: 5, f4: 5, f5: 5, f6: 5, f7: 5, f8: 5 },
    lastMeaningfulTouchAt: day(days), asOf: AS_OF, model: SCORE_MODEL_V1,
  });

  it('never decays below half, so a strong candidate does not vanish', () => {
    const r = perfectExceptSignals(3650);
    expect(r.rawScore).toBe(90);
    expect(r.decayedScore).toBe(45);
  });

  it('loses ten percent per thirty untouched days', () => {
    expect(perfectExceptSignals(0).decayedScore).toBe(90);
    expect(perfectExceptSignals(30).decayedScore).toBe(81);
    expect(perfectExceptSignals(60).decayedScore).toBe(72);
  });

  it('reaches 100 only when the signals are there too', () => {
    const r = scoreProspect({
      signals: [signal({ points: 15 })], interestScale: 'yes',
      recruiterFactors: { f3: 5, f4: 5, f5: 5, f6: 5, f7: 5, f8: 5 },
      asOf: AS_OF, model: SCORE_MODEL_V1,
    });
    expect(r.rawScore).toBe(100);
  });
});

describe('the stacking rule', () => {
  it('refuses a single signal, however strong', () => {
    const v = evaluateStacking([trigger({ points: 4 })], SCORE_MODEL_V1, AS_OF);
    expect(v.eligible).toBe(false);
    expect(v.statement).toMatch(/stays a watch rather than an approach/);
  });

  it('refuses two individual behaviours with no employer trigger', () => {
    const v = evaluateStacking([signal(), signal({ code: 'other' })], SCORE_MODEL_V1, AS_OF);
    expect(v.eligible).toBe(false);
    expect(v.employerTriggers).toBe(0);
  });

  it('admits one employer trigger plus one individual behaviour', () => {
    const v = evaluateStacking([trigger(), signal()], SCORE_MODEL_V1, AS_OF);
    expect(v.eligible).toBe(true);
    expect(v.statement).toMatch(/Eligible for active outreach/);
  });

  it('ignores a signal that has aged out of its own window', () => {
    const v = evaluateStacking(
      [trigger(), signal({ live: false, expiresAt: day(1) })],
      SCORE_MODEL_V1, AS_OF,
    );
    expect(v.eligible).toBe(false);
    expect(v.liveSignals).toBe(1);
  });

  it('ignores a live signal observed outside the stacking window', () => {
    // Live by its own long expiry, but not recent enough to stack with anything.
    const v = evaluateStacking(
      [trigger(), signal({ observedAt: day(200), expiresAt: new Date(AS_OF.getTime() + 86_400_000) })],
      SCORE_MODEL_V1, AS_OF,
    );
    expect(v.liveSignals).toBe(1);
    expect(v.eligible).toBe(false);
  });
});

describe('factor one derives from the ledger', () => {
  it('converts points to a zero to five score and caps at the top', () => {
    expect(deriveSignalFactor([], SCORE_MODEL_V1)).toBe(0);
    expect(deriveSignalFactor([signal({ points: 3 })], SCORE_MODEL_V1)).toBe(1);
    expect(deriveSignalFactor([signal({ points: 100 })], SCORE_MODEL_V1)).toBe(5);
  });

  it('counts only live signals', () => {
    const stale = signal({ points: 12, live: false });
    expect(deriveSignalFactor([stale], SCORE_MODEL_V1)).toBe(0);
  });
});

describe('the explanation', () => {
  const result = scoreProspect({
    signals: [trigger({ observedAt: day(2) }), signal({ points: 3 })],
    interestScale: 'yes',
    recruiterFactors: { f3: 4, f4: 3, f5: 5, f6: 3, f7: 4, f8: 3 },
    lastMeaningfulTouchAt: day(10),
    asOf: AS_OF, model: SCORE_MODEL_V1,
  });

  it('carries every factor with its weight, value and contribution', () => {
    expect(result.explanation.factors).toHaveLength(8);
    for (const f of result.explanation.factors) {
      expect(f.note.length).toBeGreaterThan(5);
      expect(f.contribution).toBe(Math.round((f.value * f.weight) / 5 * 10) / 10);
    }
  });

  it('names the model version that produced it', () => {
    expect(result.explanation.modelVersion).toBe(SCORE_MODEL_V1.version);
  });

  it('distinguishes the two derived factors from the six scored by hand', () => {
    const derived = result.explanation.factors.filter((f) => f.derived).map((f) => f.id);
    expect(derived).toEqual(['f1', 'f2']);
  });

  it('gives a headline naming the evidence rather than only the number', () => {
    expect(result.explanation.headline).toMatch(/^HOT at /);
    expect(result.explanation.headline).toMatch(/most recent employer trigger: employer return-to-office mandate/);
  });

  it('says when a person is not yet eligible for outreach', () => {
    const single = scoreProspect({ signals: [trigger()], asOf: AS_OF, model: SCORE_MODEL_V1 });
    expect(single.explanation.headline).toMatch(/not yet eligible for outreach/);
  });

  it('records what was not yet scored, rather than silently treating it as zero merit', () => {
    const early = scoreProspect({ signals: [trigger()], asOf: AS_OF, model: SCORE_MODEL_V1 });
    const f5 = early.explanation.factors.find((f) => f.id === 'f5')!;
    expect(f5.note).toMatch(/comes from the exploratory call/);
  });
});

describe('the signal taxonomy', () => {
  it('carries all twenty three signals with their citations', () => {
    expect(SIGNAL_TYPE_SEED).toHaveLength(23);
    for (const s of SIGNAL_TYPE_SEED) {
      expect(s.sourceCitation.length, s.code).toBeGreaterThan(5);
      expect(s.points, s.code).toBeGreaterThanOrEqual(1);
      expect(s.points, s.code).toBeLessThanOrEqual(4);
    }
  });

  it('has unique codes', () => {
    expect(new Set(SIGNAL_TYPE_SEED.map((s) => s.code)).size).toBe(23);
  });

  it('puts exactly the employer triggers on the organization clock', () => {
    const org = SIGNAL_TYPE_SEED.filter((s) => s.subjectType === 'organization');
    expect(org).toHaveLength(6);
    expect(org.every((s) => s.category === 'employer_trigger')).toBe(true);
  });

  it('expires a layoff faster than a merger, because relevance decays differently', () => {
    const layoff = SIGNAL_TYPE_SEED.find((s) => s.code.startsWith('layoffs'))!;
    const merger = SIGNAL_TYPE_SEED.find((s) => s.code.startsWith('merger'))!;
    expect(layoff.recencyWindowDays).toBeLessThan(merger.recencyWindowDays);
    expect(layoff.windowNote).toMatch(/decays within days/);
  });
});
