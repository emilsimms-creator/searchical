import { mentionsMoney } from '@/compensation/money';
import type { PolicyRule } from './types';

const allow = (rule: string, statement: string, basis: string) =>
  ({ rule, allowed: true, statement, basis }) as const;
const deny = (rule: string, statement: string, basis: string) =>
  ({ rule, allowed: false, statement, basis }) as const;

/** Jurisdictions where a person whose data was collected indirectly is owed a notice. */
const NOTICE_OWED = new Set(['EU', 'GB', 'DE', 'FR', 'NL', 'IE', 'ES', 'IT', 'SE', 'PL']);

/** Surfaces whose own rules prohibit unsolicited recruiting outreach. */
const NO_COLD_OUTREACH: ReadonlySet<string> = new Set(['community']);

export const collectionRules: readonly PolicyRule[] = [
  {
    id: 'connector.persistence',
    gate: 'collection',
    appliesTo: (c) => c.connector !== undefined,
    evaluate: (c) =>
      c.connector!.persistence === 'persist'
        ? allow('connector.persistence', `${c.connector!.id} may be persisted.`, c.connector!.termsRef)
        : deny(
            'connector.persistence',
            `${c.connector!.id} declares persistence "${c.connector!.persistence}". Its output reaches ` +
              `the ledger only through a human. See architecture.md s10.1.`,
            c.connector!.termsRef,
          ),
  },
  {
    id: 'connector.jurisdiction',
    gate: 'collection',
    appliesTo: (c) => c.connector !== undefined,
    evaluate: (c) => {
      const j = c.connector!.jurisdictions;
      const ok = j.includes('GLOBAL') || j.includes(c.jurisdiction);
      return ok
        ? allow('connector.jurisdiction', `${c.connector!.id} is licensed for ${c.jurisdiction}.`, c.connector!.termsRef)
        : deny(
            'connector.jurisdiction',
            `${c.connector!.id} is not licensed for ${c.jurisdiction}. Licensed for: ${j.join(', ')}.`,
            c.connector!.termsRef,
          );
    },
  },
];

export const enrichmentRules: readonly PolicyRule[] = [
  {
    id: 'sensitive.quarantine',
    gate: 'enrichment',
    appliesTo: (c) => c.attributeIsSensitive !== undefined,
    evaluate: (c) =>
      c.attributeIsSensitive && c.writingToSensitiveTable !== true
        ? deny(
            'sensitive.quarantine',
            'A protected or sensitive attribute may not be written to the ordinary attribute table. ' +
              'These may inform timing and prioritisation only, never selection.',
            'architecture.md s6.2',
          )
        : allow('sensitive.quarantine', 'Attribute is stored in the correct namespace.', 'architecture.md s6.2'),
  },
  {
    id: 'notice.indirect_collection',
    gate: 'enrichment',
    appliesTo: (c) => c.collectionMethod !== undefined,
    evaluate: (c) => {
      const indirect = c.collectionMethod !== 'candidate_provided';
      const owed = indirect && NOTICE_OWED.has(c.jurisdiction);
      // Not a block: an obligation the system must discharge, recorded here so
      // the notice is generated from the record rather than from a manual process.
      return allow(
        'notice.indirect_collection',
        owed
          ? `Indirect collection in ${c.jurisdiction}: a notice is owed to this person and has been queued.`
          : `No indirect collection notice owed in ${c.jurisdiction}.`,
        'architecture.md s9.2',
      );
    },
  },
];

