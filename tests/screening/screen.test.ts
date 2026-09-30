import { describe, expect, it } from 'vitest';
import { checkability, screen, screenAll, type ScreeningEvidence } from '@/screening';
import type { MandateConstraint, MandateTerm } from '@/mandate/types';

const term = (
  kind: MandateTerm['kind'], value: string, rank: number, status: MandateTerm['status'] = 'confirmed',
): MandateTerm => ({ kind, term: value, origin: 'extracted', status, observedCount: null, rank });

const TERMS: readonly MandateTerm[] = [
  term('title_variant', 'Vice President, Engineering', 1),
  term('title_variant', 'VP Engineering', 2),
  term('must_have_skill', 'Kubernetes', 1),
  term('must_have_skill', 'Terraform', 2),
  term('exclusion', 'Junior', 1),
  term('exclusion', 'Sales', 2),
];

const constraint = (
  kind: MandateConstraint['kind'],
  severity: MandateConstraint['severity'] = 'disqualifying',
  statement = 'A requirement.',
  inferred = false,
): MandateConstraint => ({ kind, severity, statement, inferred });

const evidence = (text: string, over: Partial<ScreeningEvidence> = {}): ScreeningEvidence => ({
  text, sourceId: 'conference_programmes', depth: 'snippet', ...over,
});

describe('what can honestly be checked, from what', () => {
  it('knows a clearance is never published and must be asked', () => {
    expect(checkability('security_clearance', 'snippet')).toBe('never');
    expect(checkability('security_clearance', 'profile')).toBe('never');
    expect(checkability('security_clearance', 'conversation')).toBe('reliable');
  });

  /**
   * The one that matters most. It looks checkable from a location or a name,
   * which is exactly the danger.
   */
  it('refuses outright to screen citizenship from anything but the person', () => {
    expect(checkability('citizenship_or_status', 'snippet')).toBe('prohibited');
    expect(checkability('citizenship_or_status', 'profile')).toBe('prohibited');
    expect(checkability('citizenship_or_status', 'conversation')).toBe('reliable');
  });

  it('never rates web evidence above weak for anything judgeable', () => {
    for (const kind of ['location_or_onsite', 'language', 'licence_or_credential', 'prior_experience'] as const) {
      expect(checkability(kind, 'snippet'), kind).toBe('weak');
      expect(checkability(kind, 'profile'), kind).toBe('weak');
    }
  });
});

describe('screening a person', () => {
  it('advances on confirmed vocabulary with the matched text attached', () => {
    const r = screen({
      evidence: evidence('Ada Okafor, VP Engineering, talk on Kubernetes multi-cluster failover'),
      terms: TERMS, constraints: [],
    });
    expect(r.verdict).toBe('advance');
    expect(r.matches.map((m) => m.matched)).toContain('VP Engineering');
    expect(r.matches.map((m) => m.matched)).toContain('Kubernetes');
  });

  it('rejects on a confirmed exclusion, and names the word that did it', () => {
    const r = screen({
      evidence: evidence('Junior Kubernetes engineer, VP Engineering track'),
      terms: TERMS, constraints: [],
    });
    expect(r.verdict).toBe('reject');
    expect(r.headline).toMatch(/excludes "Junior"/);
  });

  /** "Sales" must not match "wholesaler", or the screen rejects on noise. */
  it('matches exclusions on whole words only', () => {
    const r = screen({
      evidence: evidence('VP Engineering for a wholesaler. Kubernetes at scale.'),
      terms: TERMS, constraints: [],
    });
    expect(r.verdict).toBe('advance');
    expect(r.concerns).toEqual([]);
  });

  it('matches a title across the punctuation a page happens to use', () => {
    const r = screen({
      evidence: evidence('Vice President  Engineering at Example Corp'),
      terms: TERMS, constraints: [],
    });
    expect(r.matches.map((m) => m.matched)).toContain('Vice President, Engineering');
  });

  it('holds rather than rejects when the evidence says nothing either way', () => {
    const r = screen({
      evidence: evidence('A person who attended the conference.'),
      terms: TERMS, constraints: [],
    });
    expect(r.verdict).toBe('hold');
    expect(r.headline).toMatch(/fact about the evidence rather than the person/);
  });

  it('ignores vocabulary a human never confirmed', () => {
    const proposed = TERMS.map((t) => ({ ...t, status: 'proposed' as const }));
    const r = screen({
      evidence: evidence('VP Engineering, Kubernetes, Junior'),
      terms: proposed, constraints: [],
    });
    expect(r.verdict).toBe('hold');
    expect(r.matches).toEqual([]);
    expect(r.concerns).toEqual([]);
  });
});

