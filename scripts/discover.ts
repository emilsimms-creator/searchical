/**
 * Show what the discovery layer would do for a mandate, without a key.
 *
 * Prints the source catalogue with its terms position, the query it would fire
 * at each surface and why, and, when a real provider is configured, the leads
 * that came back. Run it with BRAVE_SEARCH_API_KEY set to make live calls.
 *
 *   npm run discover -- <fixture.txt>
 *   npm run discover -- <fixture.txt> --live
 */
import { readFileSync } from 'node:fs';
import {
  DISCOVERY_SOURCES, braveSearchProvider, generateDiscoveryQueries, harvest, harvestSummary,
} from '@/discovery';
import type { MandateTerm, SupportedSegment } from '@/mandate/types';

const rule = (label: string) =>
  console.log(`\n${'-'.repeat(74)}\n${label}\n${'-'.repeat(74)}`);

/**
 * A stand in for a confirmed mandate vocabulary.
 *
 * The real path takes this from `mandate_terms` where a human moved each row to
 * confirmed. This script accepts a plain list so the discovery layer can be
 * exercised without running an extraction first.
 */
function vocabularyFrom(lines: readonly string[]): MandateTerm[] {
  const terms: MandateTerm[] = [];
  let kind: MandateTerm['kind'] = 'title_variant';
  let rank = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.toLowerCase().startsWith('titles:')) { kind = 'title_variant'; rank = 1; continue; }
    if (line.toLowerCase().startsWith('skills:')) { kind = 'must_have_skill'; rank = 1; continue; }
    terms.push({
      kind, term: line, origin: 'recruiter', status: 'confirmed',
      observedCount: null, rank: rank++,
    });
  }
  return terms;
}

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const file = args.find((a) => !a.startsWith('--'));
  const segment: SupportedSegment =
    args.includes('--executive') ? 'senior_executive' : 'senior_it_consultant';

  const terms = file
    ? vocabularyFrom(readFileSync(file, 'utf8').split('\n'))
    : vocabularyFrom(['titles:', 'Vice President, Engineering', 'skills:', 'Kubernetes', 'Terraform']);

  rule('DISCOVERY SOURCES');
  for (const s of DISCOVERY_SOURCES.filter((s) => s.segments.includes(segment))) {
    const state = s.terms.verified
      ? (s.persistence === 'persist' ? 'may record' : 'pointer only')
      : 'TERMS UNREAD, pointer only';
    console.log(`  ${s.name}\n    ${state} · ${s.regions.join(' ')}\n    ${s.terms.citation}`);
    if (s.terms.openQuestion) console.log(`    open: ${s.terms.openQuestion}`);
  }

  const { queries, warnings } = generateDiscoveryQueries({
    terms, segment, location: args.includes('--executive') ? 'Toronto, Ontario' : null,
  });

  rule('QUERIES');
  for (const q of queries) {
    console.log(`  [${q.sourceId}]\n    ${q.query}\n    why: ${q.rationale}\n`);
  }
  for (const w of warnings) console.log(`  WARNING: ${w}\n`);

  if (!live) {
    console.log('\n  Add --live with BRAVE_SEARCH_API_KEY set to run these against the web.');
    return;
  }

  rule('LEADS');
  const result = await harvest(braveSearchProvider(), queries, { limitPerQuery: 10, region: 'CA' });
  for (const lead of result.leads) {
    console.log(`  ${lead.disposition === 'may_persist' ? '[record]' : '[open it]'} ${lead.title}`);
    console.log(`    ${lead.url}  (${lead.sourceId})`);
  }
  console.log(`\n  ${harvestSummary(result)}`);
  for (const f of result.failures) console.log(`  FAILED ${f.sourceId}: ${f.reason}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
