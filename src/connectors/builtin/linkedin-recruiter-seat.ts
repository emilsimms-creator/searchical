import type { ManualEntryConnector } from '../contract';

/**
 * LinkedIn Recruiter, modelled as what it actually is: a human operated
 * surface, not a data source.
 *
 * Verified September 2026. LinkedIn Talent Solutions offers Recruiter System
 * Connect, CRM Connect, Apply Connect, Apply with LinkedIn and the Job Posting
 * API, all partner gated and all synchronisation interfaces. None of them
 * exposes member search at any tier. The user agreement prohibits scraping and
 * that prohibition has been held enforceable in contract; LinkedIn sued the
 * largest LinkedIn data interface in the market in January 2025 and it shut
 * down under permanent injunction in July 2025.
 *
 * The recruiter therefore works the seat and records the outcome. This
 * connector carries no fetch method, so there is no code path that can ingest
 * it. That is the point.
 */
export const linkedInRecruiterSeat: ManualEntryConnector = {
  id: 'linkedin-recruiter-seat',
  displayName: 'LinkedIn Recruiter (human operated seat)',
  persistence: 'manual_entry_only',
  yields: ['person', 'organization', 'employment', 'signal'],
  lawfulBasis: 'legitimate_interest',
  jurisdictions: ['GLOBAL'],
  rateLimit: { requests: 0, windowMs: 0, note: 'No programmatic access. Human seat only.' },
  freshnessMs: 30 * 24 * 60 * 60 * 1000,
  baseConfidence: 0.9,
  termsRef: 'https://www.linkedin.com/legal/user-agreement',
  coverage: [
    { region: 'CA', confidence: 0.95, note: 'One of the deepest LinkedIn markets in the world' },
    { region: 'US', confidence: 0.95 },
    { region: 'GB', confidence: 0.9 },
    { region: 'EU', confidence: 0.85 },
    { region: 'IN', confidence: 0.85 },
    { region: 'AU', confidence: 0.85 },
    { region: 'JP', confidence: 0.45, note: 'Domestic platforms hold much of the senior population' },
    { region: 'KR', confidence: 0.4 },
    { region: 'CN', confidence: 0.05, note: 'Professional network of record is not accessible' },
  ],
  etiquette: [
    'Keep InMail under 400 characters. Individually written, never bulk.',
    'Executives treat cold InMail as low trust: prefer a warm introduction.',
    'Record the outcome of the seat in Searchical. Never bulk export profiles.',
  ],
  seatInstructions:
    'Search in the Recruiter seat by hand. When a person is worth tracking, record them here with ' +
    'the reason they were surfaced and which Spotlight fired. Searchical stores your assessment, ' +
    'not the platform’s data.',
};
