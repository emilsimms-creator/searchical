import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LlmGateway, ModelOutputError } from '@/llm/gateway';
import {
  jobSpecExtraction, projectPipeline, verifySourceQuotes, type MandateConstraint,
} from '@/mandate';
import { fakeModel, SENIOR_DBA_EXTRACTION } from '../helpers/model';

/**
 * Regression tests for the third live extraction run.
 *
 * The model produced a constraint reading "NERC CIP work typically carries
 * personnel risk assessment and background screening obligations", marked it
 * disqualifying, and attached a source quote that is genuinely in the
 * specification but does not establish the claim. The insight is probably
 * correct and useful; the specification says no such thing. Unflagged, it
 * narrowed the pipeline arithmetic on the strength of the model's background
 * knowledge.
 */
const GRC_SPEC = readFileSync('fixtures/senior-cybersecurity-grc.txt', 'utf8');

const constraint = (over: Partial<MandateConstraint> = {}): MandateConstraint => ({
  kind: 'security_clearance',
  severity: 'disqualifying',
  statement: 'Must be eligible to obtain Secret clearance',
  inferred: false,
  ...over,
});

describe('source quotes are checked against the document they claim to come from', () => {
  it('accepts a quote that is genuinely in the specification', () => {
    const checks = verifySourceQuotes(
      [constraint({ sourceQuote: '10+ years of information security experience in risk management' })],
      GRC_SPEC,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.found).toBe(true);
  });

  it('catches a fabricated quote', () => {
    const checks = verifySourceQuotes(
      [constraint({ sourceQuote: 'Candidates must hold an active Secret clearance before applying' })],
      GRC_SPEC,
    );
    expect(checks[0]!.found).toBe(false);
  });

  it('tolerates reformatting but not invention', () => {
    // Line wrapping, curly quotes and dash styles differ between a document and
    // a quotation of it. The words are what must match.
    const checks = verifySourceQuotes(
      [
        constraint({ sourceQuote: "One or more of CISSP, CRISC, CISM\n  or other relevant   certifications would be an asset" }),
        constraint({ statement: 'invented', sourceQuote: 'One or more of CISSP, CRISC, CISM or ISO 27001 Lead Auditor' }),
      ],
      GRC_SPEC,
    );
    expect(checks[0]!.found).toBe(true);
    expect(checks[1]!.found).toBe(false);
  });

  it('has nothing to check when no quote was offered', () => {
    expect(verifySourceQuotes([constraint({ inferred: true })], GRC_SPEC)).toEqual([]);
  });
});

describe('an inference does not narrow the market on its own authority', () => {
  const stated = constraint({ statement: 'Secret clearance eligibility', inferred: false });
  const guessed = constraint({
    kind: 'security_clearance',
    statement: 'NERC CIP work typically requires a personnel risk assessment',
    inferred: true,
  });

  it('ignores an inferred constraint when counting the narrowing', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 200, constraints: [guessed] });
    expect(p.constrainedMarket).toBe(false);
    expect(p.advice.join(' ')).not.toMatch(/narrows this market/);
  });

  it('surfaces it separately, so the insight is not lost', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 200, constraints: [guessed] });
    expect(p.advice.join(' ')).toMatch(/1 further constraint was inferred rather than stated/);
    expect(p.advice.join(' ')).toMatch(/excluded from the market narrowing above until they are/);
  });

  it('counts the stated one and reports the inferred one alongside it', () => {
    const p = projectPipeline({ targetConversations: 10, longListSize: 200, constraints: [stated, guessed] });
    expect(p.constrainedMarket).toBe(true);
    expect(p.advice.join(' ')).toMatch(/1 disqualifying constraint narrows this market/);
    expect(p.advice.join(' ')).toMatch(/1 further constraint was inferred/);
  });
});

describe('the extraction contract', () => {
  it('requires every constraint to declare whether it was stated or inferred', async () => {
    const withoutFlag = {
      ...SENIOR_DBA_EXTRACTION,
      constraints: [{ kind: 'schedule', severity: 'disqualifying', statement: 'On-call rotation' }],
    };
    await expect(
      new LlmGateway(fakeModel(withoutFlag)).run(jobSpecExtraction, { jobSpec: 'x' }),
    ).rejects.toThrow(ModelOutputError);
  });

  it('tells the model that a present but non-probative quote is the worst case', () => {
    const { system } = jobSpecExtraction.render({ jobSpec: 'x' });
    expect(system).toMatch(/copied VERBATIM from the specification/);
    expect(system).toMatch(/genuinely present but does not itself establish the statement/);
    expect(system).toMatch(/An inference is rarely disqualifying/);
  });
});
