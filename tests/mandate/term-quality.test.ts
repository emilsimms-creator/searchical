import { describe, expect, it } from 'vitest';
import { LlmGateway, ModelOutputError } from '@/llm/gateway';
import { jobSpecExtraction, toDraft } from '@/mandate';
import { fakeModel, SENIOR_DBA_EXTRACTION } from '../helpers/model';

/**
 * Regression tests for what the first real extraction run produced.
 *
 * Running a live model over the Senior Database Administrator specification
 * produced terms that read as an excellent summary of the role and match nobody
 * on any platform, and a location field containing a whole sentence that went
 * straight into two search queries. Fixtures could never have caught either:
 * the fixtures were written by hand and were already well formed.
 */
const withTerm = (kind: 'mustHaveSkills' | 'titleVariants' | 'exclusions', term: string) =>
  ({ ...SENIOR_DBA_EXTRACTION, [kind]: [{ term, confidence: 0.9 }] });

const run = (payload: unknown) =>
  new LlmGateway(fakeModel(payload)).run(jobSpecExtraction, { jobSpec: 'x' });

describe('a search term must be searchable', () => {
  it('rejects the description that the real run produced', async () => {
    await expect(
      run(withTerm('mustHaveSkills',
        'Azure database platforms (Azure SQL Managed Instance, Azure Database for PostgreSQL, Oracle Database@Azure)')),
    ).rejects.toThrow(ModelOutputError);
  });

  it('rejects a term carrying an explanatory bracket', async () => {
    await expect(
      run(withTerm('mustHaveSkills', 'Database migration (cutover)')),
    ).rejects.toThrow(/brackets or semicolons/);
  });

  it('rejects a term that is a sentence', async () => {
    await expect(
      run(withTerm('mustHaveSkills', 'The person must know Oracle.')),
    ).rejects.toThrow(/not a sentence/);
  });

  it('rejects a term too long to be anything but a description', async () => {
    await expect(
      run(withTerm('titleVariants', 'Senior Database Administrator responsible for cloud migration work')),
    ).rejects.toThrow(/token a person writes on their profile/);
  });

  it('accepts the tokens people actually write on a profile', async () => {
    for (const term of ['Oracle', 'SQL Server', 'Azure SQL Managed Instance', 'Always On Availability Groups', 'Oracle RAC']) {
      await expect(run(withTerm('mustHaveSkills', term)), term).resolves.toBeDefined();
    }
  });

  it('allows a comma where the market writes one in a title', async () => {
    // "Director, Cloud Infrastructure" and "VP, Engineering" are real titles.
    for (const term of ['Director, Cloud Infrastructure', 'VP, Engineering']) {
      await expect(run(withTerm('titleVariants', term)), term).resolves.toBeDefined();
    }
  });

  it('drops a term the model repeated at two confidences', async () => {
    const output = await run({
      ...SENIOR_DBA_EXTRACTION,
      titleVariants: [
        { term: 'Lead Database Administrator', confidence: 0.62 },
        { term: 'Senior Database Administrator', confidence: 0.9 },
        { term: 'lead database administrator', confidence: 0.55 },
      ],
    });
    const titles = toDraft(output).terms.filter((t) => t.kind === 'title_variant');
    expect(titles).toHaveLength(2);
    expect(titles.map((t) => t.term)).toEqual(['Lead Database Administrator', 'Senior Database Administrator']);
  });
});

describe('location must be a place, not a paragraph', () => {
  it('rejects the sentence the real run produced', async () => {
    await expect(
      run({
        ...SENIOR_DBA_EXTRACTION,
        location:
          "Canada — the specification requires living in Canada within reasonable commuting distance of the Bank's office, but names no city or region.",
      }),
    ).rejects.toThrow(/place name/);
  });

  it('accepts a place, and accepts null', async () => {
    for (const location of ['Ottawa', 'Ottawa, Ontario', 'Toronto or Montreal', null]) {
      await expect(run({ ...SENIOR_DBA_EXTRACTION, location }), String(location)).resolves.toBeDefined();
    }
  });
});

describe('the prompt is generated from the schema', () => {
  /**
   * The first real run failed on every enum because the prompt described the
   * fields in prose while only the schema knew the permitted values. This test
   * is the guard against that ever being true again.
   */
  const { system } = jobSpecExtraction.render({ jobSpec: 'x' });

  it('names every permitted segment', () => {
    for (const v of ['senior_executive', 'senior_it_consultant', 'out_of_scope']) {
      expect(system, v).toContain(`"${v}"`);
    }
  });

  it('names every permitted constraint kind and severity', () => {
    for (const v of [
      'security_clearance', 'citizenship_or_status', 'location_or_onsite', 'schedule',
      'language', 'licence_or_credential', 'prior_experience', 'travel', 'other',
      'disqualifying', 'strong_preference', 'nice_to_have',
    ]) {
      expect(system, v).toContain(`"${v}"`);
    }
  });

  it('names every permitted target company kind and engagement type', () => {
    for (const v of ['competitor', 'academy', 'adjacent_sector', 'client_named', 'late_stage',
                     'permanent', 'contract', 'either', 'unstated']) {
      expect(system, v).toContain(`"${v}"`);
    }
  });

  it('states the array caps that the schema enforces', () => {
    expect(system).toMatch(/at most 8 items/);
    expect(system).toMatch(/at most 6 items/);
    expect(system).toMatch(/at most 4 items/);
  });

  it('states that confidence is a number', () => {
    expect(system).toMatch(/confidence is a NUMBER between 0 and 1/);
  });
});
