import { mentionsMoney } from '@/compensation/money';
import { requiredNamespace } from './sensitivity';
import type { PolicyRule } from './types';

const allow = (rule: string, statement: string, basis: string) =>
  ({ rule, allowed: true, statement, basis }) as const;
const deny = (rule: string, statement: string, basis: string) =>
  ({ rule, allowed: false, statement, basis }) as const;

/** Jurisdictions where a person whose data was collected indirectly is owed a notice. */
const NOTICE_OWED = new Set(['EU', 'GB', 'DE', 'FR', 'NL', 'IE', 'ES', 'IT', 'SE', 'PL']);

/** Surfaces whose own rules prohibit unsolicited recruiting outreach. */
const NO_COLD_OUTREACH: ReadonlySet<string> = new Set(['community']);

/** Every identifier hash the caller holds for this person, single or plural. */
const hashesOf = (c: { subjectHash?: string; subjectHashes?: readonly string[] }): readonly string[] =>
  [...(c.subjectHash === undefined ? [] : [c.subjectHash]), ...(c.subjectHashes ?? [])];

export const collectionRules: readonly PolicyRule[] = [
  {
    /**
     * Does not apply to `recruiter_entered` collection, and the rule's own
     * statement says why: the output of a manual entry surface reaches the
     * ledger "only through a human", and that path is a named human typing what
     * they read on their own licensed seat. Firing here would refuse the one
     * route the rule exists to leave open.
     *
     * Found by wiring the gate into the ledger: the rule blocked
     * `recordManualEntry`, which is the documented exception to it.
     */
    id: 'connector.persistence',
    gate: 'collection',
    appliesTo: (c) => c.connector !== undefined && c.collectionMethod !== 'recruiter_entered',
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
    /**
     * The key decides, not the caller.
     *
     * This rule used to read a boolean the caller supplied, which meant a caller
     * passing `sensitive: false` for a date of birth defeated it entirely and
     * nothing noticed. `classify` now holds the system's opinion: a caller may
     * escalate an attribute the list does not recognise, and may never
     * de-escalate one it does.
     */
    id: 'sensitive.quarantine',
    gate: 'enrichment',
    appliesTo: (c) => c.attributeKey !== undefined || c.attributeIsSensitive !== undefined,
    evaluate: (c) => {
      const verdict = c.attributeKey === undefined
        ? { sensitive: c.attributeIsSensitive === true, ground: null, callerUnderstated: false }
        : requiredNamespace(c.attributeKey, c.attributeIsSensitive === true);

      if (verdict.callerUnderstated) {
        return deny(
          'sensitive.quarantine',
          `"${c.attributeKey}" is a ${verdict.ground} attribute and was submitted as ordinary. ` +
            'Sensitivity is decided by the key, not by the caller: these may inform timing and ' +
            'prioritisation only, never selection, and that holds whatever the caller believes.',
          'Canadian Human Rights Act prohibited grounds; architecture.md s6.2',
        );
      }
      if (verdict.sensitive && c.writingToSensitiveTable !== true) {
        return deny(
          'sensitive.quarantine',
          'A protected or sensitive attribute may not be written to the ordinary attribute table. ' +
            'These may inform timing and prioritisation only, never selection.',
          'architecture.md s6.2',
        );
      }
      return allow(
        'sensitive.quarantine',
        verdict.sensitive
          ? `Quarantined as a ${verdict.ground ?? 'caller declared sensitive'} attribute.`
          : 'Attribute is stored in the correct namespace.',
        'architecture.md s6.2',
      );
    },
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
    /**
     * Checked against every identifier held for this person, not one.
     *
     * Someone who asks to be forgotten by replying to an email must not then
     * receive an InMail because the suppression was keyed to the address.
     */
    id: 'send.suppression',
    gate: 'send',
    appliesTo: (c) => hashesOf(c).length > 0,
    evaluate: async (c, l) => {
      const hits = await Promise.all(hashesOf(c).map((h) => l.isSuppressed(h)));
      return hits.some(Boolean)
        ? deny(
            'send.suppression',
            'This person has asked to be forgotten. No contact, on any channel, in any mandate.',
            'AESC Candidate Bill of Rights; architecture.md s8',
          )
        : allow('send.suppression', 'No suppression record on any known identifier.', 'architecture.md s8');
    },
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
    /**
     * Who is writing. This is a drafting concern, so it binds from the first
     * draft: a message that never says who sent it is not a message a senior
     * person answers, quite apart from the statute.
     */
    id: 'send.identifies_sender',
    gate: 'send',
    appliesTo: (c) => c.message !== undefined,
    evaluate: (c) =>
      c.message!.identifiesSender
        ? allow('send.identifies_sender', 'The message identifies its sender.', "Canada's anti spam legislation")
        : deny(
            'send.identifies_sender',
            'The message does not identify its sender. That is a structural element, not template text.',
            "Canada's anti spam legislation",
          ),
  },
  {
    /**
     * The mailing address and the unsubscribe are added by the sending layer,
     * so they bind at send and not at draft. Running them on a draft would
     * block every draft forever and teach a recruiter to ignore the gate, which
     * is how a real control becomes decoration.
     *
     * The rule is not softened, only correctly placed. Phase 3b cannot send
     * without satisfying it.
     */
    id: 'send.required_elements',
    gate: 'send',
    appliesTo: (c) => c.message?.stage === 'send' && c.channel === 'email',
    evaluate: (c) => {
      const m = c.message!;
      const missing = [
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
     * Outreach does not carry a number. Ever.
     *
     * Pay is raised once the conversation has earned it, which is the practice's
     * own rule and is why the call record refuses a short call claiming
     * compensation was discussed. Before contact there is no version of this
     * that helps: a figure in a first touch either screens people out on the one
     * dimension the research says is hygiene rather than motivation, or commits
     * the client to something nobody has agreed, and it cannot be withdrawn once
     * a senior candidate has read it.
     *
     * This was written as a conditional, allowing a figure where the band was
     * confirmed. That was wrong. A confirmed band makes a number safe to say on
     * a call, not safe to put in a cold message, and the two are different
     * questions. The gate now refuses unconditionally, which removes both the
     * condition and the context field that fed it.
     *
     * Deliberately over-detects. A false positive costs one look at a draft.
     */
    id: 'send.no_compensation_in_outreach',
    gate: 'send',
    appliesTo: (c) => c.message?.body !== undefined && mentionsMoney(c.message.body),
    evaluate: () =>
      deny(
        'send.no_compensation_in_outreach',
        'This message refers to compensation. Outreach does not carry a figure, a range or a ' +
          'reference to pay: that conversation happens once contact is made and the person has a ' +
          'reason to have it. Take the number out and send the rest.',
        "The practice Playbook s4.5: pay is raised past the mid point of the call, never before it",
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
