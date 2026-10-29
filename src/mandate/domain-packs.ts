import type { MandateTerm, SupportedSegment } from './types';

/**
 * Domain packs: what is known about where a kind of practitioner actually is.
 *
 * The channel matrix is domain blind by construction. It rates channels for a
 * segment, and a segment is a seniority band, so a network designer and a
 * platform engineer in the same band get the same plan. The uOttawa run found
 * this for identity roles, and the Algonquin tender found it for cabling: the
 * people who coordinate structured cabling are not on GitHub and do not speak at
 * developer conferences. They are found through their employers, their trade
 * credentials and the bodies that connect them to construction.
 *
 * A pack is therefore knowledge, not a search surface. It suggests vocabulary,
 * names the employer classes and credentials, and lists the bodies a recruiter
 * can approach by hand. It never enables an automated query, which is the part
 * that needs a terms position read and dated (see src/discovery/sources.ts).
 *
 * Every entry says where it came from and whether anyone has read the source.
 * Nothing here is verified yet, and the types make promoting an entry cost a
 * name and a date.
 */

/** Who has read the source, and when. An entry cannot become verified without both. */
export type Verification =
  | { readonly status: 'unverified'; readonly reason: string }
  | { readonly status: 'verified'; readonly readOn: string; readonly readBy: string };

export type EvidenceVia =
  | 'job_specification'
  | 'model_extraction'
  | 'job_posting'
  | 'directory_listing'
  | 'procurement_notice'
  | 'web_search_snippet'
  | 'operator_instruction';

export interface PackEvidence {
  readonly citation: string;
  /** Null where the evidence is a document the practice holds, not a page. */
  readonly url: string | null;
  /** The day the evidence was collected, ISO. Not the day a page was last changed. */
  readonly retrievedOn: string;
  readonly via: EvidenceVia;
}

export interface PackEntry {
  readonly name: string;
  readonly note: string;
  readonly evidence: PackEvidence;
  readonly verification: Verification;
}

export interface EmployerClass {
  readonly id: string;
  readonly name: string;
  /** Why people with this capability work here. */
  readonly why: string;
  /** Named organisations. Leads for a human to check, never added to the watchlist unread. */
  readonly examples: readonly PackEntry[];
}

export interface DomainPack {
  readonly id: string;
  readonly name: string;
  /** The segments this knowledge applies to. The domain is the same across senior bands. */
  readonly segments: readonly SupportedSegment[];
  /** Matched against the mandate's function domain and confirmed or proposed titles. */
  readonly matches: RegExp;
  readonly summary: string;
  readonly titleVariants: readonly PackEntry[];
  /** Roles that look the same on a search page and are a different market. */
  readonly lookAlikes: readonly PackEntry[];
  readonly skills: readonly PackEntry[];
  readonly credentials: readonly PackEntry[];
  readonly employerClasses: readonly EmployerClass[];
  /** Bodies a recruiter can approach by hand. References, not search surfaces. */
  readonly bodies: readonly PackEntry[];
  /** Places close enough to the work location to search as well. Keyed by a lower case fragment of the work location. */
  readonly catchments: readonly { readonly workLocationMatches: RegExp; readonly alsoSearch: readonly PackEntry[] }[];
  /** Who is never a target, whoever the client is. */
  readonly standingExclusion: string;
  readonly openQuestions: readonly string[];
  /**
   * Always empty. A pack suggests; it does not search. Adding a surface is a
   * discovery decision that needs its terms read and dated first.
   */
  readonly discoverySurfaces: readonly never[];
}

const COLLECTED = '2026-10-29';

const search = (citation: string, url: string, via: EvidenceVia = 'web_search_snippet'): PackEvidence => ({
  citation, url, retrievedOn: COLLECTED, via,
});

const unread = (reason: string): Verification => ({ status: 'unverified', reason });

const FROM_SNIPPET = 'Collected from a search result snippet. The page itself has not been read.';
const FROM_SPEC =
  'Taken from one job specification and a model extraction of it. Not yet checked against how the market writes its own profiles.';

const SPEC: PackEvidence = {
  citation: 'Algonquin College Network Designer tender, October 2026 (fixtures/network-designer-algonquin.txt)',
  url: null,
  retrievedOn: COLLECTED,
  via: 'job_specification',
};

const modelTitle = (name: string, confidence: number): PackEntry => ({
  name,
  note: `Proposed by the live extraction of the tender at confidence ${confidence}.`,
  evidence: { ...SPEC, via: 'model_extraction' },
  verification: unread(FROM_SPEC),
});

