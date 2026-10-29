import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { harness, seedTenant, type Harness } from '../helpers/db';
import {
  ALGONQUIN_NETWORK_DESIGNER_EXTRACTION, VP_INFRASTRUCTURE_EXTRACTION, fakeModel,
} from '../helpers/model';
import { LlmGateway } from '@/llm/gateway';
import { searchableSources } from '@/discovery/sources';
import {
  DOMAIN_PACKS, INFRASTRUCTURE_CABLING_PACK, MandateService, catchmentFor, generateSearchStrings,
  selectDomainPack, seedChannelRatings, suggestFromPack, type MandateTerm, type PackEntry,
} from '@/mandate';

const allEntries = (): { where: string; entry: PackEntry }[] => {
  const p = INFRASTRUCTURE_CABLING_PACK;
  return [
    ...p.titleVariants.map((entry) => ({ where: 'titleVariants', entry })),
    ...p.lookAlikes.map((entry) => ({ where: 'lookAlikes', entry })),
    ...p.skills.map((entry) => ({ where: 'skills', entry })),
    ...p.credentials.map((entry) => ({ where: 'credentials', entry })),
    ...p.employerClasses.flatMap((c) => c.examples.map((entry) => ({ where: `employers/${c.id}`, entry }))),
    ...p.bodies.map((entry) => ({ where: 'bodies', entry })),
    ...p.catchments.flatMap((c) => c.alsoSearch.map((entry) => ({ where: 'catchments', entry }))),
  ];
};

const term = (kind: MandateTerm['kind'], t: string, status: MandateTerm['status'] = 'confirmed'): MandateTerm => ({
  kind, term: t, origin: 'recruiter', status, observedCount: null, rank: 1,
});

