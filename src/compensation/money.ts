/**
 * Money, in cents, as integers.
 *
 * The practice quotes Canadian dollars, and CAD is the default everywhere. The
 * currency is still carried explicitly on every figure, because the system
 * identifies talent globally and a band that assumes its own units is a band
 * that will eventually be compared against the wrong one.
 *
 * There is no conversion here, and that is deliberate. Converting a USD
 * expectation into CAD requires a rate, a date and a source, and a number
 * converted at an unrecorded rate is a number nobody can defend in front of a
 * client. Figures in different currencies are reported as incomparable until
 * somebody supplies the rate.
 */

export const DEFAULT_CURRENCY = 'CAD';

/** ISO 4217 alphabetic code, upper case, exactly three letters. */
export type Currency = string;

export function normaliseCurrency(input: string | null | undefined): Currency {
  const code = (input ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(
      `"${input}" is not an ISO 4217 currency code. Use a three letter code such as CAD or USD.`,
    );
  }
  return code;
}

/**
 * Dollars to cents. Accepts a number of dollars or the strings a job
 * specification actually contains.
 *
 * Rejects rather than rounds anything below a cent: a band written to a
 * fraction of a cent is a parsing error somewhere upstream, not a real figure.
 */
export function toCents(dollars: number): bigint {
  if (!Number.isFinite(dollars)) throw new Error(`${dollars} is not a finite amount.`);
  if (dollars < 0) throw new Error('A compensation figure cannot be negative.');
  const cents = Math.round(dollars * 100);
  if (Math.abs(dollars * 100 - cents) > 1e-6) {
    throw new Error(`${dollars} is finer than a cent. Round it before recording it.`);
  }
  return BigInt(cents);
}

export const toDollars = (cents: bigint): number => Number(cents) / 100;

/**
 * Parse the money a specification writes: "$185,000", "185k", "CAD 185,000",
 * "$1,200/day". Returns null rather than guessing, because a band the system
 * misread is worse than a band it admits it could not find.
 */
export function parseAmount(text: string): { cents: bigint; currency: Currency | null } | null {
  const cleaned = text.trim().replace(/ /g, ' ');
  const match = cleaned.match(
    /(?:(CAD|USD|GBP|EUR|AUD|JMD)\s*)?\$?\s*([\d][\d,\s]*(?:\.\d{1,2})?)\s*(k|K)?(?:\s*(CAD|USD|GBP|EUR|AUD|JMD))?/,
  );
  if (!match) return null;
  const digits = match[2]!.replace(/[,\s]/g, '');
  if (digits === '') return null;
  const value = Number(digits) * (match[3] ? 1_000 : 1);
  if (!Number.isFinite(value) || value <= 0) return null;
  const code = match[1] ?? match[4] ?? null;
  return { cents: toCents(value), currency: code ? normaliseCurrency(code) : null };
}

/**
 * Does this text quote money at all? Used by the send gate, which must not let
 * a figure reach a candidate on the authority of an unconfirmed band.
 *
 * Tuned to over-detect. A false positive costs a recruiter one look at a draft;
 * a false negative puts an unapproved number in front of a senior candidate,
 * and it cannot be taken back.
 */
export function mentionsMoney(text: string): boolean {
  return (
    /\$\s*\d/.test(text) ||
    /\b\d[\d,.]*\s*(k|K)\b/.test(text) ||
    /\b\d[\d,]{2,}\b/.test(text) ||
    /\b(CAD|USD|GBP|EUR|AUD|JMD)\b/.test(text) ||
    /\b(salary|compensation|base pay|total comp|remuneration|package)\b/i.test(text)
  );
}

const CAD = new Intl.NumberFormat('en-CA', {
  style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
});

/** Formats for a human. Whole dollars: nobody quotes a band to the cent. */
export function formatAmount(cents: bigint, currency: Currency = DEFAULT_CURRENCY): string {
  const dollars = toDollars(cents);
  if (currency === 'CAD') return CAD.format(dollars);
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(dollars);
}

export function formatRange(
  min: bigint | null, max: bigint | null, currency: Currency = DEFAULT_CURRENCY,
): string {
  if (min === null && max === null) return 'no band';
  if (min !== null && max === null) return `${formatAmount(min, currency)} and up`;
  if (min === null && max !== null) return `up to ${formatAmount(max, currency)}`;
  if (min === max) return formatAmount(min!, currency);
  return `${formatAmount(min!, currency)} to ${formatAmount(max!, currency)}`;
}
