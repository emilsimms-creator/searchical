import type { ScoreModel } from './types';

/**
 * The scoring model, version 1.0.0, from the practice's own workbook
 * (Candidate Receptivity Scorecard, Scoring Model tab, September 2026).
 *
 * Read the last line of `notes` before trusting any number this produces.
 */
export const SCORE_MODEL_V1: ScoreModel = {
  version: '1.0.0',
  maxFactorScore: 5,
  decayPerPeriod: 0.1,
  decayPeriodDays: 30,
  decayFloor: 0.5,
  dueWarningDays: 7,
  interestScale: { no: 0, maybe: 3, yes: 5 },
  stacking: {
    // Two or more independent signals inside the window, at least one of them
    // an employer level trigger. Combining one employer trigger with one
    // individual behaviour produces the highest confidence shortlist.
    minimumSignals: 2,
    minimumEmployerTriggers: 1,
    windowDays: 30,
  },
  factors: [
    {
      id: 'f1', ordinal: 1, weight: 10, derived: true,
      label: 'Pre-contact openness signals',
      zeroLooksLike: 'No profile, activity or company signals observed',
      fiveLooksLike: 'Several strong signals: an open-to-work flag, company disruption, tenure at a typical move point',
      evidenceBasis: 'Signals Checklist: LinkedIn platform data and search-firm practice. A single signal is noise and even Open to Work is a lagging confirmation',
    },
    {
      id: 'f2', ordinal: 2, weight: 20, derived: true,
      label: 'Interest-scale position',
      zeroLooksLike: 'Clear no, with no permission to follow up',
      fiveLooksLike: 'Clear yes, and agreed to a concrete next step',
      evidenceBasis: 'Vlastelica (Dice, 2024): forward progress along the No, Maybe, Yes scale is the win',
    },
    {
      id: 'f3', ordinal: 3, weight: 10, derived: false,
      label: 'Buying cues during the call',
      zeroLooksLike: 'Passive, one-word answers, asks nothing',
      fiveLooksLike: 'Sells their own fit; asks about scope, team and next steps',
      evidenceBasis: 'Adler (ERE, 2012): the person sells you. Top Echelon (2026): skeptical to curious to motivated',
    },
    {
      id: 'f4', ordinal: 4, weight: 15, derived: false,
      label: 'Push factors disclosed',
      zeroLooksLike: 'Says they are getting everything they want where they are',
      fiveLooksLike: 'Volunteers several frustrations and describes what is missing',
      evidenceBasis: 'McKinsey (2021): 54% left because they felt undervalued. Gallup: pay named in only 16% of exits',
    },
    {
      id: 'f5', ordinal: 5, weight: 20, derived: false,
      label: 'Motivator match to the opportunity',
      zeroLooksLike: 'Opportunity contradicts their dominant driver',
      fiveLooksLike: 'Opportunity directly delivers their driver: autonomy, stretch, mastery, flexibility',
      evidenceBasis: 'Schein career anchors; Pink (Drive); Adler 30% Solution',
    },
    {
      id: 'f6', ordinal: 6, weight: 10, derived: false,
      label: 'Timing readiness',
      zeroLooksLike: 'Locked in for 18 or more months: a new promotion, distant vesting',
      fiveLooksLike: 'Available now or within 90 days: contract end, project close',
      evidenceBasis: 'Adler: defer hard timing asks past call one. Pin (2026): tier by readiness',
    },
    {
      id: 'f7', ordinal: 7, weight: 10, derived: false,
      label: 'Freedom from deal-breakers',
      zeroLooksLike: 'A hard blocker: no contract work, a non-compete, an immovable location',
      fiveLooksLike: 'No constraints surfaced',
      evidenceBasis: 'Vlastelica (Dice, 2024): some objections are deal breakers. Scored against the mandate constraints captured in phase one',
    },
    {
      id: 'f8', ordinal: 8, weight: 5, derived: false,
      label: 'Compensation openness and fit',
      zeroLooksLike: 'Refuses to discuss it, or the gap is unbridgeable',
      fiveLooksLike: 'Discloses the current package and the expectation is within range',
      evidenceBasis: 'Vlastelica (2024); Gallup; Gartner (2024). Disclosure is a pivot signal, but pay is hygiene rather than the top reason to move, so it carries the lowest weight',
    },
  ],
  tiers: [
    { tier: 'hot', minimumScore: 70, cadenceDays: 30, basis: 'Pin (2026): hot prospects get monthly check-ins' },
    { tier: 'warm', minimumScore: 40, cadenceDays: 49, basis: 'Pin (2026): warm leads every six to eight weeks' },
    { tier: 'cool', minimumScore: 0, cadenceDays: 90, basis: 'Pin (2026): cool pool quarterly. Top Echelon (2026): consistency without annoyance' },
  ],
  notes:
    'Decision support, not prediction. No validated predictive model of candidate openness exists in ' +
    'the published research: every construct here is a practitioner or vendor heuristic. The cadence ' +
    'intervals and the decay parameters in particular are vendor guidance rather than peer reviewed ' +
    'findings. Treat every score as a hypothesis to confirm in the conversation, and replace these ' +
    'numbers with the practice\'s own once there is enough history to backtest them.',
};

/** Weights must total 100, or the score is not out of 100 and nobody notices. */
export function assertModelIsCoherent(model: ScoreModel): void {
  const total = model.factors.reduce((sum, f) => sum + f.weight, 0);
  if (total !== 100) {
    throw new Error(`score model ${model.version}: factor weights total ${total}, not 100`);
  }
  if (model.tiers.length === 0 || model.tiers[model.tiers.length - 1]!.minimumScore !== 0) {
    throw new Error(`score model ${model.version}: the lowest tier must start at 0, or a score can fall through it`);
  }
  const descending = model.tiers.every((t, i) => i === 0 || t.minimumScore < model.tiers[i - 1]!.minimumScore);
  if (!descending) {
    throw new Error(`score model ${model.version}: tiers must be ordered from highest minimum score down`);
  }
}
