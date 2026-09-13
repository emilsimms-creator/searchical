import { describe, expect, it } from 'vitest';
import { PolicyEngine, PolicyViolation, type PolicyLookups } from '@/policy';
import { createPublicEvidenceDirectory, linkedInRecruiterSeat } from '@/connectors';

const NOW = new Date('2026-09-13T12:00:00Z');

const lookups = (over: Partial<PolicyLookups> = {}): PolicyLookups => ({
  isSuppressed: async () => false,
  consentFor: async () => [
    { basis: 'implied_conspicuous_publication', capturedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: null },
  ],
  ...over,
});

const goodMessage = {
  identifiesSender: true,
  hasMailingAddress: true,
  hasUnsubscribe: true,
  personalisationEvidenceIds: ['ev-1'],
};

describe('the collection gate', () => {
  it('blocks a manual entry connector and says why', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'collection',
      jurisdiction: 'CA',
      now: NOW,
      connector: linkedInRecruiterSeat,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.rule === 'connector.persistence')?.statement).toMatch(/only through a human/);
  });

  it('blocks a connector that is not licensed for the jurisdiction', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'collection',
      jurisdiction: 'JP',
      now: NOW,
      connector: createPublicEvidenceDirectory(),
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.rule === 'connector.jurisdiction')?.allowed).toBe(false);
  });

  it('permits a licensed persisting connector', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'collection',
      jurisdiction: 'CA',
      now: NOW,
      connector: createPublicEvidenceDirectory(),
    });
    expect(d.allowed).toBe(true);
  });
});

describe('the enrichment gate', () => {
  it('refuses a sensitive attribute written to the ordinary namespace', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'enrichment',
      jurisdiction: 'CA',
      now: NOW,
      attributeIsSensitive: true,
      writingToSensitiveTable: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons[0]?.statement).toMatch(/never selection/);
  });

  it('flags that an indirect collection notice is owed in Europe', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'enrichment',
      jurisdiction: 'DE',
      now: NOW,
      collectionMethod: 'provider_licensed',
    });
    expect(d.allowed).toBe(true);
    expect(d.reasons.find((r) => r.rule === 'notice.indirect_collection')?.statement).toMatch(/notice is owed/);
  });

  it('does not claim a notice is owed in Canada', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      gate: 'enrichment',
      jurisdiction: 'CA',
      now: NOW,
      collectionMethod: 'provider_licensed',
    });
    expect(d.reasons.find((r) => r.rule === 'notice.indirect_collection')?.statement).toMatch(/No indirect/);
  });
});

describe('the send gate', () => {
  const base = {
    gate: 'send' as const,
    jurisdiction: 'CA',
    now: NOW,
    personId: 'p1',
    subjectHash: 'hash-1',
    channel: 'email' as const,
  };

  it('permits a compliant, personalised message', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({ ...base, message: goodMessage });
    expect(d.allowed).toBe(true);
  });

  it('blocks a message with no verified person specific hook', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      ...base,
      message: { ...goodMessage, personalisationEvidenceIds: [] },
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.rule === 'send.personalisation_gate')?.statement).toMatch(
      /no better than\s+none/,
    );
  });

  it('blocks a send to a suppressed person on every channel', async () => {
    const engine = new PolicyEngine(lookups({ isSuppressed: async () => true }));
    for (const channel of ['email', 'phone', 'linkedin_inmail'] as const) {
      const d = await engine.evaluate({ ...base, channel, message: goodMessage });
      expect(d.allowed, `channel ${channel}`).toBe(false);
    }
  });

  it('blocks a Canadian email with no live consent basis on record', async () => {
    const d = await new PolicyEngine(lookups({ consentFor: async () => [] })).evaluate({
      ...base,
      message: goodMessage,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.rule === 'send.consent_basis')?.statement).toMatch(/burden of proving/);
  });

  it('treats an expired implied consent basis as absent', async () => {
    const d = await new PolicyEngine(
      lookups({
        consentFor: async () => [
          { basis: 'implied_inquiry', capturedAt: new Date('2025-01-01'), expiresAt: new Date('2025-07-01') },
        ],
      }),
    ).evaluate({ ...base, message: goodMessage });
    expect(d.allowed).toBe(false);
  });

  it('blocks a message missing any required element', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      ...base,
      message: { ...goodMessage, hasUnsubscribe: false, hasMailingAddress: false },
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.find((r) => r.rule === 'send.required_elements')?.statement).toMatch(/mailing address/);
  });

  it('blocks cold outreach on a community surface', async () => {
    const d = await new PolicyEngine(lookups()).evaluate({
      ...base,
      channel: 'community',
      message: goodMessage,
    });
    expect(d.allowed).toBe(false);
  });

  it('returns every failing reason at once rather than the first', async () => {
    const d = await new PolicyEngine(lookups({ isSuppressed: async () => true, consentFor: async () => [] })).evaluate({
      ...base,
      message: { ...goodMessage, hasUnsubscribe: false, personalisationEvidenceIds: [] },
    });
    expect(d.reasons.filter((r) => !r.allowed).length).toBeGreaterThanOrEqual(4);
  });

  it('enforce() throws with every reason attached', async () => {
    const engine = new PolicyEngine(lookups({ isSuppressed: async () => true }));
    await expect(engine.enforce({ ...base, message: goodMessage })).rejects.toThrow(PolicyViolation);
  });
});
