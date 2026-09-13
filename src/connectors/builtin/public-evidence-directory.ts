import type { IngestibleRecord, PersistingConnector, FetchQuery } from '../contract';

/**
 * Public expert directories: vendor ambassador and most valuable professional
 * programmes, foundation contributor and ambassador lists, conference speaker
 * programmes. These are effectively pre vetted shortlists of senior technical
 * people, filterable by country, and they are the main source of the specific
 * verifiable hook the personalisation gate requires.
 *
 * Phase 0 ships the contract and a fixture backed implementation. The live
 * fetch lands in phase one alongside the mandate engine that consumes it.
 */
export function createPublicEvidenceDirectory(
  fixture: readonly IngestibleRecord[] = [],
): PersistingConnector {
  return {
    id: 'public-evidence-directory',
    displayName: 'Public expert and speaker directories',
    persistence: 'persist',
    yields: ['person', 'organization', 'signal'],
    lawfulBasis: 'publicly_available_exemption',
    jurisdictions: ['CA', 'US', 'GB', 'EU', 'AU'],
    rateLimit: { requests: 30, windowMs: 60_000, note: 'Conservative: most directories publish none.' },
    freshnessMs: 90 * 24 * 60 * 60 * 1000,
    baseConfidence: 0.75,
    termsRef: 'per-directory://terms-recorded-on-source',
    coverage: [
      { region: 'CA', confidence: 0.6 },
      { region: 'US', confidence: 0.7 },
      { region: 'GB', confidence: 0.6 },
      { region: 'EU', confidence: 0.55 },
      { region: 'JP', confidence: 0.3 },
      { region: 'CN', confidence: 0.1 },
    ],
    etiquette: [
      'A directory listing is an identification surface, never a mailing list.',
      'Cite the specific talk, repository or programme in the first touch.',
    ],
    async fetch(query: FetchQuery): Promise<readonly IngestibleRecord[]> {
      const limit = query.limit ?? fixture.length;
      return fixture.slice(0, limit);
    },
  };
}
