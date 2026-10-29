import { TriageOverrideError, isSupportedSegment, type MandateDraft, type OutOfScopeReason, type SupportedSegment } from './types';

/**
 * The recruiter's right to overrule a refusal.
 *
 * Triage has a boundary and the model will sometimes sit on the wrong side of
 * it. A refusal on seniority is a judgement about how a role is shaped: five
 * years rather than eight, a title with no marker, coordination rather than
 * design authority. A recruiter who knows the client can reasonably read the
 * same role differently, and both live runs on the Algonquin College Network
 * Designer said exactly that in their own rationale before leaving the
 * recruiter with no way to act on it.
 *
 * Two things are never overruled. A refusal on domain says the role is outside
 * the technology market the channel matrix was researched for, and moving it
 * into a segment would produce the confidently wrong plan the refusal exists to
 * prevent. And an overrule with no real reason attached is refused, because
 * the reason is the record.
 */

/** Long enough that "client asked" is not a reason, short enough that a real one fits. */
export const MIN_OVERRIDE_REASON_CHARS = 30;

export interface TriageOverrideRequest {
  readonly segment: SupportedSegment;
  /** Why a person is overruling the model, in their own words. Kept verbatim. */
  readonly reason: string;
  readonly actor: string;
}

/**
 * Whether a refusal may be overruled, and if not, why not. Takes the reason the
 * refusal was recorded with, not the one a fresh model run happens to give, so
 * a mandate cannot be argued into scope by re-rolling the extraction.
 */
export function overrideBlocker(reason: OutOfScopeReason | null): string | null {
  // An out of scope verdict with no recorded axis is treated as the strictest
  // case. The prompt requires one, and a missing axis is not permission.
  const axis = reason ?? 'both';
  if (axis === 'seniority') return null;
  if (axis === 'domain') {
    return (
      'This role was refused on domain: it is outside technology, which is the market the channel matrix ' +
      'was researched for. Moving it into a segment would aim the search at the wrong people with ' +
      'confidence, so it cannot be overruled. Opening a new function is a build decision, not a triage ' +
      'override.'
    );
  }
  return (
    'This role was refused on both seniority and domain. The domain failure cannot be overruled, ' +
    'because the channel matrix has no research for that market.'
  );
}

export function validateOverrideRequest(request: TriageOverrideRequest): void {
  if (request.actor.trim() === '') {
    throw new TriageOverrideError('an overrule must name the person making it');
  }
  if (!isSupportedSegment(request.segment)) {
    throw new TriageOverrideError('an overrule must move the mandate into a segment this practice recruits');
  }
  if (request.reason.trim().length < MIN_OVERRIDE_REASON_CHARS) {
    throw new TriageOverrideError(
      `an overrule needs a reason of at least ${MIN_OVERRIDE_REASON_CHARS} characters: it is the record ` +
        'that a person, not the model, put this mandate into a segment',
    );
  }
}

/**
 * Apply a recruiter's overrule to a refused draft.
 *
 * `recordedReason` is the axis the mandate was refused on when it was first
 * recorded. The draft is a fresh extraction, and if that now says the role is
 * outside technology the overrule is refused on that ground too: a second look
 * from the model can add a reason to refuse but cannot remove one.
 */
export function applyTriageOverride(
  draft: MandateDraft,
  request: TriageOverrideRequest,
  recordedReason: OutOfScopeReason | null,
): MandateDraft {
  validateOverrideRequest(request);

  const recorded = overrideBlocker(recordedReason);
  if (recorded) throw new TriageOverrideError(recorded);

  if (!isSupportedSegment(draft.segment)) {
    const fresh = overrideBlocker(draft.outOfScopeReason);
    if (fresh) throw new TriageOverrideError(fresh);
  }

  return { ...draft, segment: request.segment, outOfScopeReason: null };
}
