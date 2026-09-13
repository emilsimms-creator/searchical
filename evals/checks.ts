import {
  CHANNEL_MATRIX_SEED, deriveIntakeGaps, generateSearchStrings, isSupportedSegment, planChannels,
  verifySourceQuotes, type MandateDraft, type MandateTerm,
} from '@/mandate';

/**
 * Pass criteria for the extraction prompt.
 *
 * Every check is programmatic. The output space here is constrained (a label
 * from a closed set, structured data, strings that must satisfy a syntactic
 * rule), so a judge would add cost and non-determinism without measuring
 * anything a deterministic check cannot. Where judgment genuinely would be
 * needed, the check is deliberately absent and named in evals/README.md.
 *
 * Each check is a HARD GATE. A case passes only if every applicable check
 * passes, and the suite passes only if every case passes. `score` is reported
 * for the ratio-valued checks so a near miss is visible rather than collapsing
 * to a bare fail.
 */

export interface CheckResult {
  readonly id: string;
  readonly score: number; // 0 to 1
  readonly passed: boolean;
  readonly detail: string;
}

export interface CaseExpectation {
  readonly segment: string;
  /** Which bar a refused case must say it failed. */
  readonly outOfScopeReason?: string;
  readonly searchPlan: boolean;
  readonly constraintKinds: readonly string[];
  readonly gaps: readonly string[];
  readonly skills: readonly string[];
  readonly location: 'null' | 'place' | 'any';
}

