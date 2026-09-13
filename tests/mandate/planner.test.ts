import { describe, expect, it } from 'vitest';
import { CHANNEL_MATRIX_SEED, CHANNEL_THRESHOLDS, planChannels } from '@/mandate';

describe('the channel matrix seed', () => {
  it('carries all twenty nine channels with ratings in range', () => {
    expect(CHANNEL_MATRIX_SEED).toHaveLength(29);
    for (const c of CHANNEL_MATRIX_SEED) {
      expect(c.fitSeniorExecutive, c.name).toBeGreaterThanOrEqual(1);
      expect(c.fitSeniorExecutive, c.name).toBeLessThanOrEqual(5);
      expect(c.fitSeniorItConsultant, c.name).toBeGreaterThanOrEqual(1);
      expect(c.fitSeniorItConsultant, c.name).toBeLessThanOrEqual(5);
      expect(c.etiquette.length, c.name).toBeGreaterThan(10);
      expect(c.keySource.length, c.name).toBeGreaterThan(3);
    }
  });

  it('has unique codes, so a rating cannot silently overwrite another', () => {
    expect(new Set(CHANNEL_MATRIX_SEED.map((c) => c.code)).size).toBe(29);
  });

  it('keeps the research intact: referrals rate 5 for both segments', () => {
    const referrals = CHANNEL_MATRIX_SEED.find((c) => c.name.startsWith('Referrals'))!;
    expect(referrals.fitSeniorExecutive).toBe(5);
    expect(referrals.fitSeniorItConsultant).toBe(5);
  });
});

describe('channel planning', () => {
  it('recommends three to five channels', () => {
    for (const segment of ['senior_executive', 'senior_it_consultant'] as const) {
      const plan = planChannels(CHANNEL_MATRIX_SEED, segment);
      expect(plan.recommended.length, segment).toBeGreaterThanOrEqual(CHANNEL_THRESHOLDS.minRecommended);
      expect(plan.recommended.length, segment).toBeLessThanOrEqual(CHANNEL_THRESHOLDS.maxRecommended);
    }
  });

  it('ranks every channel and leaves none unexplained', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'senior_executive');
    expect(plan.selections).toHaveLength(29);
    for (const s of plan.selections) {
      expect(s.reason.length, s.name).toBeGreaterThan(10);
    }
  });

  it('states why a skipped channel was skipped, because that is part of the plan', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'senior_executive');
    const github = plan.selections.find((s) => s.channelCode === 'github')!;
    expect(github.priority).toBe('skip');
    expect(github.reason).toMatch(/Rated 1 of 5 for senior executives: no return on effort/);
  });

  it('produces genuinely different plans for the two segments', () => {
    const exec = planChannels(CHANNEL_MATRIX_SEED, 'senior_executive');
    const consultant = planChannels(CHANNEL_MATRIX_SEED, 'senior_it_consultant');

    // GitHub is rated 1 for executives and 5 for senior IT consultants.
    expect(exec.selections.find((s) => s.channelCode === 'github')!.priority).toBe('skip');
    expect(consultant.selections.find((s) => s.channelCode === 'github')!.priority).toBe('primary');

    // The Canadian CIO association is the reverse.
    const ciocan = 'cio_association_of_canada';
    expect(exec.selections.find((s) => s.channelCode === ciocan)!.priority).toBe('primary');
    expect(consultant.selections.find((s) => s.channelCode === ciocan)!.priority).toBe('skip');
  });

  it('weights warm and network channels up when trimming', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'senior_executive');
    expect(plan.recommended.some((s) => s.name.startsWith('Referrals'))).toBe(true);
  });

  it('carries the etiquette to the point of use', () => {
    const plan = planChannels(CHANNEL_MATRIX_SEED, 'senior_it_consultant');
    const github = plan.selections.find((s) => s.channelCode === 'github')!;
    expect(github.etiquette).toMatch(/anti-cold-contact/i);
  });

  it('pulls secondaries up when too few channels rate as primary', () => {
    const thin = CHANNEL_MATRIX_SEED.map((c) => ({
      ...c,
      fitSeniorExecutive: c.code === 'referrals_from_past_placements' ? 5 : 3,
    }));
    const plan = planChannels(thin, 'senior_executive');
    expect(plan.primaryCount).toBe(1);
    expect(plan.recommended).toHaveLength(3);
    expect(plan.note).toMatch(/pulled up to reach a three channel combination/);
  });
});