describe('the infrastructure and cabling pack', () => {
  it('says where every entry came from and when it was collected', () => {
    expect(allEntries().length).toBeGreaterThan(30);
    for (const { where, entry } of allEntries()) {
      const label = `${where}: ${entry.name}`;
      expect(entry.note.length, label).toBeGreaterThan(20);
      expect(entry.evidence.citation.length, label).toBeGreaterThan(10);
      expect(entry.evidence.retrievedOn, label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A page claim carries its address. Only a document the practice holds, a
      // search summary whose link was not identified, or an instruction may go without one.
      if (entry.evidence.url === null) {
        expect(['job_specification', 'model_extraction', 'operator_instruction', 'web_search_snippet'], label)
          .toContain(entry.evidence.via);
      } else {
        expect(entry.evidence.url, label).toMatch(/^https:\/\//);
      }
    }
  });

  it('is entirely unverified today, so the first verified entry has to be deliberate', () => {
    for (const { where, entry } of allEntries()) {
      expect(entry.verification.status, `${where}: ${entry.name}`).toBe('unverified');
      if (entry.verification.status === 'unverified') {
        expect(entry.verification.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('keeps every discovery surface off, and the segments it serves have none either', () => {
    expect(INFRASTRUCTURE_CABLING_PACK.discoverySurfaces).toHaveLength(0);
    expect(searchableSources('technical_specialist')).toHaveLength(0);
  });

  it('says nothing about pay, which this mandate set aside', () => {
    const blob = JSON.stringify(INFRASTRUCTURE_CABLING_PACK, (_k, v) => (v instanceof RegExp ? v.source : v));
    expect(blob).not.toMatch(/\$\s?\d|per hour|an hour|hourly|salary|wage|compensation/i);
  });

  it('names organisations and no individual, because a person is a record and this is a pack', () => {
    // Every example is an organisation: none carries a person's role title as its name.
    for (const c of INFRASTRUCTURE_CABLING_PACK.employerClasses) {
      for (const e of c.examples) expect(e.name, e.name).not.toMatch(/\b(Mr|Ms|Dr)\b\.?|\bchair\b/i);
    }
  });

  it('keeps the client out and the client\'s vendors out until the client says otherwise', () => {
    expect(INFRASTRUCTURE_CABLING_PACK.standingExclusion).toMatch(/client's own staff/);
    expect(INFRASTRUCTURE_CABLING_PACK.standingExclusion).toMatch(/current cabling vendors and consultants/);
    expect(INFRASTRUCTURE_CABLING_PACK.openQuestions.join(' ')).toMatch(/non solicit/);
  });

  it('separates look alikes from the market, so a designer is not mistaken for another designer', () => {
    const names = INFRASTRUCTURE_CABLING_PACK.lookAlikes.map((l) => l.name);
    expect(names).toContain('OSP Network Designer');
    const titles = INFRASTRUCTURE_CABLING_PACK.titleVariants.map((t) => t.name);
    for (const lookalike of names) expect(titles).not.toContain(lookalike);
  });
});

describe('choosing a pack', () => {
  it('serves a technical specialist in this domain', () => {
    const pack = selectDomainPack({
      segment: 'technical_specialist',
      functionDomain: 'IT infrastructure: structured cabling and physical technology infrastructure for construction projects',
      titles: ['Network Designer'],
    });
    expect(pack?.id).toBe('infrastructure_cabling');
  });

  it('serves a senior consultant in the same domain, because the domain does not change with the band', () => {
    expect(selectDomainPack({ segment: 'senior_it_consultant', functionDomain: 'structured cabling design', titles: [] })).not.toBeNull();
  });

  it('offers nothing to a mandate it knows nothing about, rather than a guess', () => {
    expect(selectDomainPack({ segment: 'technical_specialist', functionDomain: 'Identity and access management', titles: ['IAM Architect'] })).toBeNull();
    expect(selectDomainPack({ segment: 'senior_executive', functionDomain: 'Engineering leadership', titles: ['VP Engineering'] })).toBeNull();
    // The executive segment is not in this pack's segments, even for a matching domain.
    expect(selectDomainPack({ segment: 'senior_executive', functionDomain: 'structured cabling', titles: [] })).toBeNull();
    expect(DOMAIN_PACKS.length).toBeGreaterThan(0);
  });
});

describe('Gatineau', () => {
  const pack = INFRASTRUCTURE_CABLING_PACK;

  it('is searched as well as Ottawa, and the work location does not move', () => {
    expect(catchmentFor(pack, 'Ottawa, Ontario').map((e) => e.name)).toEqual(['Gatineau, Quebec']);
    const note = catchmentFor(pack, 'Ottawa, Ontario')[0]!.note;
    expect(note).toMatch(/work location stays Ottawa/);
    expect(note).toMatch(/French/);
  });

  it('is not added to a search that is not in Ottawa, or has no place', () => {
    expect(catchmentFor(pack, 'Toronto, Ontario')).toEqual([]);
    expect(catchmentFor(pack, null)).toEqual([]);
  });

  const confirmed = [term('title_variant', 'Network Designer'), term('must_have_skill', 'structured cabling')];

  it('reaches the strings that carry a place, as a group', () => {
    const { strings } = generateSearchStrings({ terms: confirmed, location: 'Ottawa, Ontario', alsoNear: ['Gatineau, Quebec'] });
    const xray = strings.find((s) => s.kind === 'conference_talks_xray')!.value;
    expect(xray).toContain('("Ottawa, Ontario" OR "Gatineau, Quebec")');
    const provider = JSON.parse(strings.find((s) => s.kind === 'provider_query')!.value);
    expect(provider.location).toBe('Ottawa, Ontario');
    expect(provider.alsoWithin).toEqual(['Gatineau, Quebec']);
  });

  it('leaves the LinkedIn Boolean without a place, because Recruiter takes location as a filter', () => {
    const { strings } = generateSearchStrings({ terms: confirmed, location: 'Ottawa, Ontario', alsoNear: ['Gatineau, Quebec'] });
    expect(strings.find((s) => s.kind === 'linkedin_recruiter_boolean')!.value).not.toMatch(/Gatineau|Ottawa/);
  });

  it('changes nothing when no catchment is given', () => {
    const plain = generateSearchStrings({ terms: confirmed, location: 'Ottawa, Ontario' });
    const empty = generateSearchStrings({ terms: confirmed, location: 'Ottawa, Ontario', alsoNear: [] });
    expect(empty).toEqual(plain);
    const provider = JSON.parse(plain.strings.find((s) => s.kind === 'provider_query')!.value);
    expect(provider).not.toHaveProperty('alsoWithin');
  });

  it('adds a catchment only to a search that has a place to widen', () => {
    const { strings } = generateSearchStrings({ terms: confirmed, location: null, alsoNear: ['Gatineau, Quebec'] });
    expect(strings.map((s) => s.value).join(' ')).not.toMatch(/Gatineau/);
  });
});

describe('what a pack suggests', () => {
  it('leaves out what the vocabulary already holds and never offers a rejected term twice as new', () => {
    const terms = [term('title_variant', 'Network Designer'), term('title_variant', 'ICT Infrastructure Designer', 'rejected'), term('must_have_skill', 'structured cabling')];
    const s = suggestFromPack(INFRASTRUCTURE_CABLING_PACK, terms, 'Ottawa, Ontario');
    const titles = s.suggestedTitleVariants.map((e) => e.name);
    expect(titles).not.toContain('Network Designer');
    expect(titles).toContain('ICT Infrastructure Designer');
    expect(s.suggestedSkills.map((e) => e.name)).not.toContain('structured cabling');
    expect(s.status).toBe('unverified');
  });
});

describe('through the mandate service', () => {
  let h: Harness;
  let tenant: string;

  beforeEach(async () => {
    h = await harness();
    tenant = (await seedTenant(h.app, 'Domain Pack Test')).id;
    await h.app.withTenant(tenant, (tx) => seedChannelRatings(tx, tenant));
  });

  afterEach(async () => h?.close());

  const service = (tx: Parameters<Parameters<Harness['app']['withTenant']>[1]>[0], response: unknown) =>
    new MandateService(tx, new LlmGateway(fakeModel(response)), null);

  it('suggests the pack on the draft without putting any of it into the vocabulary', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx, ALGONQUIN_NETWORK_DESIGNER_EXTRACTION).draftFromJobSpec({ jobSpec: 'x', actor: { id: 'emil' }, tenantId: tenant }),
    );
    expect(drafted.domainPack?.pack.id).toBe('infrastructure_cabling');
    expect(drafted.domainPack?.status).toBe('unverified');
    expect(drafted.domainPack?.alsoSearch.map((e) => e.name)).toEqual(['Gatineau, Quebec']);
    const proposed = drafted.vocabulary.terms.map((t) => t.term);
    // Suggested, not proposed: the pack's extra titles are not terms until accepted.
    expect(drafted.domainPack!.suggestedTitleVariants.map((e) => e.name)).toContain('Structured Cabling Analyst');
    expect(proposed).not.toContain('Structured Cabling Analyst');
  });

  it('offers nothing for a mandate the pack does not cover', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx, VP_INFRASTRUCTURE_EXTRACTION).draftFromJobSpec({ jobSpec: 'x', actor: { id: 'emil' }, tenantId: tenant }),
    );
    expect(drafted.domainPack).toBeUndefined();
  });

  it('adds Gatineau to the plan\'s strings once the recruiter has confirmed, and still adds no vocabulary of its own', async () => {
    const drafted = await h.app.withTenant(tenant, (tx) =>
      service(tx, ALGONQUIN_NETWORK_DESIGNER_EXTRACTION).draftFromJobSpec({ jobSpec: 'x', actor: { id: 'emil' }, tenantId: tenant }),
    );
    await h.app.withTenant(tenant, (tx) =>
      service(tx, {}).confirmVocabulary({
        mandateId: drafted.mandateId, tenantId: tenant, actor: { id: 'emil' },
        decisions: [
          { kind: 'title_variant', term: 'Network Designer', decision: 'confirm' },
          { kind: 'must_have_skill', term: 'structured cabling', decision: 'confirm' },
        ],
        additions: [{ kind: 'title_variant', term: 'Structured Cabling Analyst' }],
      }),
    );
    const plan = await h.app.withTenant(tenant, (tx) => service(tx, {}).buildSearchPlan({ mandateId: drafted.mandateId, tenantId: tenant }));

    expect(plan.domainPack?.pack.id).toBe('infrastructure_cabling');
    expect(plan.channels.provisional).toBe(true);
    const provider = JSON.parse(plan.strings.strings.find((s) => s.kind === 'provider_query')!.value);
    expect(provider.location).toBe('Ottawa, Ontario');
    expect(provider.alsoWithin).toEqual(['Gatineau, Quebec']);
    // The recruiter's own addition is in. Nothing else from the pack is.
    expect(provider.anyOfTitles).toContain('Structured Cabling Analyst');
    expect(provider.anyOfTitles).not.toContain('Telecommunications Specialist');
  });
});
