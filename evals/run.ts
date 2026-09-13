/**
 * Eval runner for the mandate extraction prompt.
 *
 *   npm run eval -- --via-cli            one pass over every case
 *   npm run eval -- --via-cli --runs 3   three passes, reporting per-check stability
 *   npm run eval -- --case senior-database-administrator
 *
 * Every pass calls the model once per case, which costs real quota. Nothing is
 * written to a database.
 *
 * Emits results.jsonl and _state.json in the shape the bundled hillclimb report
 * builder consumes, so a report can be rendered over a run without reshaping it.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmGateway } from '@/llm/gateway';
import { claudeModel, MissingCredentialsError } from '@/llm/anthropic';
import { claudeCliModel } from '@/llm/claude-cli';
import { jobSpecExtraction, toDraft } from '@/mandate';
import { runChecks, type CaseExpectation, type CheckResult } from './checks';

interface EvalCase {
  id: string;
  spec: string;
  label: 'positive' | 'negative';
  why: string;
  expect: CaseExpectation;
}

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const runs = Number.parseInt(value('runs', '1'), 10);
const only = argv.includes('--case') ? value('case', '') : null;
const outDir = value('out', 'evals/results');

const cases: EvalCase[] = [];
for (const file of (await readdir('evals/cases')).filter((f) => f.endsWith('.case.json')).sort()) {
  const parsed = JSON.parse(await readFile(join('evals/cases', file), 'utf8')) as EvalCase;
  if (!only || parsed.id === only) cases.push(parsed);
}

const model = flag('via-cli') ? claudeCliModel() : claudeModel();
const rows: Record<string, unknown>[] = [];

console.log(`\nmandate extraction eval · ${cases.length} cases × ${runs} run(s) · model ${model.id}\n`);

for (const evalCase of cases) {
  const jobSpec = await readFile(evalCase.spec, 'utf8');

  for (let run = 1; run <= runs; run += 1) {
    const gateway = new LlmGateway(model);
    const startedAt = Date.now();
    let checks: readonly CheckResult[];
    let extractionError: string | null = null;

    try {
      const draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec }));
      checks = runChecks(draft, evalCase.expect, jobSpec);
    } catch (error) {
      if (error instanceof MissingCredentialsError) {
        console.error(`\n${error.message}\nPass --via-cli to run through the Claude Code CLI instead.\n`);
        process.exit(2);
      }
      // A schema failure IS the result. The first live run of this prompt
      // failed exactly here, and an eval that treats it as a crash rather than
      // a score would have hidden the defect.
      extractionError = (error as Error).message;
      checks = [{ id: 'schema_valid', score: 0, passed: false, detail: extractionError.slice(0, 300) }];
    }

    const durationMs = Date.now() - startedAt;
    const passed = checks.every((c) => c.passed);
    const grade = Object.fromEntries(checks.map((c) => [c.id, c.score]));
    if (!extractionError) grade['schema_valid'] = 1;

    rows.push({
      case_id: evalCase.id,
      run,
      label: evalCase.label,
      passed,
      grade,
      perf: { duration_ms: durationMs, model: model.id },
      detail: Object.fromEntries(checks.map((c) => [c.id, c.detail])),
    });

    const mark = passed ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${evalCase.id}${runs > 1 ? ` (run ${run})` : ''}  ${(durationMs / 1000).toFixed(1)}s`);
    for (const c of checks) {
      if (!c.passed) console.log(`        x ${c.id}: ${c.detail}`);
    }
  }
}

// --- Report -----------------------------------------------------------------

const checkIds = [...new Set(rows.flatMap((r) => Object.keys(r['grade'] as object)))].sort();
const rate = (predicate: (r: Record<string, unknown>) => boolean) =>
  rows.length === 0 ? 0 : rows.filter(predicate).length / rows.length;

console.log('\nper check, across every case and run');
for (const id of checkIds) {
  const scored = rows.filter((r) => id in (r['grade'] as Record<string, number>));
  const passing = scored.filter((r) => (r['grade'] as Record<string, number>)[id]! >= 1).length;
  const bar = '#'.repeat(Math.round((passing / Math.max(scored.length, 1)) * 20)).padEnd(20, '.');
  console.log(`  ${id.padEnd(24)} ${bar} ${passing}/${scored.length}`);
}

// Triage is a classification, so it is reported on its own rather than blended
// into the overall rate: getting the negative case wrong is a different and
// worse failure than missing a required skill.
const triage = rows.filter((r) => (r['grade'] as Record<string, number>)['segment_correct'] !== undefined);
const triageRight = triage.filter((r) => (r['grade'] as Record<string, number>)['segment_correct'] === 1);
const negatives = triage.filter((r) => r['label'] === 'negative');
const negativesRight = negatives.filter((r) => (r['grade'] as Record<string, number>)['segment_correct'] === 1);

console.log(`\ntriage accuracy        ${triageRight.length}/${triage.length}`);
console.log(`  of which negatives   ${negativesRight.length}/${negatives.length}  (force fitting an out of scope role is the expensive error)`);
console.log(`case pass rate         ${(rate((r) => r['passed'] === true) * 100).toFixed(0)}%  (${rows.filter((r) => r['passed']).length}/${rows.length})`);

const avgMs = rows.reduce((sum, r) => sum + ((r['perf'] as { duration_ms: number }).duration_ms), 0) / Math.max(rows.length, 1);
console.log(`mean extraction time   ${(avgMs / 1000).toFixed(1)}s`);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
await writeFile(
  join(outDir, '_state.json'),
  JSON.stringify(
    {
      schema: 'hillclimb/v2',
      metrics: checkIds.map((id) => ({ id, label: id.slice(0, 14) })),
      perf_fields: [{ id: 'duration_ms', label: 'ms' }],
      variants: [{ id: jobSpecExtraction.version, label: `prompt ${jobSpecExtraction.version}` }],
      generated_at: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nresults written to ${outDir}/results.jsonl\n`);

const suitePassed = rows.every((r) => r['passed'] === true);
console.log(suitePassed ? 'SUITE PASSED\n' : 'SUITE FAILED\n');
process.exit(suitePassed ? 0 : 1);
