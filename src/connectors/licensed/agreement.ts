/**
 * Whether this system is entitled to use a licensed source at all.
 *
 * A partner agreement is tied to the entity named in it. Access that one
 * company holds under contract is not access another entity may use, however
 * closely the two are connected, and the person who pays for getting that wrong
 * is usually the individual who connected the two.
 *
 * So entitlement is data with a date and a reference, checked in code, and the
 * default is no. Nothing that needs an agreement can run until one is recorded
 * that names the entity actually operating this system, has not expired, and
 * permits the purpose it is being used for.
 */

export interface LicensedAgreement {
  /** The party granting access, for example "LinkedIn". */
  readonly counterparty: string;
  /** The legal entity the agreement names. Not a brand, not a parent company. */
  readonly licensee: string;
  /** The contract reference, so a lawyer can find the document. */
  readonly reference: string;
  readonly executedOn: string;
  readonly expiresOn: string | null;
  /** Whether the agreement allows keeping what it returns, as opposed to viewing it. */
  readonly permitsPersistence: boolean;
  /** What the licensee may use it for, as the agreement words it. */
  readonly permittedPurposes: readonly string[];
  readonly recordedBy: string;
}

export interface Entitlement {
  readonly entitled: boolean;
  /** Every reason it is refused, all at once, same as the policy engine. */
  readonly reasons: readonly string[];
  readonly mayPersist: boolean;
}

export function entitlementFor(args: {
  agreement: LicensedAgreement | null;
  /** The legal entity operating this system for this tenant. */
  operatingEntity: string;
  purpose: string;
  now: Date;
}): Entitlement {
  const { agreement, operatingEntity, purpose, now } = args;
  if (!agreement) {
    return {
      entitled: false, mayPersist: false,
      reasons: [
        'No agreement is recorded. Record the executed agreement, naming its licensee, before this ' +
        'source can be used. Access someone else holds does not become ours by being reachable.',
      ],
    };
  }

  const reasons: string[] = [];
  if (normalise(agreement.licensee) !== normalise(operatingEntity)) {
    reasons.push(
      `The agreement names ${agreement.licensee} as licensee, and this system is operated by ` +
      `${operatingEntity}. Partner access is tied to the named licensee: using it for a different ` +
      'entity needs that entity\'s own agreement, or written consent from the counterparty.',
    );
  }
  if (agreement.expiresOn !== null && new Date(agreement.expiresOn).getTime() < now.getTime()) {
    reasons.push(`The agreement expired on ${agreement.expiresOn}.`);
  }
  if (new Date(agreement.executedOn).getTime() > now.getTime()) {
    reasons.push(`The agreement is not yet in force: it is dated ${agreement.executedOn}.`);
  }
  if (!agreement.permittedPurposes.map(normalise).includes(normalise(purpose))) {
    reasons.push(
      `The agreement permits ${agreement.permittedPurposes.join(', ') || 'no stated purpose'}, ` +
      `not ${purpose}. A sales intelligence licence is not automatically a recruiting licence.`,
    );
  }

  return {
    entitled: reasons.length === 0,
    mayPersist: reasons.length === 0 && agreement.permitsPersistence,
    reasons,
  };
}

const normalise = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export class EntitlementError extends Error {
  readonly reasons: readonly string[];
  constructor(source: string, reasons: readonly string[]) {
    super(`${source} is not available: ${reasons.join(' ')}`);
    this.name = 'EntitlementError';
    this.reasons = reasons;
  }
}
