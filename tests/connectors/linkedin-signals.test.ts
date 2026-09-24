import { describe, expect, it } from 'vitest';
import {
  EntitlementError, LINKEDIN_SIGNALS, SIGNAL_CODE_MAP, entitlementFor, mapProviderSignals,
  openLinkedInSignals, type LicensedAgreement, type ProviderSignal, type SignalsTransport,
} from '@/connectors';
import { enabledSources, sourceById } from '@/discovery';

const NOW = new Date('2026-09-24T12:00:00Z');

const agreement = (over: Partial<LicensedAgreement> = {}): LicensedAgreement => ({
  counterparty: 'LinkedIn',
  licensee: 'Searchical Inc.',
  reference: 'LI-SIGNALS-0001',
  executedOn: '2026-09-01',
  expiresOn: '2027-09-01',
  permitsPersistence: false,
  permittedPurposes: ['recruitment'],
  recordedBy: 'emil',
  ...over,
});

const transport: SignalsTransport = { callTool: async () => ({}) };

const signal = (providerCode: string): ProviderSignal => ({
  providerCode, subject: { kind: 'person', providerRef: 'urn:li:person:1' }, observedAt: NOW,
});

describe('entitlement to a licensed source', () => {
  it('refuses when no agreement is recorded, which is the state today', () => {
    const e = entitlementFor({ agreement: null, operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW });
    expect(e.entitled).toBe(false);
    expect(e.reasons[0]).toMatch(/does not become ours by being reachable/);
  });

  /**
   * The question the operator could not yet answer, encoded: partner access is
   * tied to the named licensee.
   */
  it('refuses an agreement that names a different entity from the operator', () => {
    const e = entitlementFor({
      agreement: agreement({ licensee: 'CDW Canada Corp.' }),
      operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW,
    });
    expect(e.entitled).toBe(false);
    expect(e.reasons[0]).toMatch(/names CDW Canada Corp\. as licensee/);
    expect(e.reasons[0]).toMatch(/needs that entity's own agreement, or written consent/);
  });

  it('accepts the same agreement when the named licensee is the operator', () => {
    const e = entitlementFor({
      agreement: agreement({ licensee: 'CDW Canada Corp.' }),
      operatingEntity: '  cdw canada corp. ', purpose: 'recruitment', now: NOW,
    });
    expect(e.entitled).toBe(true);
  });

  it('refuses an expired agreement, and one not yet in force', () => {
    expect(entitlementFor({
      agreement: agreement({ expiresOn: '2026-06-30' }),
      operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW,
    }).reasons.join(' ')).toMatch(/expired on 2026-06-30/);
    expect(entitlementFor({
      agreement: agreement({ executedOn: '2026-12-01' }),
      operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW,
    }).reasons.join(' ')).toMatch(/not yet in force/);
  });

  /** A sales licence is not automatically a recruiting licence. */
  it('refuses a purpose the agreement does not permit', () => {
    const e = entitlementFor({
      agreement: agreement({ permittedPurposes: ['sales prospecting'] }),
      operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW,
    });
    expect(e.reasons[0]).toMatch(/not recruitment\. A sales intelligence licence is not automatically a recruiting licence/);
  });

  it('gives every reason at once, not the first one', () => {
    const e = entitlementFor({
      agreement: agreement({ licensee: 'Other Co', expiresOn: '2026-01-01', permittedPurposes: [] }),
      operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW,
    });
    expect(e.reasons).toHaveLength(3);
  });

  it('allows keeping results only where the agreement says so', () => {
    expect(entitlementFor({ agreement: agreement(), operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW }).mayPersist).toBe(false);
    expect(entitlementFor({ agreement: agreement({ permitsPersistence: true }), operatingEntity: 'Searchical Inc.', purpose: 'recruitment', now: NOW }).mayPersist).toBe(true);
  });
});

describe('the LinkedIn Signals slot', () => {
  it('will not open today: no agreement and no spec', () => {
    try {
      openLinkedInSignals({ agreement: null, operatingEntity: 'Searchical Inc.', transport: null, now: NOW });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(EntitlementError);
      const reasons = (e as EntitlementError).reasons;
      expect(reasons).toHaveLength(2);
      expect(reasons[1]).toMatch(/written against the spec, not ahead of it/);
    }
  });

  it('will not open on a valid agreement without a transport', () => {
    expect(() => openLinkedInSignals({ agreement: agreement(), operatingEntity: 'Searchical Inc.', transport: null, now: NOW }))
      .toThrow(/No transport is configured/);
  });

  it('opens only with both, and carries the persistence answer with it', () => {
    const opened = openLinkedInSignals({ agreement: agreement(), operatingEntity: 'Searchical Inc.', transport, now: NOW });
    expect(opened.transport).toBe(transport);
    expect(opened.mayPersist).toBe(false);
  });

  /** Likely is not good enough for a table that decides who is called first. */
  it('ships with an empty signal map, so nothing is translated by guesswork', () => {
    expect(SIGNAL_CODE_MAP).toEqual({});
    const out = mapProviderSignals([signal('OPEN_TO_WORK_RECRUITERS'), signal('PROFILE_UPDATE_BURST')]);
    expect(out.mapped).toEqual([]);
    expect(out.unmapped).toEqual(['OPEN_TO_WORK_RECRUITERS', 'PROFILE_UPDATE_BURST']);
  });

  it('maps a documented code onto a signal type this system defines', () => {
    const out = mapProviderSignals(
      [signal('OPEN_TO_WORK_RECRUITERS'), signal('UNKNOWN_THING')],
      { OPEN_TO_WORK_RECRUITERS: 'recruiter_only_open_to' },
    );
    expect(out.mapped.map((m) => m.signalTypeCode)).toEqual(['recruiter_only_open_to']);
    expect(out.unmapped).toEqual(['UNKNOWN_THING']);
  });

  it('refuses a map entry pointing at a signal type that does not exist', () => {
    expect(() => mapProviderSignals([], { X: 'made_up_signal' })).toThrow(/would drop the signal silently/);
  });

  it('sits in the discovery catalogue as licensed, never fetched, not enabled', () => {
    const source = sourceById('linkedin_signals')!;
    expect(source.access).toBe('licensed');
    expect(source.automatedFetch).toBe('never');
    expect(source.terms.verified).toBe(false);
    expect(source.terms.openQuestion).toMatch(/Whose agreement Searchical runs on/);
    expect(enabledSources().map((s) => s.id)).not.toContain('linkedin_signals');
    expect(LINKEDIN_SIGNALS.status).toBe('awaiting_spec_and_agreement');
  });

  /** The public profile rule is unchanged by any of this. */
  it('leaves LinkedIn public profiles exactly where they were', () => {
    const profiles = sourceById('linkedin_public_xray')!;
    expect(profiles.persistence).toBe('manual_entry_only');
    expect(profiles.automatedFetch).toBe('never');
  });
});