export const sendRules: readonly PolicyRule[] = [
  {
    id: 'send.suppression',
    gate: 'send',
    appliesTo: (c) => c.subjectHash !== undefined,
    evaluate: async (c, l) =>
      (await l.isSuppressed(c.subjectHash!))
        ? deny(
            'send.suppression',
            'This person has asked to be forgotten. No contact, on any channel, in any mandate.',
            'AESC Candidate Bill of Rights; architecture.md s8',
          )
        : allow('send.suppression', 'No suppression record.', 'architecture.md s8'),
  },
  {
    id: 'send.consent_basis',
    gate: 'send',
    appliesTo: (c) => c.personId !== undefined && c.channel === 'email' && c.jurisdiction === 'CA',
    evaluate: async (c, l) => {
      const live = (await l.consentFor(c.personId!)).filter(
        (r) => r.expiresAt === null || r.expiresAt > c.now,
      );
      return live.length > 0
        ? allow(
            'send.consent_basis',
            `Live consent basis on record: ${live.map((r) => r.basis).join(', ')}.`,
            "Canada's anti spam legislation; architecture.md s9.1",
          )
        : deny(
            'send.consent_basis',
            'No live consent basis on record. Canadian anti spam law puts the burden of proving ' +
              'consent on the sender, so a send with no recorded basis is not permitted.',
            "Canada's anti spam legislation; architecture.md s9.1",
          );
    },
  },
  {
    id: 'send.required_elements',
    gate: 'send',
    appliesTo: (c) => c.message !== undefined && c.channel === 'email',
    evaluate: (c) => {
      const m = c.message!;
      const missing = [
        m.identifiesSender ? null : 'sender identification',
        m.hasMailingAddress ? null : 'a valid mailing address',
        m.hasUnsubscribe ? null : 'a working unsubscribe',
      ].filter((x): x is string => x !== null);
      return missing.length === 0
        ? allow('send.required_elements', 'Message carries every required element.', "Canada's anti spam legislation")
        : deny(
            'send.required_elements',
            `Message is missing ${missing.join(', ')}. These are structural elements, not template text.`,
            "Canada's anti spam legislation",
          );
    },
  },
  {
    id: 'send.personalisation_gate',
    gate: 'send',
    appliesTo: (c) => c.message !== undefined,
    evaluate: (c) =>
      c.message!.personalisationEvidenceIds.length > 0
        ? allow(
            'send.personalisation_gate',
            'Message carries at least one verified person specific hook.',
            'architecture.md s7.2',
          )
        : deny(
            'send.personalisation_gate',
            'No verified person specific hook. Somewhat personalised outreach performs no better than ' +
              'none, so this message is routed back to research rather than sent.',
            'Gem benchmark via the practice Playbook s4.5; architecture.md s7.2',
          ),
  },
  {
    /**
     * A figure in an outreach message is a commitment the client has to honour.
     *
     * The reply ladder tells a recruiter to answer a compensation question with
     * a range anchored to track record, and that range has exactly one lawful
     * source: a band the hiring leader has confirmed. A number that reached a
     * senior candidate on the authority of a job posting, a market estimate or
     * a recruiter's recollection cannot be withdrawn, and the person who
     * discovers the difference is the candidate, at offer.
     *
     * Deliberately over-detects. A false positive costs one look at a draft.
     */
    id: 'send.compensation_confirmed',
    gate: 'send',
    appliesTo: (c) => c.message?.body !== undefined && mentionsMoney(c.message.body),
    evaluate: (c) =>
      c.compensationBandConfirmed === true
        ? allow(
            'send.compensation_confirmed',
            'The message refers to compensation and the band is confirmed by the hiring leader.',
            'architecture.md s5.6',
          )
        : deny(
            'send.compensation_confirmed',
            c.compensationBandConfirmed === false
              ? 'This message refers to compensation and the mandate has no confirmed band. A figure ' +
                'quoted on an unconfirmed band cannot be withdrawn once a senior candidate has read it.'
              : 'This message refers to compensation and no band status was supplied, so the gate ' +
                'cannot establish there is a confirmed number behind it.',
            'BC Pay Transparency Act and Ontario ESA posting rules make the stated range consequential; architecture.md s5.6',
          ),
  },
  {
    id: 'send.channel_permitted',
    gate: 'send',
    appliesTo: (c) => c.channel !== undefined,
    evaluate: (c) =>
      NO_COLD_OUTREACH.has(c.channel!)
        ? deny(
            'send.channel_permitted',
            `Unsolicited outreach is prohibited on the ${c.channel} surface. Participate, sponsor or ` +
              'use the designated jobs channel instead.',
            'architecture.md s9.4',
          )
        : allow('send.channel_permitted', `${c.channel} is a permitted outreach channel.`, 'architecture.md s9.4'),
  },
];

export const allRules: readonly PolicyRule[] = [...collectionRules, ...enrichmentRules, ...sendRules];
