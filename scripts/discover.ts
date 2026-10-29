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
import { fixtureSearchProvider, type SearchHit } from '@/discovery';
import { Promoter, httpPageFetcher, type PageFetcher } from '@/discovery';
import { promoteAndRescreen, screenLeads, screeningSummary } from '@/screening';
import type { MandateConstraint, MandateTerm, SupportedSegment } from '@/mandate/types';

/** Stand in results, so the screen can be demonstrated without a search key. */
const SAMPLE: SearchHit[] = [
  { url: 'https://kubecon.example.org/speakers/ada-okafor', rank: 1,
    title: 'Ada Okafor, VP Engineering at Example Corp',
    snippet: 'Session: running Kubernetes across three regions, and what Terraform could not fix.' },
  { url: 'https://kubecon.example.org/speakers/rav-menon', rank: 2,
    title: 'Rav Menon, Junior Platform Engineer',
    snippet: 'Lightning talk on Kubernetes operators.' },
  { url: 'https://kubecon.example.org/attendees/list', rank: 3,
    title: 'Someone who was there', snippet: 'Attended the conference.' },
];

/** A recorded page, so promotion can be demonstrated without reaching the web. */
const SAMPLE_FETCHER: PageFetcher = {
  id: 'sample',
  async fetchText(url) {
    if (url.endsWith('/robots.txt')) {
      return { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /attendees' };
    }
    if (url.includes('ada-okafor')) {
      return {
        status: 200, contentType: 'text/html',
        body: '<html><body><h1>Ada Okafor</h1>' +
          '<p itemprop="addressLocality">Toronto, Ontario</p>' +
          '<p>Vice President, Engineering at Example Corp. Runs Kubernetes across three regions ' +
          'with Terraform.</p></body></html>',
      };
    }
    return { status: 404, contentType: 'text/html', body: 'Not found' };
  },
};

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
    if (line.toLowerCase().startsWith('exclusions:')) { kind = 'exclusion'; rank = 1; continue; }
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
    args.includes('--executive') ? 'senior_executive'
      : args.includes('--specialist') ? 'technical_specialist'
      : 'senior_it_consultant';

  const terms = file
    ? vocabularyFrom(readFileSync(file, 'utf8').split('\n'))
    : vocabularyFrom([
        'titles:', 'Vice President, Engineering',
        'skills:', 'Kubernetes', 'Terraform',
        'exclusions:', 'Junior', 'Intern',
      ]);

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

  // A worked example of the screen, so the layer is visible without a key.
  const constraints: MandateConstraint[] = [
    { kind: 'security_clearance', severity: 'disqualifying', inferred: false,
      statement: 'Must be eligible to obtain Secret clearance.' },
    { kind: 'citizenship_or_status', severity: 'disqualifying', inferred: false,
      statement: 'Priority to Canadian citizens and permanent residents.' },
    { kind: 'location_or_onsite', severity: 'strong_preference', inferred: false,
      statement: 'On site twelve days a month.' },
  ];

  const provider = live
    ? braveSearchProvider()
    // Only the conference query returns sample hits, so the demo shows a
    // surface that can actually be fetched rather than one held at pointer only.
    : fixtureSearchProvider(new Map(
        queries.map((q) => [q.query, q.sourceId === 'conference_programmes' ? SAMPLE : []]),
      ));

  rule('LEADS');
  const result = await harvest(provider, queries, { limitPerQuery: 10, region: 'CA' });
  for (const lead of result.leads) {
    console.log(`  ${lead.disposition === 'may_persist' ? '[record]' : '[open it]'} ${lead.title}`);
    console.log(`    ${lead.url}  (${lead.sourceId})`);
  }
  console.log(`\n  ${harvestSummary(result)}`);
  for (const f of result.failures) console.log(`  FAILED ${f.sourceId}: ${f.reason}`);

  rule(live ? 'SCREENED' : 'SCREENED (against sample leads, since no key is set)');
  for (const s of screenLeads(result.leads, terms, constraints)) {
    console.log(`  ${s.verdict.toUpperCase().padEnd(8)} ${s.lead.title}`);
    console.log(`    ${s.headline}`);
    for (const m of s.matches) console.log(`    + ${m.statement}`);
    for (const c of s.concerns) console.log(`    - ${c.statement}`);
    for (const q of s.openQuestions) console.log(`    ? [${q.kind}] ${q.question}`);
    if (s.prohibitedChecksSkipped.length > 0) {
      console.log(`    ! not screened, protected ground: ${s.prohibitedChecksSkipped.join(', ')}`);
    }
    console.log('');
  }
  const screened = screenLeads(result.leads, terms, constraints);
  console.log(`  ${screeningSummary(screened, terms)}`);

  rule(live ? 'PROMOTED TO PROFILE DEPTH' : 'PROMOTED TO PROFILE DEPTH (against a sample page)');
  const fetcher: PageFetcher = live ? httpPageFetcher() : SAMPLE_FETCHER;
  const promoter = new Promoter(fetcher);
  const promoted = await promoteAndRescreen(screened, promoter, terms, constraints);
  for (const item of promoted) {
    const depth = item.depth === 'profile' ? 'read the page' : 'snippet only';
    console.log(`  ${item.verdict.toUpperCase().padEnd(8)} ${item.lead.title}  (${depth})`);
    if (item.promotion && !item.promotion.promoted) {
      console.log(`    not read: ${item.promotion.refusal!.reason} · ${item.promotion.refusal!.detail}`);
    }
    if (item.promotion?.promoted) {
      console.log(`    retention: ${item.promotion.retention}`);
    }
    if (item.promotion && item.promotion.chain.length > 1) {
      console.log(`    redirected: ${item.promotion.chain.join(' -> ')}`);
    }
    console.log(`    ${item.headline}`);
    console.log('');
  }
  const spend = promoter.spend();
  console.log(`  Load: ${spend.total} request(s) across ${spend.byHost.size} host(s), ` +
    `budget ${spend.budget.perHost} per host and ${spend.budget.total} in total.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