describe('non-negotiables are never quietly passed', () => {
  /**
   * The honest version of "never relaxes a non-negotiable" is that it never
   * pretends to have checked one.
   */
  it('turns an unverifiable non-negotiable into a question for the call', () => {
    const r = screen({
      evidence: evidence('Ada Okafor, VP Engineering, Kubernetes'),
      terms: TERMS,
      constraints: [constraint('security_clearance', 'disqualifying', 'Must obtain Secret clearance.')],
    });
    expect(r.verdict).toBe('advance');
    const q = r.openQuestions.find((x) => x.kind === 'security_clearance')!;
    expect(q.question).toMatch(/eligible to obtain, the clearance/);
    expect(q.why).toMatch(/Nobody publishes their clearance status/);
    expect(r.headline).toMatch(/1 non-negotiable\(s\) cannot be settled from a search snippet/);
  });

  it('carries every unanswerable requirement, not just the first', () => {
    const r = screen({
      evidence: evidence('VP Engineering, Kubernetes'),
      terms: TERMS,
      constraints: [
        constraint('security_clearance'),
        constraint('schedule', 'disqualifying', 'On-call rotation required.'),
        constraint('travel', 'disqualifying', 'Quarterly travel to site.'),
      ],
    });
    expect(r.openQuestions.map((q) => q.kind).sort())
      .toEqual(['schedule', 'security_clearance', 'travel']);
  });

  /** An inference is the practice's hypothesis, not the client's requirement. */
  it('does not put an inferred constraint to a candidate as a question', () => {
    const r = screen({
      evidence: evidence('VP Engineering, Kubernetes'),
      terms: TERMS,
      constraints: [constraint('schedule', 'disqualifying', 'Probably on-call.', true)],
    });
    expect(r.openQuestions).toEqual([]);
  });

  it('records that it declined to screen a protected ground, rather than omitting it silently', () => {
    const r = screen({
      evidence: evidence('Ada Okafor, VP Engineering, based in Toronto', { statedLocation: 'Toronto' }),
      terms: TERMS,
      constraints: [constraint('citizenship_or_status', 'disqualifying', 'Canadian citizens and permanent residents.')],
    });
    expect(r.prohibitedChecksSkipped).toEqual(['citizenship_or_status']);
    const q = r.openQuestions.find((x) => x.kind === 'citizenship_or_status')!;
    expect(q.why).toMatch(/infer a protected ground from a name, a photograph or a location/);
    // Critically, a stated location did NOT become an inference about status.
    expect(r.concerns).toEqual([]);
    expect(r.verdict).toBe('advance');
  });

  it('never rejects on a weak signal, however tempting', () => {
    const r = screen({
      evidence: evidence('VP Engineering in Vancouver. Kubernetes.', { statedLocation: 'Vancouver' }),
      terms: TERMS,
      constraints: [constraint('location_or_onsite', 'disqualifying', 'On site in Toronto twelve days a month.')],
    });
    // Wrong city on the face of it, and still not a rejection: a stated city is
    // not a commuting radius and is often stale.
    expect(r.verdict).not.toBe('reject');
    expect(r.matches.some((m) => m.statement.includes('still a conversation'))).toBe(true);
  });

  /** Absence of evidence is a fact about the page, not about the person. */
  it('does not treat a missing credential as a missing credential', () => {
    const r = screen({
      evidence: evidence('VP Engineering, Kubernetes'),
      terms: TERMS,
      constraints: [constraint('licence_or_credential', 'disqualifying', 'CISSP certification required.')],
    });
    expect(r.verdict).toBe('advance');
    expect(r.concerns).toEqual([]);
    expect(r.openQuestions.map((q) => q.kind)).toEqual(['licence_or_credential']);
  });
});

describe('screening a list', () => {
  it('puts the best first and the rejected last', () => {
    const results = screenAll([
      { evidence: evidence('Attended the conference.'), terms: TERMS, constraints: [] },
      { evidence: evidence('Junior engineer, Kubernetes'), terms: TERMS, constraints: [] },
      { evidence: evidence('VP Engineering, Kubernetes, Terraform'), terms: TERMS, constraints: [] },
    ]);
    expect(results.map((r) => r.verdict)).toEqual(['advance', 'hold', 'reject']);
    expect(results[0]!.index).toBe(2);
  });

  it('breaks a tie toward the shorter conversation', () => {
    const many = [constraint('security_clearance'), constraint('travel'), constraint('schedule')];
    const results = screenAll([
      { evidence: evidence('VP Engineering, Kubernetes'), terms: TERMS, constraints: many },
      { evidence: evidence('VP Engineering, Kubernetes'), terms: TERMS, constraints: [constraint('travel')] },
    ]);
    expect(results[0]!.index).toBe(1);
    expect(results[0]!.openQuestions).toHaveLength(1);
  });

  it('is pure: the same evidence under the same mandate always decides the same way', () => {
    const input = {
      evidence: evidence('VP Engineering, Kubernetes'), terms: TERMS,
      constraints: [constraint('security_clearance')],
    };
    expect(screen(input)).toEqual(screen(input));
  });
});
