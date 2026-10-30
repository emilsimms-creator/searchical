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
  verifySourceQuotes, applyTriageOverride, TriageOverrideError, catchmentFor, selectDomainPack, suggestFromPack,
  type MandateTerm, type SupportedSegment,
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

// A recruiter may overrule a refusal on seniority:
//   --override technical_specialist --reason "Client confirms a five year contract coordinator is wanted"
// The refusal is shown first and the overrule is printed beside it, so a report
// can never read as though the model had said yes.
const overrideIndex = process.argv.indexOf('--override');
if (overrideIndex !== -1 && !isSupportedSegment(draft.segment)) {
  const reasonIndex = process.argv.indexOf('--reason');
  const override = {
    segment: process.argv[overrideIndex + 1] as SupportedSegment,
    reason: reasonIndex === -1 ? '' : (process.argv[reasonIndex + 1] ?? ''),
    actor: process.env.SEARCHICAL_OPERATOR ?? 'dry-run',
  };
  try {
    console.log(`  MODEL VERDICT  out_of_scope (${draft.outOfScopeReason ?? 'no reason recorded'})`);
    draft = applyTriageOverride(draft, override, draft.outOfScopeReason);
    console.log(`  OVERRULED      by ${override.actor}, into ${override.segment}`);
    console.log(`  REASON GIVEN   ${override.reason}`);
  } catch (error) {
    if (error instanceof TriageOverrideError) {
      rule('OVERRULE REFUSED');
      console.log(`  ${error.message}`);
      process.exit(0);
    }
    throw error;
  }
}

// Triage first. Everything downstream assumes one of the three segments.
if (!isSupportedSegment(draft.segment)) {
  rule('VERDICT: OUT OF SCOPE');
  console.log('  No channel plan will be produced. The channel matrix rates channels for senior');
  console.log('  executives and senior IT consultants only (technical specialists get a provisional');
  console.log('  plan), and inventing an opinion about a role outside those is how a search gets');
  console.log('  pointed at the wrong market entirely.');
  console.log(`\n  ${draft.segmentRationale}`);
  if (draft.outOfScopeReason === 'seniority') {
    console.log('\n  Refused on seniority, so a recruiter may overrule it:');
    console.log('    --override technical_specialist --reason "<why, at least 30 characters>"');
  }
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

// The three fields most likely to be invented. Found on a live uOttawa run:
// the report showed which were missing but never what the model put in the
// ones it filled, so "never invent" could not be checked by reading it.
rule('PERFORMANCE INTAKE (what the model filled, to be checked against the spec)');
const show = (label: string, value: string | null) =>
  console.log(`  ${label.padEnd(20)} ${value === null || value.trim() === '' ? '(null, becomes a question)' : value}`);
show('first year outcomes', draft.intake.firstYearOutcomes);
show('operating range', draft.intake.operatingRange);
show('career move case', draft.intake.careerMoveCase);
show('compensation', draft.compensation
  ? `${draft.compensation.currency} ${draft.compensation.baseMin ?? '?'} to ${draft.compensation.baseMax ?? '?'} (quote: "${draft.compensation.sourceQuote}")`
  : null);

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

const plan = planChannels(CHANNEL_MATRIX_SEED, draft.segment);
const pack = selectDomainPack({
  segment: draft.segment,
  functionDomain: draft.functionDomain,
  titles: draft.terms.filter((t) => t.kind === 'title_variant').map((t) => t.term),
});

rule('SEARCH STRINGS (as if every term were confirmed)');
const asConfirmed: MandateTerm[] = draft.terms.map((t) => ({ ...t, status: 'confirmed' }));
try {
  const { strings, warnings } = generateSearchStrings({
    terms: asConfirmed,
    location: draft.location,
    skippedChannels: plan.selections.filter((c) => c.priority === 'skip').map((c) => c.channelCode),
    alsoNear: pack ? catchmentFor(pack, draft.location).map((e) => e.name) : [],
  });
  for (const s of strings) console.log(`  [${s.kind}]\n    ${s.value}\n`);
  for (const w of warnings) console.log(`  WARNING (${w.term}): ${w.warning}`);
} catch (error) {
  console.log(`  ${(error as Error).message}`);
}

rule('CHANNEL PLAN');
console.log(`  ${plan.note}\n`);
for (const c of plan.recommended) console.log(`  ${c.fit}/5  ${c.name}\n        ${c.etiquette}`);
console.log(`\n  Skipped (${plan.selections.filter((s) => s.priority === 'skip').length}): ` +
  plan.selections.filter((s) => s.priority === 'skip').map((s) => s.name).join(', '));

if (pack) {
  const suggestion = suggestFromPack(pack, asConfirmed, draft.location);
  rule(`DOMAIN PACK: ${pack.name} (${suggestion.status.toUpperCase()}, discovery surfaces off)`);
  console.log(`  ${pack.summary}\n`);
  const show = (label: string, rows: readonly { name: string; note: string }[]) => {
    console.log(`  ${label}`);
    for (const r of rows) console.log(`    ${r.name}\n      ${r.note}`);
    console.log('');
  };
  show('Title variants the vocabulary does not hold yet (accept with additions, never automatic)', suggestion.suggestedTitleVariants);
  show('Look alikes: the same words, a different market', pack.lookAlikes);
  show('Credentials', pack.credentials);
  for (const c of pack.employerClasses) show(`Employers: ${c.name}`, c.examples);
  show('Bodies a recruiter can approach by hand', pack.bodies);
  show('Also searched, as the work location stays put', suggestion.alsoSearch);
  console.log(`  ${pack.standingExclusion}\n`);
  console.log('  Open questions');
  for (const q of pack.openQuestions) console.log(`    ${q}`);
}

// Who is off limits comes before names. Pass --off-limits "FCI=Fleming Communications Inc.|Fleming Communications"
// (repeatable; aliases after the equals sign, separated by a bar, only once confirmed) to
// show what a screen would hold on. Nothing is written.
const offLimitsNames = process.argv.flatMap((a, i) => (a === '--off-limits' ? [process.argv[i + 1] ?? ''] : []))
  .filter((n) => n.trim() !== '');
rule('OFF LIMITS (settle before any names are worked)');
if (offLimitsNames.length === 0) {
  console.log('  None recorded. Ask the client who is off limits: their own staff are always out, and for a');
  console.log('  contract role so are their current vendors and consultants until they say otherwise.');
} else {
  for (const raw of offLimitsNames) {
    const [name, aliases] = raw.split('=');
    console.log(`  ${name}${aliases ? `  (also: ${aliases.split('|').join('; ')})` : ''}`);
    console.log('    a screen holds anyone whose evidence names this, and a person checks');
  }
  console.log('\n  Aliases are not guessed. Add one only once somebody has confirmed it is the same organisation.');
  console.log('  Set the same company as an exclusion in the LinkedIn Recruiter company filter by hand.');
}

rule('PIPELINE');
const pipeline = projectPipeline({ targetConversations: 10, longListSize: 75, constraints: draft.constraints });
console.log(`  ${pipeline.workings}`);
for (const line of pipeline.advice) console.log(`  ${line}`);

rule('MODEL CALLS');
for (const r of gateway.records) console.log(`  ${r.promptId}@${r.promptVersion} on ${r.modelId} in ${r.durationMs}ms (ok=${r.ok})`);
