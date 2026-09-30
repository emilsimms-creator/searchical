import type { MandateConstraint, MandateTerm } from '@/mandate/types';
import { checkability, questionFor, whyUnverifiable } from './checkability';
import type {
  Finding, OpenQuestion, ScreenInput, ScreenResult, ScreenVerdict, ScreeningEvidence,
} from './types';

/**
 * Screen one person against one mandate.
 *
 * Deterministic and pure: the same evidence under the same mandate always
 * produces the same verdict, with the matched text attached to every finding so
 * a recruiter can check rather than trust. That property is what lets a
 * screening decision be explained six months later, and it is the reason this
 * is not a language model call.
 *
 * The rules, in the order they matter:
 *
 *   1. A confirmed exclusion that appears in the evidence rejects. These are
 *      the terms a human accepted as disqualifying vocabulary.
 *   2. A non-negotiable that this evidence cannot settle becomes an OPEN
 *      QUESTION, never a pass. This is the honest version of "never relaxes a
 *      non-negotiable": it never pretends to have checked one.
 *   3. A protected ground is never screened at all, and the result says so.
 *   4. Nothing positive and nothing negative is a HOLD, not a reject. Thin
 *      evidence is a fact about the evidence, not about the person.
 */
export function screen(input: ScreenInput): ScreenResult {
  const { evidence, terms, constraints } = input;
  const haystack = normalise(evidence.text);

  const matches: Finding[] = [];
  const concerns: Finding[] = [];

  // 1. Confirmed exclusions. A human accepted these as disqualifying vocabulary.
  for (const term of confirmed(terms, 'exclusion')) {
    const hit = findWord(haystack, term);
    if (hit) {
      concerns.push({
        statement: `The mandate excludes "${term}", and this evidence contains it.`,
        matched: hit,
        severity: 'exclusion',
      });
    }
  }

  // 2. Positive vocabulary.
  for (const term of confirmed(terms, 'title_variant')) {
    const hit = findPhrase(haystack, term);
    if (hit) {
      matches.push({
        statement: `Carries a title the mandate confirmed: "${term}".`,
        matched: hit,
        severity: 'positive',
      });
    }
  }
  for (const term of confirmed(terms, 'must_have_skill')) {
    const hit = findPhrase(haystack, term);
    if (hit) {
      matches.push({
        statement: `Shows the confirmed capability "${term}".`,
        matched: hit,
        severity: 'positive',
      });
    }
  }

  // 3. Constraints, each judged only as far as this evidence honestly allows.
  const openQuestions: OpenQuestion[] = [];
  const prohibitedChecksSkipped: ScreenResult['prohibitedChecksSkipped'] = [];

  for (const constraint of constraints) {
    const can = checkability(constraint.kind, evidence.depth);

    if (can === 'prohibited') {
      if (!prohibitedChecksSkipped.includes(constraint.kind)) {
        (prohibitedChecksSkipped as ScreenResult['prohibitedChecksSkipped'][number][]).push(constraint.kind);
      }
      openQuestions.push(toQuestion(constraint, can));
      continue;
    }

    if (can === 'never') {
      // An inferred constraint is the practice's hypothesis, not the client's
      // requirement, so it is not carried to the candidate as a question until
      // the client confirms it.
      if (!constraint.inferred) openQuestions.push(toQuestion(constraint, can));
      continue;
    }

    // `weak` is the only case where this evidence says anything, and it is
    // deliberately never enough to reject on. A stated city is not a commuting
    // radius; a missing credential is not an absent credential.
    const observed = observeWeakly(constraint, evidence, haystack);
    if (observed) {
      matches.push(observed);
    } else if (constraint.severity === 'disqualifying') {
      openQuestions.push(toQuestion(constraint, can));
    }
  }

  const verdict = decide(matches, concerns, evidence);
  return {
    verdict,
    depth: evidence.depth,
    matches,
    concerns,
    openQuestions,
    prohibitedChecksSkipped,
    headline: headlineFor(verdict, matches, concerns, openQuestions, evidence),
  };
}

/**
 * Advance needs evidence that this is a PERSON, not only evidence of the topic.
 *
 * Found on the live uOttawa run. Real search results for an identity and access
 * management mandate were pushed through the screen and fourteen of sixteen
 * advanced, and not one of the fourteen was a person: a Udemy course, a
 * Wikipedia article, a GitHub topic page and a run of vendor explainers. Skill
 * terms appear far more densely in documentation about a skill than on the page
 * of anyone who has it, so a screen that advances on skill matches ranks the
 * documentation above the people. The one genuine lead, an IAM summit page,
 * came last.
 *
 * Role titles are what describe people. So a lead advances on a confirmed title
 * match, or on skill matches where the URL is shaped like a person's own page
 * (a profile, a speaker page, a user page). Skills alone are a hold, with the
 * reason stated, and never a rejection: the author of a good article is still
 * a candidate, and a human has to work out who that is.
 */
function decide(
  matches: readonly Finding[],
  concerns: readonly Finding[],
  evidence: ScreeningEvidence,
): ScreenVerdict {
  if (concerns.some((c) => c.severity === 'exclusion')) return 'reject';
  const vocabulary = matches.filter((m) => m.severity === 'positive');
  if (vocabulary.length === 0) return 'hold';
  // Profile depth means the page has already been read and judged to be the
  // person's own; the gate is for thin evidence, not for everything.
  if (evidence.depth !== 'snippet') return 'advance';
  if (vocabulary.some((m) => m.statement.startsWith('Carries a title'))) return 'advance';
  if (personShaped(evidence.url)) return 'advance';
  return 'hold';
}

