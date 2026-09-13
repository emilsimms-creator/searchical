import { describe, expect, it } from 'vitest';
import { LlmGateway, ModelOutputError } from '@/llm/gateway';
import { deriveIntakeGaps, jobSpecExtraction, toDraft } from '@/mandate';
import { fakeModel, VP_INFRASTRUCTURE_EXTRACTION } from '../helpers/model';

describe('job specification extraction', () => {
  it('parses a well formed extraction into a draft', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'irrelevant' }));

    expect(draft.title).toBe('VP, Infrastructure and Cloud');
    expect(draft.segment).toBe('senior_executive');
    expect(draft.terms.filter((t) => t.kind === 'title_variant')).toHaveLength(4);
    expect(draft.terms.filter((t) => t.kind === 'must_have_skill')).toHaveLength(3);
  });

  it('marks everything the model proposed as proposed, never confirmed', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'irrelevant' }));
    expect(draft.terms.every((t) => t.status === 'proposed')).toBe(true);
    expect(draft.terms.every((t) => t.origin === 'extracted')).toBe(true);
  });

  it('tolerates a model that wraps its JSON in a fence', async () => {
    const gateway = new LlmGateway(
      fakeModel('Here you go:\n```json\n' + JSON.stringify(VP_INFRASTRUCTURE_EXTRACTION) + '\n```'),
    );
    const output = await gateway.run(jobSpecExtraction, { jobSpec: 'irrelevant' });
    expect(output.title).toBe('VP, Infrastructure and Cloud');
  });

  it('rejects malformed output rather than half trusting it', async () => {
    const gateway = new LlmGateway(fakeModel({ title: 'VP Infrastructure' }));
    await expect(gateway.run(jobSpecExtraction, { jobSpec: 'x' })).rejects.toThrow(ModelOutputError);
  });

  it('rejects a segment the model invented', async () => {
    const gateway = new LlmGateway(fakeModel({ ...VP_INFRASTRUCTURE_EXTRACTION, segment: 'middle_manager' }));
    await expect(gateway.run(jobSpecExtraction, { jobSpec: 'x' })).rejects.toThrow(ModelOutputError);
  });

  it('records every call for audit and replay', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    await gateway.run(jobSpecExtraction, { jobSpec: 'x' });
    expect(gateway.records).toHaveLength(1);
    expect(gateway.records[0]).toMatchObject({
      promptId: 'mandate.job_spec_extraction',
      promptVersion: '1.0.0',
      modelId: 'fake-model',
      ok: true,
    });
  });

  it('records a failed call too', async () => {
    const gateway = new LlmGateway(fakeModel({ nonsense: true }));
    await expect(gateway.run(jobSpecExtraction, { jobSpec: 'x' })).rejects.toThrow();
    expect(gateway.records[0]?.ok).toBe(false);
  });
});

describe('intake gaps', () => {
  it('finds nothing to ask when the specification answered everything', async () => {
    const gateway = new LlmGateway(fakeModel(VP_INFRASTRUCTURE_EXTRACTION));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    expect(deriveIntakeGaps(draft)).toEqual([]);
  });

  it('turns a missing career move case into a question for the hiring leader', async () => {
    const gateway = new LlmGateway(fakeModel({ ...VP_INFRASTRUCTURE_EXTRACTION, careerMoveCase: null }));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    const gaps = deriveIntakeGaps(draft);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.field).toBe('careerMoveCase');
    // The question explains the consequence, so it is worth the hiring leader's time.
    expect(gaps[0]!.question).toMatch(/not looking for lateral transfers/);
  });

  it('asks for more market vocabulary when only one title was found', async () => {
    const gateway = new LlmGateway(
      fakeModel({ ...VP_INFRASTRUCTURE_EXTRACTION, titleVariants: [{ term: 'VP Infrastructure', confidence: 0.9 }] }),
    );
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    expect(deriveIntakeGaps(draft).some((g) => g.field === 'title_variants')).toBe(true);
  });

  it('asks for a target company list when the specification gave none', async () => {
    const gateway = new LlmGateway(fakeModel({ ...VP_INFRASTRUCTURE_EXTRACTION, targetCompanies: [] }));
    const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec: 'x' }));
    expect(deriveIntakeGaps(draft).some((g) => g.field === 'target_companies')).toBe(true);
  });
});