const ok = (id: string, detail: string, score = 1): CheckResult => ({ id, score, passed: true, detail });
const bad = (id: string, detail: string, score = 0): CheckResult => ({ id, score, passed: false, detail });
const ratio = (id: string, hit: number, total: number, detail: string, threshold = 1): CheckResult => {
  const score = total === 0 ? 1 : hit / total;
  return { id, score, passed: score >= threshold, detail };
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Words that describe a requirement rather than name a capability. */
const CONSTRAINT_WORDS = [
  'clearance', 'on-call', 'on call', 'relocation', 'citizen', 'permanent resident', 'bilingual',
  'commuting', 'rotation', 'driver', 'years of experience', 'security level', 'eligible to obtain',
];

export function runChecks(
  draft: MandateDraft,
  expect: CaseExpectation,
  jobSpec: string,
): readonly CheckResult[] {
  const results: CheckResult[] = [];
  const terms = draft.terms;
  const searchTerms = terms.filter((t) => t.kind !== 'exclusion');

  // --- Triage. The single most consequential output: a wrong segment makes
  // every downstream artefact confidently wrong. ---
  results.push(
    draft.segment === expect.segment
      ? ok('segment_correct', `segment = ${draft.segment}`)
      : bad('segment_correct', `expected ${expect.segment}, got ${draft.segment}`),
  );

  // The rule is derived from the expected segment rather than read from the
  // case file, so a case that forgets to declare a reason cannot silently
  // weaken the check. An earlier version relied on the case file and the eval
  // duly caught the omission on its first run.
  const shouldBeRefused = expect.segment === 'out_of_scope';
  if (!shouldBeRefused) {
    results.push(
      draft.outOfScopeReason === null
        ? ok('scope_reason_correct', 'in scope, no refusal reason')
        : bad('scope_reason_correct', `in scope but carries refusal reason "${draft.outOfScopeReason}"`),
    );
  } else if (draft.outOfScopeReason === null) {
    results.push(bad('scope_reason_correct', 'refused without saying which bar failed'));
  } else if (expect.outOfScopeReason !== undefined && draft.outOfScopeReason !== expect.outOfScopeReason) {
    results.push(
      bad('scope_reason_correct', `expected reason "${expect.outOfScopeReason}", got "${draft.outOfScopeReason}"`),
    );
  } else {
    results.push(ok('scope_reason_correct', `refused on ${draft.outOfScopeReason} grounds`));
  }

  results.push(
    draft.segmentRationale.trim().length >= 80
      ? ok('rationale_substantive', `${draft.segmentRationale.trim().length} chars`)
      : bad('rationale_substantive', `rationale is ${draft.segmentRationale.trim().length} chars; a verdict needs its evidence`),
  );

  // --- Term quality. A term goes verbatim into a quoted Boolean phrase. ---
  const unsearchable = searchTerms.filter(
    (t) => t.term.length > 48 || /[()[\];]/.test(t.term) || /\.\s|\.$/.test(t.term),
  );
  results.push(
    unsearchable.length === 0
      ? ok('terms_searchable', `${searchTerms.length} terms, all searchable`)
      : bad('terms_searchable', `not searchable: ${unsearchable.map((t) => `"${t.term}"`).join(', ')}`),
  );

  const seen = new Set<string>();
  const dupes = terms.filter((t) => {
    const key = `${t.kind}:${norm(t.term)}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  results.push(
    dupes.length === 0
      ? ok('no_duplicate_terms', `${terms.length} terms, all distinct`)
      : bad('no_duplicate_terms', `repeated: ${dupes.map((t) => t.term).join(', ')}`),
  );

  const leaked = searchTerms.filter((t) => CONSTRAINT_WORDS.some((w) => norm(t.term).includes(w)));
  results.push(
    leaked.length === 0
      ? ok('no_constraint_leakage', 'no requirement text in the search terms')
      : bad('no_constraint_leakage', `constraint text used as a search term: ${leaked.map((t) => t.term).join(', ')}`),
  );

  // --- Location. A sentence here poisons two search queries and suppresses
  // the gap that should have fired. ---
  const loc = draft.location;
  const locationOk =
    expect.location === 'any' ||
    (expect.location === 'null' ? loc === null : loc !== null && loc.length <= 60);
  results.push(
    locationOk
      ? ok('location_shape', loc === null ? 'null, as expected' : `"${loc}"`)
      : bad('location_shape', `expected ${expect.location}, got ${loc === null ? 'null' : `"${loc}"`}`),
  );

  // --- Provenance. The whole value of a source quote is that it can be
  // checked against the document. ---
  const stated = draft.constraints.filter((c) => !c.inferred);
  const statedWithQuote = stated.filter((c) => c.sourceQuote !== undefined && c.sourceQuote.trim() !== '');
  results.push(
    ratio('stated_have_quotes', statedWithQuote.length, stated.length,
      `${statedWithQuote.length}/${stated.length} stated constraints carry a quote`),
  );

  const verified = verifySourceQuotes(stated, jobSpec);
  const found = verified.filter((v) => v.found);
  results.push(
    ratio('quotes_verified', found.length, verified.length,
      verified.length === 0
        ? 'no quotes to verify'
        : `${found.length}/${verified.length} quotes found verbatim in the specification` +
          (found.length === verified.length ? '' : `; missing: ${verified.filter((v) => !v.found).map((v) => `"${v.quote.slice(0, 60)}"`).join(', ')}`)),
  );

  const inferredDisqualifying = draft.constraints.filter((c) => c.inferred && c.severity === 'disqualifying');
  results.push(
    ok('inference_labelled',
      `${draft.constraints.filter((c) => c.inferred).length} inferred, ` +
      `${inferredDisqualifying.length} of them disqualifying (surfaced, not counted against the market)`),
  );

  // --- Coverage against what the specification actually requires. ---
  const kindsPresent = new Set(draft.constraints.map((c) => c.kind));
  const kindHits = expect.constraintKinds.filter((k) => kindsPresent.has(k as never));
  results.push(
    ratio('required_constraints', kindHits.length, expect.constraintKinds.length,
      expect.constraintKinds.length === 0
        ? 'none required'
        : `${kindHits.length}/${expect.constraintKinds.length}; missing: ${expect.constraintKinds.filter((k) => !kindsPresent.has(k as never)).join(', ') || 'none'}`),
  );

  // --- Everything below applies only to a mandate that proceeds. ---
  if (isSupportedSegment(draft.segment)) {
    const skillBlob = norm(terms.filter((t) => t.kind === 'must_have_skill').map((t) => t.term).join(' | '));
    const skillHits = expect.skills.filter((s) => skillBlob.includes(norm(s)));
    results.push(
      ratio('required_skills', skillHits.length, expect.skills.length,
        expect.skills.length === 0
          ? 'none required'
          : `${skillHits.length}/${expect.skills.length}; missing: ${expect.skills.filter((s) => !skillBlob.includes(norm(s))).join(', ') || 'none'}`),
    );

    const gapFields = new Set(deriveIntakeGaps(draft).map((g) => g.field));
    const gapHits = expect.gaps.filter((g) => gapFields.has(g as never));
    results.push(
      ratio('required_gaps', gapHits.length, expect.gaps.length,
        expect.gaps.length === 0
          ? 'none required'
          : `${gapHits.length}/${expect.gaps.length}; raised: ${[...gapFields].join(', ') || 'none'}`),
    );

    // A Boolean a recruiter can paste and run is the deliverable.
    try {
      const confirmed: MandateTerm[] = terms.map((t) => ({ ...t, status: 'confirmed' as const }));
      const plan = planChannels(CHANNEL_MATRIX_SEED, draft.segment);
      const skippedChannels = plan.selections.filter((c) => c.priority === 'skip').map((c) => c.channelCode);
      const { strings } = generateSearchStrings({ terms: confirmed, location: draft.location, skippedChannels });

      // A search string for a channel the same plan says to skip is a
      // contradiction inside one output.
      const contradictions = strings.filter(
        (str) =>
          (str.kind === 'github_xray' && skippedChannels.includes('github')) ||
          (str.kind === 'conference_talks_xray' && skippedChannels.includes('conferences_and_summits')),
      );
      results.push(
        contradictions.length === 0
          ? ok('strings_match_plan', 'no search string for a skipped channel')
          : bad('strings_match_plan', `generated for skipped channels: ${contradictions.map((c) => c.kind).join(', ')}`),
      );

      const boolean = strings.find((s) => s.kind === 'linkedin_recruiter_boolean')?.value ?? '';
      const runnable = boolean.length > 20 && boolean.includes(' OR ') && !/\(\s*\)/.test(boolean);
      results.push(
        runnable
          ? ok('boolean_runnable', `${boolean.length} chars`)
          : bad('boolean_runnable', `not runnable: ${boolean.slice(0, 120)}`),
      );
    } catch (error) {
      results.push(bad('boolean_runnable', `generation threw: ${(error as Error).message}`));
    }

    results.push(
      expect.searchPlan
        ? ok('channel_plan', `${planChannels(CHANNEL_MATRIX_SEED, draft.segment).recommended.length} channels recommended`)
        : bad('channel_plan', 'a channel plan was produced for a case that should not have one'),
    );
  } else {
    // The refusal is the deliverable.
    let refused = false;
    try {
      planChannels(CHANNEL_MATRIX_SEED, draft.segment);
    } catch {
      refused = true;
    }
    results.push(
      refused === !expect.searchPlan
        ? ok('no_search_plan', 'refused to plan channels, as expected')
        : bad('no_search_plan', 'produced a channel plan for an out of scope mandate'),
    );
  }

  return results;
}
