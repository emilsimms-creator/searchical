import type { ConstraintKind } from '@/mandate/types';
import type { Checkability, EvidenceDepth } from './types';

/**
 * What can honestly be judged about a requirement, from what evidence.
 *
 * The autonomous sourcing tools advertise evaluating every profile against
 * every criterion including non-negotiables they never relax. Run that against
 * a search snippet and most of it is theatre: nobody publishes their security
 * clearance, their willingness to be on call, or how far they will commute. A
 * screen that reports PASS on a clearance requirement it could not possibly
 * have verified is worse than no screen, because a recruiter believes it.
 *
 * So the honest version of "never relaxes a non-negotiable" is **never pretends
 * to have checked one**. Anything this table marks `never` becomes a question
 * for the conversation, carried all the way to the exploratory call, rather
 * than a silent pass.
 *
 * CITIZENSHIP IS DIFFERENT AGAIN, and it is marked `prohibited` at every depth
 * short of the person telling you directly. It looks checkable, which is the
 * danger: the only methods available from a web page are inferring a protected
 * ground from a name, a photograph or a location. That is the inference the
 * sensitivity classifier exists to prevent on the enrichment gate, and it is
 * the shape of automated screening that New York City's Local Law 144 and
 * Illinois HB 3773 were written about. The system will not do it, and says so
 * in the result rather than silently omitting it.
 */
const MATRIX: Readonly<Record<ConstraintKind, Readonly<Record<EvidenceDepth, Checkability>>>> = {
  // Not published anywhere, by anyone, ever. Asked, or unknown.
  security_clearance: { snippet: 'never', profile: 'never', conversation: 'reliable' },

  // Looks checkable from a location or a name. It is not. See above.
  citizenship_or_status: { snippet: 'prohibited', profile: 'prohibited', conversation: 'reliable' },

  // A stated city is real information, and it is still not a commuting radius
  // or a willingness to relocate. Weak where stated, never where inferred.
  location_or_onsite: { snippet: 'weak', profile: 'weak', conversation: 'reliable' },

  // On-call, shift patterns and release windows are private arrangements.
  schedule: { snippet: 'never', profile: 'never', conversation: 'reliable' },

  // The language a page is written in is a hint about the author, no more.
  language: { snippet: 'weak', profile: 'weak', conversation: 'reliable' },

  // People do list credentials on profiles, and the absence of one proves
  // nothing at all, which is why it never rises above weak before a call.
  licence_or_credential: { snippet: 'weak', profile: 'weak', conversation: 'reliable' },

  // Titles and dates are visible. What someone actually did is not.
  prior_experience: { snippet: 'weak', profile: 'weak', conversation: 'reliable' },

  travel: { snippet: 'never', profile: 'never', conversation: 'reliable' },

  other: { snippet: 'never', profile: 'never', conversation: 'weak' },
};

export const checkability = (kind: ConstraintKind, depth: EvidenceDepth): Checkability =>
  MATRIX[kind][depth];

/**
 * The question to put to the person, per kind of requirement.
 *
 * Phrased to be asked out loud on an exploratory call, because that is where it
 * gets answered. A screen that produces "UNVERIFIED: security_clearance" has
 * done half the job; the recruiter still has to work out what to say.
 */
const QUESTIONS: Readonly<Record<ConstraintKind, string>> = {
  security_clearance:
    'Do you currently hold, or would you be eligible to obtain, the clearance this role requires?',
  citizenship_or_status:
    'Are you legally able to work in this location without sponsorship? Asked directly rather than assumed.',
  location_or_onsite:
    'Where are you based now, and what does a workable arrangement look like for on-site days or relocation?',
  schedule:
    'The role carries an on-call or out-of-hours expectation. Does that work with how you want to operate?',
  language:
    'What working languages are you comfortable operating in at this level?',
  licence_or_credential:
    'Do you hold the credential this role lists, and if not, is it something you would pursue?',
  prior_experience:
    'Walk me through the closest thing you have done to this, and the scale you did it at.',
  travel: 'The role expects travel at this cadence. Is that workable for you right now?',
  other: 'The specification sets a requirement this evidence cannot answer. Worth raising directly.',
};

export const questionFor = (kind: ConstraintKind): string => QUESTIONS[kind];

/** Why a requirement could not be judged, for the recruiter rather than the log. */
export function whyUnverifiable(kind: ConstraintKind, checkable: Checkability): string {
  if (checkable === 'prohibited') {
    return 'Deliberately not screened. The only way to judge this from a web page is to infer a ' +
      'protected ground from a name, a photograph or a location, which this system will not do. ' +
      'Ask the person directly.';
  }
  return kind === 'security_clearance'
    ? 'Nobody publishes their clearance status, so no evidence short of asking can settle it.'
    : 'This is a private arrangement rather than a published fact, so the evidence available here ' +
      'cannot settle it either way.';
}
