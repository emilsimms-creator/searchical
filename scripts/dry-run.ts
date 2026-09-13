/**
 * Run a job specification through the Mandate Engine and print what it says.
 *
 *   npm run mandate:dry-run -- fixtures/nav-canada-technologist.txt
 *
 * Nothing is written to a database: this is the engine talking, so you can see
 * whether the output is something a recruiter would actually run before any of
 * it is persisted. Needs Anthropic credentials (ANTHROPIC_API_KEY, or a profile
 * from `ant auth login`).
 */
import { readFile } from 'node:fs/promises';
import { LlmGateway } from '@/llm/gateway';
import { claudeModel, MissingCredentialsError } from '@/llm/anthropic';
import { claudeCliModel } from '@/llm/claude-cli';
import {
  CHANNEL_MATRIX_SEED, deriveIntakeGaps, generateSearchStrings, isSupportedSegment,
  jobSpecExtraction, planChannels, projectPipeline, toDraft, validateVocabulary,
  verifySourceQuotes, type MandateTerm,
} from '@/mandate';

const path = process.argv[2];
if (!path) {
  console.error('usage: npm run mandate:dry-run -- <path-to-job-spec.txt>');
  process.exit(1);
}

const rule = (title: string) => console.log(`\n${'-'.repeat(72)}\n${title}\n${'-'.repeat(72)}`);

const jobSpec = await readFile(path, 'utf8');
// --via-cli runs through the Claude Code CLI instead of the API, for machines
// that have Claude Code installed but no API key configured.
const viaCli = process.argv.includes('--via-cli');
const gateway = new LlmGateway(viaCli ? claudeCliModel() : claudeModel());

rule('EXTRACTION');
let draft;
try {
  draft = toDraft(await gateway.run(jobSpecExtraction, { jobSpec }));
} catch (error) {
  if (error instanceof MissingCredentialsError) {
    console.error(`  ${error.message}`);
    process.exit(2);
  }
  throw error;
}
console.log(`  title      ${draft.title}`);
console.log(`  segment    ${draft.segment}`);
console.log(`  rationale  ${draft.segmentRationale}`);
console.log(`  domain     ${draft.functionDomain}`);
console.log(`  location   ${draft.location ?? '(not stated)'}`);
console.log(`  engagement ${draft.engagementType}`);

// Triage first. Everything downstream assumes one of the two segments.
if (!isSupportedSegment(draft.segment)) {
  rule('VERDICT: OUT OF SCOPE');
  console.log('  No channel plan will be produced. The channel matrix rates channels for senior');
  console.log('  executives and senior IT consultants only, and inventing an opinion about a role');
  console.log('  outside those two is how a search gets pointed at the wrong market entirely.');
  console.log(`\n  ${draft.segmentRationale}`);
  process.exit(0);
}

rule('CONSTRAINTS (requirements that are not search terms)');
if (draft.constraints.length === 0) console.log('  None stated.');
for (const c of draft.constraints) {
  const tag = c.inferred ? 'INFERRED, confirm with client' : c.severity.toUpperCase();
  console.log(`  ${tag.padEnd(30)} [${c.kind}] ${c.statement}`);
  if (c.sourceQuote) console.log(`    source: "${c.sourceQuote}"`);
}

// Every quote is checked against the document it claims to come from.
const checks = verifySourceQuotes(draft.constraints, jobSpec);
const unverified = checks.filter((c) => !c.found);
console.log(`\n  ${checks.length - unverified.length} of ${checks.length} source quotes verified against the specification.`);
for (const u of unverified) {
  console.log(`  NOT FOUND IN SOURCE: "${u.quote}"\n    claimed for: ${u.statement}`);
}

rule('INTAKE GAPS (questions for the hiring leader)');
const gaps = deriveIntakeGaps(draft);
if (gaps.length === 0) console.log('  None. The specification answered everything.');
for (const g of gaps) console.log(`  [${g.field}]\n    ${g.question}`);

rule('MARKET VOCABULARY');
const vocabulary = await validateVocabulary(
  draft.terms,
  { targetCompanies: draft.targetCompanies.map((c) => c.name), location: draft.location },
  null, // no provider contracted yet
);
console.log(`  ${vocabulary.note}\n`);
for (const t of vocabulary.terms) {
  const count = t.observedCount === null ? 'unchecked' : `${t.observedCount} observed`;
  const confidence = t.extractionConfidence === undefined ? '' : ` conf ${t.extractionConfidence}`;
  console.log(`  ${t.kind.padEnd(16)} ${t.term.padEnd(42)} ${count}${confidence}`);
}

rule('SEARCH STRINGS (as if every term were confirmed)');
const asConfirmed: MandateTerm[] = draft.terms.map((t) => ({ ...t, status: 'confirmed' }));
try {
  const { strings, warnings } = generateSearchStrings({ terms: asConfirmed, location: draft.location });
  for (const s of strings) console.log(`  [${s.kind}]\n    ${s.value}\n`);
  for (const w of warnings) console.log(`  WARNING (${w.term}): ${w.warning}`);
} catch (error) {
  console.log(`  ${(error as Error).message}`);
}

rule('CHANNEL PLAN');
const plan = planChannels(CHANNEL_MATRIX_SEED, draft.segment);
console.log(`  ${plan.note}\n`);
for (const c of plan.recommended) console.log(`  ${c.fit}/5  ${c.name}\n        ${c.etiquette}`);
console.log(`\n  Skipped (${plan.selections.filter((s) => s.priority === 'skip').length}): ` +
  plan.selections.filter((s) => s.priority === 'skip').map((s) => s.name).join(', '));

rule('PIPELINE');
const pipeline = projectPipeline({ targetConversations: 10, longListSize: 75, constraints: draft.constraints });
console.log(`  ${pipeline.workings}`);
for (const line of pipeline.advice) console.log(`  ${line}`);

rule('MODEL CALLS');
for (const r of gateway.records) console.log(`  ${r.promptId}@${r.promptVersion} on ${r.modelId} in ${r.durationMs}ms (ok=${r.ok})`);