const specSkill = (name: string, note: string): PackEntry => ({
  name, note, evidence: SPEC, verification: unread(FROM_SPEC),
});

/**
 * Structured cabling, telecommunications infrastructure and the technology side
 * of construction.
 *
 * Built from the Algonquin tender and one round of open web search on 29 October
 * 2026. The sites that would settle most of it (BICSI, Job Bank) were not
 * reachable from the session, so every entry is a lead.
 */
export const INFRASTRUCTURE_CABLING_PACK: DomainPack = {
  id: 'infrastructure_cabling',
  name: 'Structured cabling and physical technology infrastructure',
  segments: ['technical_specialist', 'senior_it_consultant'],
  matches:
    /structured cabling|cabling|telecommunications (distribution|infrastructure|design)|physical (technology |network )?infrastructure|low voltage|\bICT (infrastructure|design)\b/i,
  summary:
    'The people who coordinate, design and accept structured cabling for buildings. They are found through ' +
    'cabling contractors, design and engineering firms, and the facilities and IT teams of large institutions, ' +
    'not through developer communities or technology conferences. Nothing in this pack is verified.',

  titleVariants: [
    {
      name: 'Structured Cabling Analyst',
      note: 'A federal institution used this title for an Ottawa posting that closed in November 2025.',
      evidence: search('Senate of Canada posting on Jobs.ca', 'https://www.jobs.ca/job/9747e187-826a-431c-bb35-7388ade92346', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'Telecommunications Specialist',
      note: 'An engineering consultancy advertised this for Montreal or Ottawa.',
      evidence: search('Telecom Specialist posting on SnapJobSearch', 'https://ca.snapjobsearch.com/jobs/view/2236608', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'Telecommunications Design Technician',
      note: 'The design side of the market: a consultancy with an Ottawa energy and telecommunications group. Likely below the band, so check the experience asked for.',
      evidence: search('Design Technician, Energy and Telecommunications, Stantec Ottawa', 'https://stantec.jobs/ottawa-on/design-technician-energy-telecommunications/58E13C2BF5724630BFAB46A944A78781/job', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
    modelTitle('Structured Cabling Designer', 0.55),
    modelTitle('Network Designer', 0.5),
    modelTitle('Telecommunications Designer', 0.45),
    modelTitle('Structured Cabling Project Coordinator', 0.45),
    modelTitle('Telecommunications Project Manager', 0.35),
    modelTitle('Low Voltage Project Manager', 0.35),
    modelTitle('ICT Infrastructure Designer', 0.3),
    modelTitle('Telecommunications Distribution Designer', 0.3),
  ],

  lookAlikes: [
    {
      name: 'OSP Network Designer',
      note: 'Outside plant design for carriers, such as RF design for cable television networks. Shares the word designer and almost nothing else with building cabling.',
      evidence: search('Senior OSP Network Designer, Ottawa', 'https://www.jobleads.com/ca/job/senior-osp-network-designer--ottawa--eb8ac1fb2c316872d01aaa3305c95eea9', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'Network Systems Analyst',
      note: 'IP network operations: assessments, troubleshooting and upgrades. The same buildings, a different discipline.',
      evidence: search('Network Systems Analyst 2, The Ottawa Hospital', 'https://www.jobleads.com/ca/job/network-systems-analyst-2--ottawa--e8ac9ad277d91d1548e85582219d0610e', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'Structured Cabling Technician',
      note: 'Hands on installation work. Plentiful in Ottawa listings and below the coordination band this role asks for, so it is a pool to refer from and not to approach.',
      evidence: search('Structured cabling technician listings, Ottawa', 'https://ca.indeed.com/Cabling-jobs-in-Ottawa,-ON', 'job_posting'),
      verification: unread(FROM_SNIPPET),
    },
  ],

  skills: [
    specSkill('structured cabling', 'The core of the role, stated in the opening requirement.'),
    specSkill('fibre optic cabling', 'Copper and fibre installation, testing and certification.'),
    specSkill('telecommunications rooms', 'Pathways, spaces and equipment racks.'),
    specSkill('as-built documentation', 'Drawings, test results and deficiency logs at close out.'),
    specSkill('construction drawings', 'Reviewing architectural, electrical and communications drawings.'),
    specSkill('Power over Ethernet', 'Switch and access point dependencies of a cabling design.'),
    specSkill('Move, Add and Change', 'The College calls this MAC. Other organisations may use another name for it.'),
  ],

  credentials: [
    {
      name: 'BICSI RCDD (Registered Communications Distribution Designer)',
      note: 'The flagship design credential. The tender names BICSI credentials or training as an asset. Eligibility rules differ between the third party guides found and have not been read at the source.',
      evidence: search('Credly: BICSI RCDD badge', 'https://www.credly.com/org/bicsi/badge/rcdd'),
      verification: unread('Eligibility and renewal terms come from third party study sites that disagree. BICSI was not reachable from the session.'),
    },
    {
      name: 'BICSI Technician (TECH)',
      note: 'One of the credentials BICSI\'s certification institute holds. Third party guides describe an active technical credential such as this as supporting RCDD eligibility.',
      evidence: search('BICSI ICT Certification Institute launch coverage', 'https://www.cablinginstall.com/standards/article/14283414/bicsi-bicsi-ict-certification-institute-launches'),
      verification: unread('Third party description only.'),
    },
    {
      name: 'BICSI Installer 1 and Installer 2 (Copper, Fiber)',
      note: 'The installer track. Holders are more likely to be the technicians this role coordinates than coordinators themselves.',
      evidence: search('BICSI ICT Certification Institute launch coverage', 'https://www.cablinginstall.com/standards/article/14283414/bicsi-bicsi-ict-certification-institute-launches'),
      verification: unread('Third party description only.'),
    },
    {
      name: 'BICSI Registered Telecommunications Project Manager (RTPM)',
      note: 'The project management credential. Named by a search summary of third party RCDD guides as a credential that can support RCDD eligibility.',
      evidence: { citation: 'Search summary of third party RCDD guides, which disagree with one another. The specific guide was not identified.', url: null, retrievedOn: COLLECTED, via: 'web_search_snippet' },
      verification: unread('Third party guides only, and the specific guide was not identified.'),
    },
  ],

  employerClasses: [
    {
      id: 'cabling_contractors',
      name: 'Cabling and ICT contractors',
      why: 'They employ the people who coordinate installations, and often the credentialed installers and designers behind them. They are also the client\'s likely vendors, which makes them the class most exposed to a non solicit.',
      examples: [
        { name: 'Stratus51', note: 'Lists communication wiring, structured cabling and fibre and copper installation in Ottawa.', evidence: search('Stratus51 directory entry', 'https://startpage.mapquest.com/ca/ontario/stratus51-708408587', 'directory_listing'), verification: unread('Directory entry. Credentials and size unknown.') },
        { name: 'Maverickstech', note: 'Offers data cabling and rack work for Ottawa offices and commercial buildings.', evidence: search('Maverickstech page', 'https://maverickstech.ca/?p=26179', 'directory_listing'), verification: unread('Company page seen as a snippet. Credentials unknown.') },
        { name: 'NuEdge Communications', note: 'Lists voice, data and fibre optic cabling in Ottawa.', evidence: search('NuEdge Communications profile', 'https://www.designnominees.com/sites/nuedge-communications', 'directory_listing'), verification: unread('Directory profile. Credentials unknown.') },
        { name: 'Ainger Cabling + Security', note: 'Appears through an Ottawa job advert for a senior cabling technician.', evidence: search('Ottawa cabling job listings', 'https://ca.indeed.com/Cabling-jobs-in-Ottawa,-ON', 'job_posting'), verification: unread('Job advert only. No company page read.') },
        { name: 'Marcomm Integrated Business Solutions (a division of Telecon)', note: 'A search summary said it was hiring structured cabling technicians in Ottawa.', evidence: { citation: 'Search summary of Ottawa structured cabling adverts. The advert link was not identified.', url: null, retrievedOn: COLLECTED, via: 'web_search_snippet' }, verification: unread('Search summary only. No advert or company page read.') },
        { name: 'Ainsworth, OZZ Electric, Plan Group, Connex, LanX, Paladin', note: 'Six suppliers named on a federal standing arrangement for structured cabling contractors, split into unionized and non unionized categories. The buyer and any Ottawa presence are not confirmed.', evidence: search('CanadaBuys standing arrangement award notice', 'https://canadabuys.canada.ca/en/tender-opportunities/award-notice/mx-42843238829', 'procurement_notice'), verification: unread('Award notice seen as a snippet. Buyer and locations unconfirmed.') },
      ],
    },
    {
      id: 'design_consultancies',
      name: 'Engineering and design firms with a telecommunications group',
      why: 'Building cabling is designed alongside electrical and mechanical systems, so the designers sit inside engineering consultancies.',
      examples: [
        { name: 'Stantec (Ottawa energy and telecommunications group)', note: 'Advertised a telecommunications design technician in Ottawa. Whether it employs RCDD holders is not established.', evidence: search('Stantec Ottawa posting', 'https://stantec.jobs/ottawa-on/design-technician-energy-telecommunications/58E13C2BF5724630BFAB46A944A78781/job', 'job_posting'), verification: unread(FROM_SNIPPET) },
      ],
    },
    {
      id: 'institutional_it_facilities',
      name: 'Institutional IT and facilities teams',
      why: 'Hospitals and universities run continuous construction and renovation, and hold standing teams that coordinate the technology side of it.',
      examples: [
        { name: 'The Ottawa Hospital', note: 'Advertises network roles. A cabling coordination role there is not established.', evidence: search('Network Systems Analyst 2 posting', 'https://www.jobleads.com/ca/job/network-systems-analyst-2--ottawa--e8ac9ad277d91d1548e85582219d0610e', 'job_posting'), verification: unread(FROM_SNIPPET) },
        { name: 'CHEO', note: 'Advertised a manager of electrical and communications systems within facilities. Senior to this band, and a sign of where the function sits.', evidence: search('CHEO posting on Jobs.ca', 'https://www.jobs.ca/job/ba243e75-9451-4e81-aeaa-37997fc7cc27', 'job_posting'), verification: unread(FROM_SNIPPET) },
        { name: 'University of Ottawa', note: 'A procurement notice for contracted cabling work, which shows demand and suggests the work is bought in.', evidence: search('University of Ottawa procurement listing', 'https://starbridge.ai/buyer/university-of-ottawa/rfps', 'procurement_notice'), verification: unread('Aggregator listing. The notice itself has not been read.') },
      ],
    },
    {
      id: 'federal_institutions',
      name: 'Federal institutions',
      why: 'Large employers of cabling and telecommunications staff in the capital, directly and through procurement.',
      examples: [
        { name: 'Senate of Canada', note: 'Advertised a structured cabling analyst. The posting closed in November 2025.', evidence: search('Structured Cabling Analyst posting', 'https://www.jobs.ca/job/9747e187-826a-431c-bb35-7388ade92346', 'job_posting'), verification: unread(FROM_SNIPPET) },
        { name: 'Shared Services Canada', note: 'Issued an invitation to qualify for government managed cabling services in 2019. Procurement history only, and whether it employs the practitioners is not established.', evidence: search('SSC invitation to qualify, 2019', 'https://canadabuys.canada.ca/documents/pub/att/2019/10/31/196317e470f2f517cdc424d7a5bb49a6/gmcs_itq_amd002_eng.pdf', 'procurement_notice'), verification: unread(FROM_SNIPPET) },
      ],
    },
  ],

  bodies: [
    {
      name: 'Ottawa Construction Association',
      note: 'Runs a construction symposium and trade show in April (22 April 2026 at the EY Centre, over 160 exhibitors) and a chair\'s reception in October. Both for 2026 have passed, and no later event was found.',
      evidence: search('OCA 2026 symposium listing', 'https://electricalindustry.ca/education-events/2026-oca-construction-symposium-trade-show/'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'Electrical Contractors\' Association of Ottawa',
      note: 'Represents unionized electrical contractors in the Ottawa area. No event listing was found.',
      evidence: search('ECA Ottawa company profile', 'https://village.ai/company/ecaott', 'directory_listing'),
      verification: unread('Directory profile only.'),
    },
    {
      name: 'OACETT Ottawa Chapter',
      note: 'Engineering technicians and technologists. Its last dated event found was an annual meeting and networking mixer on 27 March 2025.',
      evidence: search('OACETT Ottawa chapter event page', 'https://oacett.org/event-calendar/ottawa-annual-chapter-meeting-networking-mixer'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'IEEE Ottawa Section and its Communications Society chapter',
      note: 'The section calendar showed an annual meeting at the end of October. The communications chapter page showed only 2018 and 2019 archives.',
      evidence: search('IEEE Ottawa Communications Society chapter page', 'https://ottawa.chapters.comsoc.org/?p=352'),
      verification: unread(FROM_SNIPPET),
    },
    {
      name: 'BICSI, Canadian region',
      note: '2015 trade coverage named a Canadian regional director on its board, and the current structure is not confirmed. No Ottawa or Eastern Ontario chapter was found, which is not the same as finding there is none. No BICSI conference in Canada was found for 2026.',
      evidence: search('BICSI Canadian Director announcement, 2015 coverage', 'https://www.canadianelectricalwholesaler.ca/?p=21353'),
      verification: unread('BICSI\'s own site was not reachable from the session.'),
    },
  ],

  catchments: [
    {
      workLocationMatches: /\bottawa\b/i,
      alsoSearch: [
        {
          name: 'Gatineau, Quebec',
          note:
            'Added at the operator\'s instruction on 29 October 2026 as close to Ottawa. The work location stays ' +
            'Ottawa: this widens where a person may live, not where the role is. Whether French is needed, and how ' +
            'a Quebec resident working on site in Ontario is handled, are not established.',
          evidence: {
            citation: 'Operator instruction, 29 October 2026', url: null, retrievedOn: COLLECTED, via: 'operator_instruction',
          },
          verification: unread('A search decision, not a finding about the market.'),
        },
      ],
    },
  ],

  standingExclusion:
    'The client\'s own staff and anyone under a non solicit or off limits agreement are never targets. For a ' +
    'contract role that includes the client\'s current cabling vendors and consultants until the client says otherwise.',

  openQuestions: [
    'Does BICSI run an Ottawa or Eastern Ontario chapter, and does it publish a searchable credential directory? On what terms? BICSI\'s site could not be read.',
    'Which cabling vendors and consultants does the client use today, and is there a non solicit agreement? Ask before any contractor is approached.',
    'Does the unionized and non unionized split in the federal standing arrangement affect who can take this contract? Not established.',
    'Is French a requirement or an asset? It decides how much of the Gatineau pool is reachable.',
    'Which college programmes feed this role locally? Not researched.',
    'Are the postings found still open? None was checked for currency.',
  ],

  discoverySurfaces: [],
};

export const DOMAIN_PACKS: readonly DomainPack[] = [INFRASTRUCTURE_CABLING_PACK];

export interface PackSelectionInput {
  readonly segment: SupportedSegment;
  readonly functionDomain: string;
  readonly titles: readonly string[];
}

/** The pack for a mandate, or null. A mandate with no pack gets no suggestion, never a guess. */
export function selectDomainPack(input: PackSelectionInput): DomainPack | null {
  const haystack = [input.functionDomain, ...input.titles].join(' | ');
  return DOMAIN_PACKS.find((p) => p.segments.includes(input.segment) && p.matches.test(haystack)) ?? null;
}

/** Places to search as well as the work location, for a mandate. */
export function catchmentFor(pack: DomainPack, workLocation: string | null): readonly PackEntry[] {
  if (!workLocation) return [];
  return pack.catchments.filter((c) => c.workLocationMatches.test(workLocation)).flatMap((c) => c.alsoSearch);
}

export interface DomainPackSuggestion {
  readonly pack: DomainPack;
  /** Title variants and skills the pack knows that the mandate's vocabulary does not hold yet. */
  readonly suggestedTitleVariants: readonly PackEntry[];
  readonly suggestedSkills: readonly PackEntry[];
  /** Locations to search as well as the work location. */
  readonly alsoSearch: readonly PackEntry[];
  /** Every entry is unverified today. Stated on the suggestion so a screen cannot omit it. */
  readonly status: 'unverified' | 'partly_verified';
}

const has = (terms: readonly MandateTerm[], kind: MandateTerm['kind'], name: string): boolean =>
  terms.some((t) => t.kind === kind && t.status !== 'rejected' && t.term.trim().toLowerCase() === name.toLowerCase());

/**
 * What a pack offers a mandate. Suggestions only: nothing here enters the
 * vocabulary, because the confirmation gate is the recruiter's, and the
 * recruiter adds what they accept through `additions`.
 */
export function suggestFromPack(
  pack: DomainPack,
  terms: readonly MandateTerm[],
  workLocation: string | null,
): DomainPackSuggestion {
  const entries = [
    ...pack.titleVariants, ...pack.lookAlikes, ...pack.skills, ...pack.credentials,
    ...pack.employerClasses.flatMap((c) => c.examples), ...pack.bodies,
  ];
  return {
    pack,
    suggestedTitleVariants: pack.titleVariants.filter((e) => !has(terms, 'title_variant', e.name)),
    suggestedSkills: pack.skills.filter((e) => !has(terms, 'must_have_skill', e.name)),
    alsoSearch: catchmentFor(pack, workLocation),
    status: entries.every((e) => e.verification.status === 'unverified') ? 'unverified' : 'partly_verified',
  };
}
