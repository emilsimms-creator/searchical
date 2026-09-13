import type { ChannelPriority, ChannelRatingSeed, ChannelSelection, Segment } from './types';

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
}

const fitFor = (rating: ChannelRatingSeed, segment: Segment): number =>
  segment === 'senior_executive' ? rating.fitSeniorExecutive : rating.fitSeniorItConsultant;

const priorityFor = (fit: number): ChannelPriority =>
  fit >= CHANNEL_THRESHOLDS.primary ? 'primary' : fit >= CHANNEL_THRESHOLDS.secondary ? 'secondary' : 'skip';

const segmentLabel = (segment: Segment) =>
  segment === 'senior_executive' ? 'senior executives' : 'senior IT consultants';

/**
 * Rank the channel matrix for one mandate.
 *
 * Every channel is returned, including the skipped ones with the reason they
 * were skipped, because knowing what was deliberately not done is part of the
 * plan. See architecture.md s5.4.
 */
export function planChannels(ratings: readonly ChannelRatingSeed[], segment: Segment): ChannelPlan {
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

  return {
    selections,
    recommended,
    primaryCount: primaries.length,
    secondaryCount: secondaries.length,
    note,
  };
}