/** URL shapes that are a person's own page rather than a page about a topic. */
const PERSON_PATH = /\/(?:in|people|person|speakers?|team|profiles?|users?|members?|authors?|staff|bio)\/[^/?#]+/i;

export function personShaped(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (PERSON_PATH.test(u.pathname)) return true;
    // A code host's top level path segment is an account, not a topic.
    if (/(^|\.)github\.com$/i.test(u.hostname)) {
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length === 1 && !['topics', 'orgs', 'search', 'explore', 'features'].includes(parts[0]!.toLowerCase());
    }
    return false;
  } catch {
    return false;
  }
}

function toQuestion(constraint: MandateConstraint, can: ReturnType<typeof checkability>): OpenQuestion {
  return {
    kind: constraint.kind,
    severity: constraint.severity,
    question: questionFor(constraint.kind),
    why: whyUnverifiable(constraint.kind, can),
  };
}

/**
 * The only observations this layer will make from thin evidence.
 *
 * Presence, never absence. "The page mentions CISSP" is a fact; "the page does
 * not mention CISSP" is a fact about the page, not about the person, and
 * treating it as a finding is how a screen quietly rejects qualified people for
 * having a short profile.
 */
function observeWeakly(
  constraint: MandateConstraint,
  evidence: ScreeningEvidence,
  haystack: string,
): Finding | null {
  if (constraint.kind === 'location_or_onsite' && evidence.statedLocation) {
    return {
      statement: `States a location: ${evidence.statedLocation}. Whether that works for this role's ` +
        'on-site expectation is still a conversation.',
      matched: evidence.statedLocation,
      severity: constraint.severity,
    };
  }
  // Only specific tokens, never common words. The live uOttawa run matched
  // "based" (from "office based") inside "Role-Based", and "access" inside
  // "Access Control", and counted both as findings. A constraint observation
  // must rest on a token that means the same thing wherever it appears: a named
  // language, or a credential written as an acronym.
  for (const token of specificTokens(constraint)) {
    const hit = findWord(haystack, token);
    if (hit) {
      return {
        statement: `Evidence mentions "${token}", which bears on "${constraint.statement}". Worth ` +
          'confirming rather than assuming.',
        matched: hit,
        severity: constraint.severity,
      };
    }
  }
  return null;
}

const LANGUAGES = [
  'english', 'french', 'bilingual', 'spanish', 'portuguese', 'german', 'mandarin', 'cantonese',
  'hindi', 'punjabi', 'arabic', 'japanese', 'italian', 'dutch', 'korean', 'tagalog',
];

function specificTokens(constraint: MandateConstraint): string[] {
  const statement = constraint.statement;
  if (constraint.kind === 'language') {
    const lower = statement.toLowerCase();
    return LANGUAGES.filter((l) => lower.includes(l));
  }
  if (constraint.kind === 'licence_or_credential' || constraint.kind === 'security_clearance') {
    // Acronyms of three or more capitals: CISSP, CISM, PMP, CIDPRO, TOGAF.
    return Array.from(new Set(statement.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? []));
  }
  return [];
}

const normalise = (text: string): string =>
  text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ').toLowerCase();

/** Whole word only: "sales" must not match "wholesaler". */
function findWord(haystack: string, needle: string): string | null {
  const n = needle.trim().toLowerCase();
  if (n === '') return null;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack) ? needle : null;
}

/** Phrases match loosely on internal whitespace, since pages punctuate freely. */
function findPhrase(haystack: string, needle: string): string | null {
  const n = needle.trim().toLowerCase();
  if (n === '') return null;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s,]+/g, '[\\s,]+');
  return new RegExp(`\\b${escaped}\\b`).test(haystack) ? needle : null;
}

const confirmed = (terms: readonly MandateTerm[], kind: MandateTerm['kind']): string[] =>
  terms.filter((t) => t.kind === kind && t.status === 'confirmed')
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.term.trim())
    .filter((t) => t.length > 0);

function headlineFor(
  verdict: ScreenVerdict,
  matches: readonly Finding[],
  concerns: readonly Finding[],
  openQuestions: readonly OpenQuestion[],
  evidence: ScreeningEvidence,
): string {
  const blockers = openQuestions.filter((q) => q.severity === 'disqualifying').length;
  const tail = blockers > 0
    ? ` ${blockers} non-negotiable(s) cannot be settled from ${evidence.depth === 'snippet' ? 'a search snippet' : 'this evidence'} and must be asked.`
    : '';

  if (verdict === 'reject') {
    const first = concerns.find((c) => c.severity === 'exclusion');
    return `Rejected: ${first?.statement ?? 'the mandate excludes something present here.'}`;
  }
  if (verdict === 'hold') {
    if (matches.some((m) => m.severity === 'positive')) {
      return 'Matches the topic but shows no sign of being a person: skills without a role title ' +
        'usually mean a page about the skill, not someone who has it. If the author is the point, a ' +
        `human has to identify them.${tail}`;
    }
    return 'Nothing for or against. The evidence is too thin to say, which is a fact about the ' +
      `evidence rather than the person.${tail}`;
  }
  return `${matches.length} confirmed match(es), nothing contradicting.${tail}`;
}

/**
 * Screen many, ordered so a recruiter reads the best first.
 *
 * Ties break toward the person with fewer unanswered non-negotiables, because
 * that is the one whose conversation is shortest.
 */
export function screenAll(
  inputs: readonly ScreenInput[],
): readonly (ScreenResult & { index: number })[] {
  const rank: Record<ScreenVerdict, number> = { advance: 0, hold: 1, reject: 2 };
  return inputs
    .map((input, index) => ({ ...screen(input), index }))
    .sort((a, b) =>
      rank[a.verdict] - rank[b.verdict] ||
      b.matches.filter((m) => m.severity === 'positive').length -
        a.matches.filter((m) => m.severity === 'positive').length ||
      a.openQuestions.length - b.openQuestions.length);
}
