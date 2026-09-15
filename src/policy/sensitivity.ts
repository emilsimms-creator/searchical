/**
 * Which attribute keys are sensitive, decided by the system rather than by the
 * caller.
 *
 * The enrichment gate refuses a sensitive attribute written to the ordinary
 * attribute table. That rule was previously unenforceable in practice, because
 * sensitivity arrived as a boolean the caller supplied: a caller who passed
 * `sensitive: false` for a date of birth defeated the control completely, and
 * nothing anywhere noticed. The caller is the least reliable judge of this,
 * not out of bad faith but because the classification is a legal question and
 * the caller is writing an import loop.
 *
 * So the key decides. `classify` is the only opinion the system takes, the
 * caller's flag can escalate but never de-escalate, and a caller that tries to
 * de-escalate is refused rather than silently corrected.
 *
 * The architecture is explicit about why this matters: these grounds correlate
 * with receptivity in the survey data and the source research permits them for
 * timing and prioritisation but never as selection criteria. Quarantine is the
 * structural version of that rule, and a structural control is the only version
 * that survives contact with a deadline.
 *
 * Canadian grounding: the prohibited grounds of discrimination under the
 * Canadian Human Rights Act, plus the categories Quebec's Law 25 and PIPEDA
 * treat as requiring heightened care. Jamaica's Data Protection Act, 2020 draws
 * a comparable line around "sensitive personal data", which matters if this
 * practice ever recruits into the Caribbean: the vocabulary differs, the
 * handling obligation does not.
 */

/**
 * Matched against the normalised key: lower case, with separators removed, so
 * `date_of_birth`, `dateOfBirth` and `Date Of Birth` are one key.
 */
const SENSITIVE_PATTERNS: readonly { readonly pattern: RegExp; readonly ground: string }[] = [
  { pattern: /(dateofbirth|dob|birthdate|birthyear|\bage\b|agerange|generation|graduationyear)/, ground: 'age' },
  { pattern: /(gender|sex\b|pronoun|transgender)/, ground: 'sex or gender identity' },
  { pattern: /(race|ethnic|ancestry|colour|color|indigenous|firstnations|metis|inuit)/, ground: 'race, ethnicity or Indigenous identity' },
  { pattern: /(religio|faith|creed|church|observance)/, ground: 'religion or creed' },
  { pattern: /(disabilit|accommodation|medical|health|diagnosis|mentalhealth)/, ground: 'disability or health' },
  { pattern: /(maritalstatus|familystatus|spouse|children|dependants|dependents|pregnan|parentalleave)/, ground: 'marital or family status' },
  { pattern: /(sexualorientation|lgbt)/, ground: 'sexual orientation' },
  { pattern: /(politic|union(membership|affiliation)?\b)/, ground: 'political or union affiliation' },
  { pattern: /(criminal|conviction|pardon|record(suspension)?\b)/, ground: 'criminal record' },
  { pattern: /(citizenship|immigration|visastatus|permanentresident|nationality|refugee)/, ground: 'citizenship or immigration status' },
  { pattern: /(biometric|genetic|fingerprint|facialrecognition)/, ground: 'biometric or genetic data' },
  { pattern: /(sin\b|socialinsurance|socialsecurity|passportnumber|healthcard|driverslicen[cs]e)/, ground: 'government identifier' },
  { pattern: /(salaryhistory|previoussalary|currentsalary|payhistory)/, ground: 'pay history' },
];

const normalise = (key: string): string => key.toLowerCase().replace(/[\s_\-.]/g, '');

export interface SensitivityVerdict {
  readonly sensitive: boolean;
  /** Which protected ground it falls under. Null when not sensitive. */
  readonly ground: string | null;
}

/** The system's opinion on one attribute key. */
export function classify(key: string): SensitivityVerdict {
  const k = normalise(key);
  for (const { pattern, ground } of SENSITIVE_PATTERNS) {
    if (pattern.test(k)) return { sensitive: true, ground };
  }
  return { sensitive: false, ground: null };
}

/**
 * Where an attribute must be written, combining the system's classification
 * with the caller's own flag.
 *
 * A caller may declare something sensitive that the list does not recognise,
 * and that declaration is honoured: the list is a floor, not a ceiling, and a
 * recruiter who knows a free text note contains a health disclosure is right
 * even when the key is `call_notes`.
 *
 * A caller may not declare something NOT sensitive that the list recognises.
 * That combination is the one the gate exists to refuse.
 */
export function requiredNamespace(key: string, callerSaysSensitive: boolean): {
  readonly sensitive: boolean;
  readonly ground: string | null;
  readonly callerUnderstated: boolean;
} {
  const verdict = classify(key);
  return {
    sensitive: verdict.sensitive || callerSaysSensitive,
    ground: verdict.ground,
    callerUnderstated: verdict.sensitive && !callerSaysSensitive,
  };
}
