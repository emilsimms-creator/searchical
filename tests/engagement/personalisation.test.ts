import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TEMPLATES, SEQUENCE_LIMITS, checkLength, evaluatePersonalisation, sequenceFor,
  templateByCode, type EvidenceFact, type PersonalisationHook,
} from '@/engagement';

const live = (id: string, over: Partial<EvidenceFact> = {}): [string, EvidenceFact] =>
  [id, { id, live: true, aboutThisPerson: true, citation: 'https://example.org/kubecon-talk', ...over }];

const hook = (token: string, over: Partial<PersonalisationHook> = {}): PersonalisationHook => ({
  token, value: 'their KubeCon talk on multi-cluster failover', evidenceId: 'ev-1',
  citation: 'https://example.org/kubecon-talk', ...over,
});

describe('the eight templates', () => {
  it('carry the Playbook copy and the principles behind each', () => {
    expect(MESSAGE_TEMPLATES).toHaveLength(8);
    for (const t of MESSAGE_TEMPLATES) {
      expect(t.body.length, t.code).toBeGreaterThan(80);
      expect(t.appliesPrinciples.length, t.code).toBeGreaterThan(30);
    }
  });

  it('sends touch three in the hiring leader\'s voice', () => {
    expect(templateByCode('hiring_leader_followup').sendAs).toBe('hiring_leader');
  });

  it('keeps the LinkedIn openers inside the length ceilings the evidence gives', () => {
    expect(templateByCode('first_inmail').maxChars).toBe(400);
    expect(templateByCode('linkedin_connection_note').maxChars).toBe(300);
  });

  it('asks for no fresh evidence on the close and the referral ask', () => {
    expect(templateByCode('polite_close').requiresPersonalEvidence).toBe(false);
    expect(templateByCode('referral_ask').requiresPersonalEvidence).toBe(false);
  });
});

describe('the personalisation gate', () => {
  const inmail = templateByCode('first_inmail');

  it('permits a message with a verified, live, person specific hook', () => {
    const v = evaluatePersonalisation(
      inmail,
      [hook('specific achievement, talk or program')],
      new Map([live('ev-1')]),
    );
    expect(v.permitted).toBe(true);
    expect(v.statement).toMatch(/1 verified person specific hook/);
  });

  it('blocks a message with no hook at all', () => {
    const v = evaluatePersonalisation(inmail, [], new Map());
    expect(v.permitted).toBe(false);
    expect(v.statement).toMatch(/goes back to research/);
    expect(v.statement).toMatch(/no better than none/);
  });

  it('blocks a hook whose evidence does not exist', () => {
    const v = evaluatePersonalisation(inmail, [hook('specific achievement, talk or program')], new Map());
    expect(v.permitted).toBe(false);
    expect(v.statement).toMatch(/does not exist/);
  });

  it('blocks a company fact dressed up as a personal hook', () => {
    const v = evaluatePersonalisation(
      inmail,
      [hook('specific achievement, talk or program')],
      new Map([live('ev-1', { aboutThisPerson: false })]),
    );
    expect(v.permitted).toBe(false);
    expect(v.statement).toMatch(/A company fact is not a personal hook/);
  });

  it('blocks a stale hook', () => {
    const v = evaluatePersonalisation(
      inmail,
      [hook('specific achievement, talk or program')],
      new Map([live('ev-1', { live: false })]),
    );
    expect(v.permitted).toBe(false);
    expect(v.statement).toMatch(/stale hook reads as a stale approach/);
  });

  it('blocks a hook a recruiter could not check', () => {
    const v = evaluatePersonalisation(
      inmail,
      [hook('specific achievement, talk or program', { citation: '' })],
      new Map([live('ev-1', { citation: null })]),
    );
    expect(v.permitted).toBe(false);
    expect(v.statement).toMatch(/cannot check it before sending/);
  });

  it('blocks an empty value even when the evidence is good', () => {
    const v = evaluatePersonalisation(
      inmail,
      [hook('specific achievement, talk or program', { value: '   ' })],
      new Map([live('ev-1')]),
    );
    expect(v.permitted).toBe(false);
  });

  it('requires every hook token the template declares, not just one', () => {
    const note = templateByCode('linkedin_connection_note');
    expect(note.hookTokens.length).toBe(2);
    const v = evaluatePersonalisation(note, [hook('company')], new Map([live('ev-1')]));
    expect(v.permitted).toBe(false);
    expect(v.missingTokens).toEqual(['platform or migration']);
  });

  it('lets the close and the referral ask through without evidence, and says why', () => {
    for (const code of ['polite_close', 'referral_ask']) {
      const v = evaluatePersonalisation(templateByCode(code), [], new Map());
      expect(v.permitted, code).toBe(true);
      expect(v.statement).toMatch(/relationship that already exists/);
    }
  });
});

describe('length ceilings are enforced, not suggested', () => {
  it('rejects an InMail over four hundred characters', () => {
    const problem = checkLength(templateByCode('first_inmail'), 'x'.repeat(401));
    expect(problem).toMatch(/401 characters, over the 400 ceiling/);
    expect(problem).toMatch(/41 percent/);
  });

  it('rejects a first email over one hundred and eighty words', () => {
    expect(checkLength(templateByCode('first_email'), 'word '.repeat(181))).toMatch(/over the 180 ceiling/);
  });

  it('accepts copy inside the ceiling', () => {
    expect(checkLength(templateByCode('first_inmail'), 'Hi there.')).toBeNull();
  });
});

describe('the default sequence', () => {
  it('runs five touches over fourteen to eighteen days with a distinct job each', () => {
    const plan = sequenceFor('senior_executive');
    expect(plan).toHaveLength(6);
    expect(plan.filter((s) => !s.optional)).toHaveLength(5);
    expect(new Set(plan.map((s) => s.purpose)).size).toBe(6);
  });

  it('varies the channel rather than repeating one', () => {
    const channels = sequenceFor('senior_executive').slice(0, 5).map((s) => s.channel);
    expect(new Set(channels).size).toBeGreaterThan(2);
  });

  it('opens differently for the two segments', () => {
    expect(sequenceFor('senior_executive')[0]!.templateCode).toBe('first_inmail');
    expect(sequenceFor('senior_it_consultant')[0]!.templateCode).toBe('linkedin_connection_note');
  });

  it('caps at six and names the reason', () => {
    expect(SEQUENCE_LIMITS.defaultTouches).toBe(5);
    expect(SEQUENCE_LIMITS.absoluteMaximum).toBe(6);
    expect(SEQUENCE_LIMITS.reason).toMatch(/flattens after stage five/);
  });
});
