import { OutOfScopeError, SEGMENT_LABELS, type ChannelPriority, type ChannelRatingSeed, type ChannelSelection, type Segment, type SupportedSegment } from './types';

export const CHANNEL_THRESHOLDS = {
  primary: 4,
  secondary: 3,
  /** Most roles are covered well by three to five channels in combination. */
  minRecommended: 3,
  maxRecommended: 5,
} as const;

/**
 * Warm and network channels are weighted up when trimming to the recommended
 * set, because senior and passive targets convert through relationships. In the
 * practice's own data, referrals are the only channel rated 5 for both segments.
 */
const WARM_CATEGORIES = new Set(['Network', 'Executive network', 'Executive network (Canada)']);

export interface ChannelPlan {
  readonly selections: readonly ChannelSelection[];
  /** The three to five channels to actually work, in order. */
  readonly recommended: readonly ChannelSelection[];
  readonly primaryCount: number;
  readonly secondaryCount: number;
  readonly note: string;
  /**
   * True when the matrix holds no research for this segment and the ratings are
   * derived. The plan is still usable, and it says plainly that it is borrowed.
   */
  readonly provisional: boolean;
}

/**
 * How well a channel is rated for a segment.
 *
 * The workbook rates channels for two senior segments. It has nothing for
 * technical specialists, and inventing 29 ratings for a market nobody has
 * researched would be the confidently wrong plan this planner exists to avoid.
 * The rule instead is the most conservative one available: a channel is only as
 * good as the LOWER of its two researched ratings, so it is recommended only if
 * the research supports it for both senior segments. That keeps referrals,
 * email, LinkedIn Recruiter and conferences, and drops the developer
 * communities (GitHub, ambassador programmes, Stack Overflow) because the
 * executive research rates them 1. Replace it with real ratings, and then with
 * this practice's own outcomes, as the segment accumulates placements.
 */
const fitFor = (rating: ChannelRatingSeed, segment: SupportedSegment): number => {
  if (segment === 'senior_executive') return rating.fitSeniorExecutive;
  if (segment === 'senior_it_consultant') return rating.fitSeniorItConsultant;
  return Math.min(rating.fitSeniorExecutive, rating.fitSeniorItConsultant);
};

const PROVISIONAL_NOTE =
  'Provisional: the channel matrix was researched for senior executives and senior IT consultants and ' +
  'has no ratings of its own for technical specialists. Each channel is rated here at the lower of its ' +
  'two researched scores, so only channels the research supports for both senior segments are recommended. ' +
  'Developer communities rate low for that reason, not because they were judged for this segment. ' +
  'Replace with real ratings as placements accumulate.';

const priorityFor = (fit: number): ChannelPriority =>
  fit >= CHANNEL_THRESHOLDS.primary ? 'primary' : fit >= CHANNEL_THRESHOLDS.secondary ? 'secondary' : 'skip';

const segmentLabel = (segment: SupportedSegment) => SEGMENT_LABELS[segment];

/**
 * Rank the channel matrix for one mandate.
 *
 * Every channel is returned, including the skipped ones with the reason they
 * were skipped, because knowing what was deliberately not done is part of the
 * plan. See architecture.md s5.4.
 */
export function planChannels(ratings: readonly ChannelRatingSeed[], segment: Segment): ChannelPlan {
  // The matrix has no opinion about a role outside the segments, and inventing
  // one is how a technician search ends up pointed at the CNCF ambassador
  // directory. Technical specialists are inside, on a provisional rating.
  if (segment === 'out_of_scope') {
    throw new OutOfScopeError(
      'this mandate',
      'The channel matrix rates channels for senior executives and senior IT consultants only, and ' +
        'derives a provisional plan for technical specialists.',
    );
  }

  const selections: ChannelSelection[] = ratings
    .map((rating) => {
      const fit = fitFor(rating, segment);
      const priority = priorityFor(fit);
      return {
        channelCode: rating.code,
        name: rating.name,
        category: rating.category,
        fit,
        priority,
        etiquette: rating.etiquette,
        roleInProcess: rating.roleInProcess,
        reason:
          priority === 'skip'
            ? `Rated ${fit} of 5 for ${segmentLabel(segment)}: no return on effort for this segment.`
            : `Rated ${fit} of 5 for ${segmentLabel(segment)}. ${rating.roleInProcess}.`,
      } satisfies ChannelSelection;
    })
    .sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name));

  const primaries = selections.filter((s) => s.priority === 'primary');
  const secondaries = selections.filter((s) => s.priority === 'secondary');

  const rank = (s: ChannelSelection) => s.fit * 10 + (WARM_CATEGORIES.has(s.category) ? 1 : 0);
  const ordered = [...primaries].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));

  let recommended = ordered.slice(0, CHANNEL_THRESHOLDS.maxRecommended);
  let note: string;

  if (ordered.length > CHANNEL_THRESHOLDS.maxRecommended) {
    note =
      `${ordered.length} channels rate as primary for ${segmentLabel(segment)}. ` +
      `Most roles are covered well by three to five in combination, so the top ${CHANNEL_THRESHOLDS.maxRecommended} ` +
      `are recommended, weighted toward warm and network channels. The rest stay available if the search runs cold.`;
  } else if (ordered.length >= CHANNEL_THRESHOLDS.minRecommended) {
    note = `${ordered.length} primary channels for ${segmentLabel(segment)}, which is a workable combination.`;
  } else {
    const topUp = [...secondaries]
      .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))
      .slice(0, CHANNEL_THRESHOLDS.minRecommended - ordered.length);
    recommended = [...ordered, ...topUp];
    note =
      `Only ${ordered.length} channels rate as primary for ${segmentLabel(segment)}, so ` +
      `${topUp.length} secondary channel${topUp.length === 1 ? '' : 's'} ` +
      `${topUp.length === 1 ? 'is' : 'are'} pulled up to reach a three channel combination.`;
  }

  const provisional = segment === 'technical_specialist';
  return {
    selections,
    recommended,
    primaryCount: primaries.length,
    secondaryCount: secondaries.length,
    note: provisional ? `${note} ${PROVISIONAL_NOTE}` : note,
    provisional,
  };
}
