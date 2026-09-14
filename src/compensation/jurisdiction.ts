/**
 * Canadian pay transparency rules, as they bear on reading a job specification.
 *
 * This module exists to stop the system drawing a wrong inference that looks
 * obviously right. The tempting feature is: "an Ontario posting with no salary
 * range is non-compliant, flag it." That feature would be wrong most of the
 * time for THIS practice, because Ontario's requirement does not apply where
 * expected compensation is above $200,000 a year, and most senior technology
 * executive mandates are. The absence of a band in an Ontario posting for a VP
 * of Engineering usually tells you nothing at all.
 *
 * So what is encoded here is the rule and its exemptions, and what is produced
 * is a question for the hiring leader rather than a compliance verdict.
 *
 * Sources, all checked rather than recalled:
 *  - Ontario: Employment Standards Act, 2000, publicly advertised job posting
 *    requirements in force 1 January 2026, with O. Reg. 476/24 setting the
 *    $50,000 maximum range width and the $200,000 exemption.
 *  - British Columbia: Pay Transparency Act, SBC 2023 c 18.
 *  - Prince Edward Island: Employment Standards Act pay transparency
 *    amendments, in force 2022.
 *  - Newfoundland and Labrador: Pay Equity and Pay Transparency Act, 2022.
 *    Passed, but the posting provisions are not yet in force.
 *
 * None of this is legal advice and none of it is a substitute for counsel. It
 * is a prompt to ask, which is the only thing an intake step should ever be.
 */

export interface PayTransparencyRule {
  readonly jurisdiction: string;
  /** Must a publicly advertised posting carry the expected pay or a range? */
  readonly postingMustCarryPay: boolean;
  readonly inForce: boolean;
  /** Above this annual figure in cents the posting requirement does not apply. */
  readonly exemptAboveAnnualCents: bigint | null;
  /** The widest range a posting may advertise, in cents, where capped. */
  readonly maximumRangeWidthCents: bigint | null;
  /** Smallest employer the posting rule reaches, by headcount. */
  readonly employerHeadcountFloor: number | null;
  /** Is asking an applicant about pay history restricted? */
  readonly payHistoryRestricted: boolean;
  readonly note: string;
  readonly citation: string;
}

const M = (dollars: number) => BigInt(dollars) * 100n;

export const PAY_TRANSPARENCY_RULES: readonly PayTransparencyRule[] = [
  {
    jurisdiction: 'ON',
    postingMustCarryPay: true,
    inForce: true,
    exemptAboveAnnualCents: M(200_000),
    maximumRangeWidthCents: M(50_000),
    employerHeadcountFloor: 25,
    payHistoryRestricted: false,
    note:
      'In force 1 January 2026. A publicly advertised posting must state the expected compensation ' +
      'or a range. The range may not exceed the equivalent of $50,000 a year, and the requirement ' +
      'does not apply where the expected compensation, or the top of the range, exceeds the ' +
      'equivalent of $200,000 a year, nor to employers with fewer than 25 employees. Most senior ' +
      'executive mandates sit above the exemption, so a missing band is usually lawful and is ' +
      'never by itself evidence of anything.',
    citation: 'https://www.canlii.org/en/on/laws/regu/o-reg-476-24/latest/o-reg-476-24.html',
  },
  {
    jurisdiction: 'BC',
    postingMustCarryPay: true,
    inForce: true,
    exemptAboveAnnualCents: null,
    maximumRangeWidthCents: null,
    employerHeadcountFloor: null,
    payHistoryRestricted: true,
    note:
      'Publicly advertised postings must state the expected pay or pay range, with no upper ' +
      'exemption and no cap on range width. Employers may not ask an applicant what previous ' +
      'employers paid them, though they may use pay history they already hold for an existing ' +
      'employee.',
    citation: 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/23018',
  },
  {
    jurisdiction: 'PE',
    postingMustCarryPay: true,
    inForce: true,
    exemptAboveAnnualCents: null,
    maximumRangeWidthCents: null,
    employerHeadcountFloor: null,
    payHistoryRestricted: true,
    note:
      'In force since 2022, with no employer size threshold. Asking an applicant about pay history ' +
      'is prohibited, as is preventing employees from discussing their own pay.',
    citation: 'https://www.princeedwardisland.ca/en/legislation/employment-standards-act',
  },
  {
    jurisdiction: 'NL',
    postingMustCarryPay: false,
    inForce: false,
    exemptAboveAnnualCents: null,
    maximumRangeWidthCents: null,
    employerHeadcountFloor: null,
    payHistoryRestricted: true,
    note:
      'The Pay Equity and Pay Transparency Act passed in 2022, but its posting provisions are not ' +
      'yet in force. The pay history restriction is active.',
    citation: 'https://www.assembly.nl.ca/legislation/sr/statutes/p02-1.htm',
  },
];

/**
 * Match a free text location to a rule. Deliberately conservative: an
 * unrecognised place returns null rather than a nearest guess, because the
 * output of this function becomes a sentence a recruiter says to a client.
 */
export function ruleForLocation(location: string | null): PayTransparencyRule | null {
  if (!location) return null;
  const text = location.toLowerCase();
  const match = (...needles: string[]) => needles.some((n) => text.includes(n));
  if (match('ontario', 'toronto', 'ottawa', 'mississauga', 'waterloo', 'hamilton', 'london, on')) {
    return PAY_TRANSPARENCY_RULES.find((r) => r.jurisdiction === 'ON') ?? null;
  }
  if (match('british columbia', 'vancouver', 'victoria', 'burnaby', 'kelowna', 'surrey')) {
    return PAY_TRANSPARENCY_RULES.find((r) => r.jurisdiction === 'BC') ?? null;
  }
  if (match('prince edward island', 'charlottetown')) {
    return PAY_TRANSPARENCY_RULES.find((r) => r.jurisdiction === 'PE') ?? null;
  }
  if (match('newfoundland', "st. john's", 'st johns')) {
    return PAY_TRANSPARENCY_RULES.find((r) => r.jurisdiction === 'NL') ?? null;
  }
  return null;
}

/**
 * What to say to the hiring leader about a missing band, given where the role
 * sits. Never a verdict, always a question, and the question is sharper where
 * the jurisdiction has something to say.
 */
export function missingBandQuestion(location: string | null): string {
  const base =
    'The specification names no compensation band. What is the base range, the bonus target and ' +
    'the pension or long term incentive, and how much of it is genuinely movable for an ' +
    'exceptional candidate? This is the number a search dies on at offer, and it is knowable now.';
  const rule = ruleForLocation(location);
  if (!rule || !rule.postingMustCarryPay || !rule.inForce) return base;
  if (rule.exemptAboveAnnualCents !== null) {
    return `${base} Note for context, not as a finding: a publicly advertised posting in ` +
      `${rule.jurisdiction} must carry the expected pay unless it is above the equivalent of ` +
      `$200,000 a year, which a role at this level often is. Ask whether the client treated this ` +
      `posting as exempt, because their answer tells you roughly where the band sits before they ` +
      `name it.`;
  }
  return `${base} Note for context, not as a finding: a publicly advertised posting in ` +
    `${rule.jurisdiction} must state the expected pay or range, with no upper exemption, so a ` +
    `posting without one is worth asking about directly.`;
}

/**
 * Whether a pay history question is restricted where this person sits. Returns
 * true when the jurisdiction is unknown, because the safe default for a
 * question nobody needs to ask is not to ask it.
 */
export function payHistoryRestrictedAt(location: string | null): boolean {
  const rule = ruleForLocation(location);
  return rule ? rule.payHistoryRestricted : true;
}
