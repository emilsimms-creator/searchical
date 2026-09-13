import type { MandateConstraint, PipelineProjection } from './types';

/**
 * Defaults from the practice's source research. A twenty percent combined
 * response rate and a fifty percent interested share, which means ten real
 * conversations requires roughly one hundred people contacted.
 *
 * These are published industry figures and are replaced per segment and per
 * channel by the practice's own observed rates as history accumulates, with the
 * sample size shown alongside so the recruiter knows whether to trust the
 * number. See architecture.md s5.5.
 */
export const PIPELINE_DEFAULTS = {
  responseRate: 0.2,
  interestedShare: 0.5,
  touchesPerPerson: 5,
  targetConversations: 10,
  longListSize: 75,
  ratesSource:
    'Published defaults: SocialTalent 15 to 25 percent combined response (Apr 2026); ' +
    'Gem, about half of replies are polite declines (Fall 2024)',
} as const;

export interface PipelineInput {
  targetConversations: number;
  longListSize: number;
  responseRate?: number;
  interestedShare?: number;
  touchesPerPerson?: number;
  ratesSource?: string;
  ratesSampleSize?: number | null;
  /** Constraints on the mandate. Disqualifying ones shrink the market. */
  constraints?: readonly MandateConstraint[];
}

/** Widening moves from the Channel Guide, offered rather than merely warned about. */
const WIDENING_MOVES: readonly string[] = [
  'Add adjacent sectors where the same capability exists, not only direct competitors.',
  'Add academy companies that train this capability and late stage or recently public firms.',
  'Mine conference and meetup speaker programmes, foundation contributor lists and vendor ambassador directories.',
  'Work well connected people as sources first: ask who they rate and who is at a trigger point.',
  'Re-engage past placements, former contractors and silver medalists before going further cold.',
];

/**
 * Deterministic, transparent, and shown as a working rather than a number.
 *
 *   contacts_required = ceil(target_conversations / (response_rate x interested_share))
 *
 * The most common silent failure in a search is a long list smaller than the
 * number of people who must be contacted, so that gap is surfaced with the
 * moves that close it. See architecture.md s5.5.
 */
export function projectPipeline(input: PipelineInput): PipelineProjection {
  const responseRate = input.responseRate ?? PIPELINE_DEFAULTS.responseRate;
  const interestedShare = input.interestedShare ?? PIPELINE_DEFAULTS.interestedShare;
  const touchesPerPerson = input.touchesPerPerson ?? PIPELINE_DEFAULTS.touchesPerPerson;

  if (input.targetConversations <= 0) {
    throw new RangeError('targetConversations must be greater than zero');
  }
  if (responseRate <= 0 || responseRate > 1) {
    throw new RangeError(`responseRate must be between 0 and 1, received ${responseRate}`);
  }
  if (interestedShare <= 0 || interestedShare > 1) {
    throw new RangeError(`interestedShare must be between 0 and 1, received ${interestedShare}`);
  }
  // Engagement flattens after stage five and over sequencing damages the brand.
  if (touchesPerPerson < 1 || touchesPerPerson > 6) {
    throw new RangeError(
      `touchesPerPerson must be between 1 and 6: engagement flattens after stage five and ` +
        `over sequencing to seven or eight backfires. Received ${touchesPerPerson}.`,
    );
  }

  const disqualifying = (input.constraints ?? []).filter((c) => c.severity === 'disqualifying');
  const contactsRequired = Math.ceil(input.targetConversations / (responseRate * interestedShare));
  const touchesRequired = contactsRequired * touchesPerPerson;
  const longListSufficient = input.longListSize >= contactsRequired;
  const shortfall = Math.max(0, contactsRequired - input.longListSize);

  const pct = (n: number) => `${Math.round(n * 100)} percent`;

  return {
    targetConversations: input.targetConversations,
    longListSize: input.longListSize,
    responseRate,
    interestedShare,
    touchesPerPerson,
    contactsRequired,
    touchesRequired,
    longListSufficient,
    shortfall,
    ratesSource: input.ratesSource ?? PIPELINE_DEFAULTS.ratesSource,
    ratesSampleSize: input.ratesSampleSize ?? null,
    constrainedMarket: disqualifying.length > 0,
    workings:
      `${input.targetConversations} interested conversations divided by a ${pct(responseRate)} response rate ` +
      `and a ${pct(interestedShare)} interested share means ${contactsRequired} people contacted, ` +
      `and ${touchesRequired} touches at ${touchesPerPerson} per person.`,
    advice: [
      ...(longListSufficient
        ? []
        : [
            `The long list of ${input.longListSize} is ${shortfall} short of the ${contactsRequired} people ` +
              `who must be contacted. Widen the talent map before starting outreach.`,
            ...WIDENING_MOVES,
          ]),
      ...(disqualifying.length > 0
        ? [
            // Deliberately no multiplier. Inventing one would be fake precision:
            // there is no published figure for how much a clearance requirement
            // or a commuting radius shrinks a senior technology market. What the
            // system can honestly say is that the defaults do not apply.
            `${disqualifying.length} disqualifying constraint${disqualifying.length === 1 ? '' : 's'} ` +
              `narrow${disqualifying.length === 1 ? 's' : ''} this market: ` +
              `${disqualifying.map((c) => c.statement).join('; ')}.`,
            'The default response and interested rates were measured on unconstrained senior searches, so ' +
              'they overstate this one. Expect a lower response, size the long list well above the ' +
              'calculated figure, and replace the rates with your own once this search has run.',
            'Qualify every prospect against these constraints before spending a sequence on them: five ' +
              'touches at someone who cannot take the job is the capacity this system exists to protect.',
          ]
        : []),
    ],
  };
}
