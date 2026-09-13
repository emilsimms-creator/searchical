import type { ManualEntryConnector } from '../contract';

/**
 * A recruiter typing in something they learned: a phone call, a conversation at
 * an event, a note from a client. Provenance still applies, which is why this
 * is a registered source rather than an unattributed write.
 */
export const recruiterManualEntry: ManualEntryConnector = {
  id: 'recruiter-manual-entry',
  displayName: 'Recruiter manual entry',
  persistence: 'manual_entry_only',
  yields: ['person', 'organization', 'employment', 'signal', 'contact'],
  lawfulBasis: 'legitimate_interest',
  jurisdictions: ['GLOBAL'],
  rateLimit: { requests: 0, windowMs: 0, note: 'Human entry.' },
  freshnessMs: 180 * 24 * 60 * 60 * 1000,
  baseConfidence: 0.8,
  termsRef: 'internal://practice-policy',
  coverage: [{ region: 'GLOBAL', confidence: 0.3, note: 'Bounded by the practice network' }],
  seatInstructions: 'Record what you learned and where you learned it. A fact with no source is not a fact.',
};
