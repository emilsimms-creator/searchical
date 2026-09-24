import { SIGNAL_TYPE_SEED } from '@/receptivity/signal-types';
import { EntitlementError, entitlementFor, type LicensedAgreement } from './agreement';

/**
 * The slot for LinkedIn's Signals tool.
 *
 * WHAT IS KNOWN. The operator reports that LinkedIn has released a Signals tool
 * exposed over the Model Context Protocol, and that CDW is its first partner.
 * Neither could be confirmed from public sources when this was written, which
 * is consistent with an early partner programme under NDA and is not evidence
 * either way.
 *
 * WHAT IS NOT KNOWN, and is deliberately not guessed:
 *   - the server's endpoint, its tools and their argument shapes
 *   - the signal vocabulary it returns
 *   - the terms: what may be kept, for what purpose, by whom
 *   - whose agreement Searchical would run on
 *
 * So this is a slot, not an integration. It is vendor neutral at the seam (a
 * transport that calls a named tool), it refuses to open without a recorded
 * agreement that names the operating entity, and its mapping from LinkedIn's
 * signal codes to this system's is EMPTY: an unmapped code is reported, never
 * translated by guesswork. When the spec arrives, the work is filling the map
 * and writing the transport, and everything around them is already tested.
 *
 * WHY THIS IS NOT THE LINKEDIN RULE. LinkedIn public profiles are typed
 * `manual_entry_only` and are never fetched, because nothing LinkedIn published
 * permits automated access to them. A tool LinkedIn built and licenses is the
 * opposite case: sanctioned access under contract. It is governed by that
 * contract, not by the scraping prohibition, and the entitlement check above is
 * what makes that distinction enforceable rather than asserted.
 */

export const LINKEDIN_SIGNALS = {
  id: 'linkedin_signals',
  displayName: 'LinkedIn Signals (partner MCP)',
  counterparty: 'LinkedIn',
  transport: 'mcp',
  purpose: 'recruitment',
  status: 'awaiting_spec_and_agreement' as const,
} as const;

/** One signal as the provider reports it, before any translation. */
export interface ProviderSignal {
  readonly providerCode: string;
  readonly subject: { readonly kind: 'person' | 'organization'; readonly providerRef: string };
  readonly observedAt: Date;
  readonly citation?: string;
}

/**
 * The seam. An MCP client, an HTTP API, a fixture: anything that can call a
 * named tool and return its result. Kept this narrow so the transport can be
 * written against the real spec without touching anything else.
 */
export interface SignalsTransport {
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/**
 * LinkedIn's signal codes to this system's signal type codes.
 *
 * Empty on purpose. Several of the twenty three signals the practice's own
 * scorecard defines are LinkedIn native (recruiter only Open to Work, a burst
 * of profile updates, engaging with a competitor), and those are the likely
 * matches. Likely is not good enough for a table that decides which person is
 * called first, so nothing goes in here until the provider's vocabulary is
 * documented.
 */
export const SIGNAL_CODE_MAP: Readonly<Record<string, string>> = {};

export interface MappedSignals {
  readonly mapped: readonly (ProviderSignal & { readonly signalTypeCode: string })[];
  /** Codes with no mapping, reported so the gap is visible rather than absorbed. */
  readonly unmapped: readonly string[];
}

export function mapProviderSignals(
  signals: readonly ProviderSignal[],
  map: Readonly<Record<string, string>> = SIGNAL_CODE_MAP,
): MappedSignals {
  const known = new Set(SIGNAL_TYPE_SEED.map((s) => s.code));
  for (const [from, to] of Object.entries(map)) {
    if (!known.has(to)) {
      throw new Error(
        `The signal map sends "${from}" to "${to}", which is not a signal type this system defines. ` +
        'A mapping to a code that does not exist would drop the signal silently.',
      );
    }
  }
  const mapped: (ProviderSignal & { signalTypeCode: string })[] = [];
  const unmapped = new Set<string>();
  for (const s of signals) {
    const code = map[s.providerCode];
    if (code) mapped.push({ ...s, signalTypeCode: code });
    else unmapped.add(s.providerCode);
  }
  return { mapped, unmapped: [...unmapped].sort() };
}

export interface OpenedSignals {
  readonly transport: SignalsTransport;
  /** Whether the agreement allows keeping what comes back. */
  readonly mayPersist: boolean;
}

/**
 * Open the source, or refuse with every reason at once.
 *
 * Refuses without a recorded agreement naming the operating entity, and refuses
 * without a transport, which is to say without the spec. Both refusals are the
 * current state and are expected.
 */
export function openLinkedInSignals(args: {
  agreement: LicensedAgreement | null;
  operatingEntity: string;
  transport: SignalsTransport | null;
  now?: Date;
}): OpenedSignals {
  const entitlement = entitlementFor({
    agreement: args.agreement,
    operatingEntity: args.operatingEntity,
    purpose: LINKEDIN_SIGNALS.purpose,
    now: args.now ?? new Date(),
  });
  const reasons = [...entitlement.reasons];
  if (!args.transport) {
    reasons.push(
      'No transport is configured, because the server\'s endpoint and tools are not yet documented ' +
      'here. It is written against the spec, not ahead of it.',
    );
  }
  if (reasons.length > 0) throw new EntitlementError(LINKEDIN_SIGNALS.displayName, reasons);
  return { transport: args.transport!, mayPersist: entitlement.mayPersist };
}
