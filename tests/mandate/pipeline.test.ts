import { describe, expect, it } from 'vitest';
import { PIPELINE_DEFAULTS, projectPipeline } from '@/mandate';

describe('pipeline arithmetic', () => {
  it('reproduces the worked example: ten conversations needs one hundred contacts', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 75 });
    expect(p.contactsRequired).toBe(100);
    expect(p.touchesRequired).toBe(500);
  });

  it('rounds up, because you cannot contact a fraction of a person', () => {
    // 7 / (0.2 x 0.5) = 70 exactly; 8 / 0.1 = 80; 9 / 0.15 = 60
    expect(projectPipeline({ targetConversations: 7, longListSize: 100 }).contactsRequired).toBe(70);
    expect(
      projectPipeline({ targetConversations: 5, longListSize: 100, responseRate: 0.3, interestedShare: 0.5 })
        .contactsRequired,
    ).toBe(34);
  });

  it('flags the long list gap, which is the most common silent failure in a search', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 75 });
    expect(p.longListSufficient).toBe(false);
    expect(p.shortfall).toBe(25);
    expect(p.advice[0]).toMatch(/25 short of the 100 people/);
    // It offers the moves that close the gap rather than only naming it.
    expect(p.advice.length).toBeGreaterThan(3);
  });

  it('stays quiet when the long list is large enough', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 120 });
    expect(p.longListSufficient).toBe(true);
    expect(p.advice).toEqual([]);
  });

  it('shows the working rather than only the number', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 120 });
    expect(p.workings).toBe(
      '10 interested conversations divided by a 20 percent response rate and a 50 percent interested share ' +
        'means 100 people contacted, and 500 touches at 5 per person.',
    );
  });

  it('refuses a sequence longer than six touches', () => {
    expect(() => projectPipeline({ targetConversations: 10, longListSize: 100, touchesPerPerson: 8 })).toThrow(
      /flattens after stage five/,
    );
  });

  it('rejects impossible rates rather than producing a confident wrong number', () => {
    expect(() => projectPipeline({ targetConversations: 10, longListSize: 100, responseRate: 0 })).toThrow(RangeError);
    expect(() => projectPipeline({ targetConversations: 10, longListSize: 100, interestedShare: 1.5 })).toThrow(RangeError);
    expect(() => projectPipeline({ targetConversations: 0, longListSize: 100 })).toThrow(RangeError);
  });

  it('names where the rates came from, so a recruiter knows whether to trust them', () => {
    expect(projectPipeline({ targetConversations: 10, longListSize: 100 }).ratesSource).toBe(
      PIPELINE_DEFAULTS.ratesSource,
    );
    const own = projectPipeline({
      targetConversations: 10,
      longListSize: 100,
      responseRate: 0.27,
      ratesSource: 'Practice history, senior executive segment',
      ratesSampleSize: 41,
    });
    expect(own.ratesSource).toMatch(/Practice history/);
    expect(own.ratesSampleSize).toBe(41);
  });
});
