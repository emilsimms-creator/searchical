import type { SequenceStepPlan } from './types';

/**
 * The default multi-channel sequence, from the practice's Playbook section 4.4.
 *
 * Three to five touches across ten to twenty one days, each with a distinct
 * job, and the channel varied between them because five InMails in a row is
 * worse than three InMails plus an email.
 */
export const DEFAULT_SEQUENCE: readonly SequenceStepPlan[] = [
  {
    touch: 1, earliestDay: 0, latestDay: 0,
    templateCode: 'first_inmail', channel: 'linkedin_inmail',
    purpose: 'The open: a specific hook and an exploratory, confidential ask',
    evidence: 'LinkedIn InMail data (2021); Adler opener (2023)',
    optional: false,
  },
  {
    touch: 2, earliestDay: 3, latestDay: 5,
    templateCode: 'first_email', channel: 'email',
    purpose: 'The reason-you email that pre-answers why the role matters and what the challenge is',
    evidence: 'Gem: reason token +47% (2024); Adler (2015)',
    optional: false,
  },
  {
    touch: 3, earliestDay: 7, latestDay: 10,
    templateCode: 'hiring_leader_followup', channel: 'email',
    purpose: 'A new angle: the problem the role solves, in the leader\'s voice',
    evidence: 'Gem: on-behalf-of +50% replies (2024); LinkedIn: 56% prefer the hiring manager (2017)',
    optional: false,
  },
  {
    touch: 4, earliestDay: 10, latestDay: 14,
    templateCode: 'voicemail', channel: 'voicemail',
    purpose: 'Referral-anchored, confidential, exploratory; five to ten minutes if they pick up',
    evidence: 'Savage (2022); Adler (2016); Dynamic Search (2022)',
    optional: false,
  },
  {
    touch: 5, earliestDay: 14, latestDay: 18,
    templateCode: 'polite_close', channel: 'email',
    purpose: 'Remove pressure, leave the door open, ask for a referral',
    evidence: 'SocialTalent: often the highest-converting touch (2026)',
    optional: false,
  },
  {
    touch: 6, earliestDay: 21, latestDay: 21,
    templateCode: 'referral_ask', channel: 'email',
    purpose: 'Optional future-tense reconnect; log to nurture and tie the next touch to a known trigger date',
    evidence: 'SocialTalent (2026); Pin cadence (2026)',
    optional: true,
  },
];

/**
 * Touch one differs by segment: a connection note converts better for senior
 * technologists, while executives get a short InMail or a warm introduction.
 */
export function sequenceFor(segment: 'senior_executive' | 'senior_it_consultant'): readonly SequenceStepPlan[] {
  if (segment === 'senior_executive') return DEFAULT_SEQUENCE;
  return DEFAULT_SEQUENCE.map((step) =>
    step.touch === 1
      ? { ...step, templateCode: 'linkedin_connection_note', channel: 'linkedin_connection' as const }
      : step,
  );
}

/**
 * Engagement flattens after stage five and over sequencing to six, seven or
 * eight backfires. Five is the ceiling; the sixth touch is optional and needs a
 * reason; there is no configuration that permits a seventh.
 */
export const SEQUENCE_LIMITS = {
  defaultTouches: 5,
  absoluteMaximum: 6,
  reason: 'Gem: engagement flattens after stage five. SocialTalent: going past five irritates candidates and dilutes the brand.',
} as const;
