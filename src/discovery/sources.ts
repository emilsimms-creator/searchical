import type { DiscoverySource } from './types';

/**
 * Where this system looks for senior technology people on the open web.
 *
 * WHY THIS FILE EXISTS
 *
 * The autonomous sourcing tools in this market advertise searching "the whole
 * web" against an index of roughly eight hundred million profiles. That number
 * is not the size of anything they crawl. It is the standard size of the
 * licensed people data aggregate layer, and the vendors who sell that layer
 * describe it candidly: Coresignal's employee dataset of the same order is
 * "aggregated from multiple public sources, primarily LinkedIn, but also
 * alternative professional networks, public CV databases, and other web
 * sources". SeekOut and Juicebox quote the same magnitude from "dozens of data
 * sources".
 *
 * So "searches the whole web" in this market usually means a licensed aggregate
 * whose backbone is LinkedIn derived data, plus a contact enrichment vendor,
 * plus some genuine open web search on top. Searchical refuses the first of
 * those on the evidence recorded in architecture.md s10: the hiQ consent
 * judgment of December 2022 and the permanent injunction that shut Proxycurl
 * down in July 2025. What is left is the third, done properly, plus a
 * contracted provider that can answer the lawful basis question in writing.
 *
 * This catalogue is the honest version of the reach those tools advertise. It
 * names every surface, what a senior person is doing there, and what that
 * surface's terms actually permit. It is deliberately code rather than a
 * document, so it cannot drift away from the system that acts on it.
 *
 * THE VERIFICATION RULE
 *
 * A source whose terms are unverified cannot be enabled for persistence. Most
 * entries below are honest about not having been read yet, and that is the
 * point: an unread terms position is a liability that looks like a feature.
 * `enabledSources` enforces it, and the tests hold the line.
 */
export const DISCOVERY_SOURCES: readonly DiscoverySource[] = [
  {
    id: 'linkedin_public_xray',
    name: 'LinkedIn public profiles, via search engine X-ray',
    access: 'search_xray',
    persistence: 'manual_entry_only',
    // The User Agreement prohibits automated access, so the page is never
    // fetched by this system at any depth. A human opens it on their own seat.
    automatedFetch: 'never',
    site: 'linkedin.com/in',
    yields: ['identity', 'employer'],
    whySeniorPeopleAreHere:
      'Near universal coverage of senior technology people in North America and western Europe. ' +
      'It is the reason every tool in this market ends up pointing at LinkedIn one way or another.',
    segments: ['senior_executive', 'senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'AU', 'IN', 'BR'],
    terms: {
      summary:
        'A search engine may be asked which public profiles exist; the result is a pointer, not a ' +
        'record. LinkedIn\'s User Agreement prohibits scraping, copying and using software to ' +
        'extract data, so nothing from this surface reaches the ledger except what a named human ' +
        'reads on their own licensed seat and types. This is the same position the connector ' +
        'contract already enforces in the type system.',
      citation: 'https://www.linkedin.com/legal/user-agreement',
      verified: true,
      verifiedOn: '2026-09-17',
      openQuestion: null,
    },
    etiquette:
      'A pointer to open and read, never a record to keep. Automated InMail or connection ' +
      'sequences breach the User Agreement whatever a competitor advertises.',
  },
  {
    id: 'github_xray',
    name: 'GitHub profiles and contributions, via search engine X-ray',
    access: 'search_xray',
    persistence: 'manual_entry_only',
    automatedFetch: 'robots_permitting',
    site: 'github.com',
    yields: ['identity', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'Public commit history is the strongest available evidence of what someone can actually ' +
      'build, and a maintainer listing on a significant project is a shortlist of one.',
    segments: ['senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'IN', 'BR', 'AU', 'JP'],
    terms: {
      summary:
        'GitHub\'s Acceptable Use Policies prohibit using information from the service, whether ' +
        'scraped, taken through the API or obtained otherwise, for spamming, which they define to ' +
        'include sending unsolicited emails to users and selling personal information to ' +
        'recruiters, headhunters and job boards. Collected personal information may be used only ' +
        'for the purpose the user authorised, and do not contact requests must be honoured ' +
        'promptly. Reading a public profile to identify someone is not prohibited; harvesting ' +
        'commit emails to mail them is, and so is selling anything from here.',
      citation: 'https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies',
      verified: true,
      verifiedOn: '2026-09-17',
      openQuestion:
        'Whether a retained search firm contacting someone about a specific role falls inside ' +
        '"the purpose for which the User has authorized it". Counsel should settle this before ' +
        'the surface is enabled for persistence.',
    },
    etiquette:
      'Never use an email address found in a commit. Cite the specific repository or contribution ' +
      'in the first touch, and reach the person on a channel they chose to be reachable on.',
  },
  {
    id: 'conference_programmes',
    name: 'Conference and summit speaker programmes',
    access: 'search_xray',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'employer', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'A speaker list is a pre vetted shortlist. Someone accepted to speak has been judged senior ' +
      'and credible by a programme committee, has published their employer and topic themselves, ' +
      'and has given you the specific verifiable hook the personalisation gate requires.',
    segments: ['senior_executive', 'senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'AU'],
    terms: {
      summary:
        'Per event, and genuinely varied. A programme published to advertise the event is ' +
        'published by the speaker\'s own choice and names them in a professional capacity, which ' +
        'is the shape Canadian private sector privacy law contemplates for publicly available ' +
        'information. Each event still has its own site terms.',
      citation: 'per-event://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'Terms are per event and must be recorded per event. The connector should refuse an event ' +
        'whose terms have not been read, rather than treat "it is on the public internet" as a ' +
        'licence.',
    },
    etiquette:
      'Cite the talk, not the person\'s employer. A speaker who published a session abstract ' +
      'expects to be asked about the session.',
  },
  {
    id: 'foundation_contributors',
    name: 'Open source foundation contributor and maintainer lists (CNCF, Apache, Linux Foundation)',
    access: 'directory',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'employer', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'Foundations publish governance rosters, technical oversight committees and maintainer ' +
      'lists as a matter of transparency. These are the most senior practitioners in a technology, ' +
      'named by the foundation itself.',
    segments: ['senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'IN', 'JP', 'AU'],
    terms: {
      summary:
        'Published deliberately as governance transparency, generally under an open licence. The ' +
        'specific licence differs per foundation and must be recorded per foundation.',
      citation: 'per-foundation://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion: 'Read and record each foundation\'s licence before enabling it individually.',
    },
    etiquette:
      'A governance roster is a transparency artefact, never a mailing list. Engage through the ' +
      'project if the project is the connection.',
  },
  {
    id: 'vendor_ambassador_programmes',
    name: 'Vendor ambassador and expert programmes (AWS Community Builders, Microsoft MVP, Google Developer Experts)',
    access: 'directory',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'employer', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'The vendor has already assessed depth in its own technology and published the result. For ' +
      'a mandate that names a specific platform, this is the highest signal to noise surface on ' +
      'the open web.',
    segments: ['senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'IN', 'BR', 'AU', 'JP'],
    terms: {
      summary:
        'Each programme publishes a searchable directory and each has its own site terms. Some ' +
        'state explicitly that the directory is for community connection rather than recruitment.',
      citation: 'per-programme://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'Several of these directories restrict commercial use. Read each before enabling; the ' +
        'restriction is the kind that is easy to miss and expensive to discover.',
    },
    etiquette: 'Name the specific programme and what they contributed to it.',
  },
  {
    id: 'orcid',
    name: 'ORCID researcher registry',
    access: 'directory',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: 'orcid.org',
    yields: ['identity', 'employer', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'Applied research leadership, machine learning and quantitative roles. Every record is ' +
      'created and maintained by the researcher themselves, which makes it the cleanest consent ' +
      'position of any surface here.',
    segments: ['senior_it_consultant', 'senior_executive'],
    regions: ['CA', 'US', 'GB', 'EU', 'AU', 'JP', 'IN'],
    terms: {
      summary:
        'ORCID publishes a public API and the record holder controls what is public. The visibility ' +
        'setting is the researcher\'s own act, which is as close to express publication as this ' +
        'catalogue gets.',
      citation: 'https://info.orcid.org/what-is-orcid/services/public-api/',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'Confirm the public API terms and the data licence before enabling. Not yet read: this ' +
        'entry is a candidate, not a cleared source.',
    },
    etiquette: 'Reference the specific work, which is the whole reason the record exists.',
  },
  {
    id: 'corporate_leadership_pages',
    name: 'Company leadership and about pages',
    access: 'search_xray',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'employer', 'trigger'],
    whySeniorPeopleAreHere:
      'Executive search runs on knowing who currently holds a role at a target company. A ' +
      'leadership page is the employer\'s own published statement of that, and a change to it is ' +
      'an employer level trigger the receptivity engine already knows how to fan out.',
    segments: ['senior_executive'],
    regions: ['CA', 'US', 'GB', 'EU', 'AU'],
    terms: {
      summary:
        'Published by the employer about a person in their professional capacity, which is the ' +
        'clearest case of publicly available information in this catalogue. Site terms still vary ' +
        'and robots directives still bind.',
      citation: 'per-company://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion: 'Record the robots position and site terms per company before fetching.',
    },
    etiquette:
      'A leadership page tells you the role, not that the person wants to hear from you. It is an ' +
      'identification surface.',
  },
  {
    id: 'regulatory_filings',
    name: 'Corporate registries and securities filings (SEDAR+, Companies House, EDGAR)',
    access: 'directory',
    persistence: 'persist',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'employer', 'trigger'],
    whySeniorPeopleAreHere:
      'Officers and directors are named in statutory filings. For the most senior mandates this ' +
      'is authoritative in a way no aggregated profile is, and a filing is itself a dated event.',
    segments: ['senior_executive'],
    regions: ['CA', 'GB', 'US'],
    terms: {
      summary:
        'Published under statute for public inspection. Each registry has its own reuse licence ' +
        'and several restrict bulk redistribution.',
      citation: 'per-registry://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'Read each registry\'s reuse licence. Statutory publication is not the same as permission ' +
        'to build a product on the bulk data.',
    },
    etiquette: 'Authoritative on the role. Says nothing whatever about receptivity.',
  },
  {
    id: 'technical_writing',
    name: 'Personal engineering blogs, dev.to and Hashnode',
    access: 'search_xray',
    persistence: 'manual_entry_only',
    automatedFetch: 'robots_permitting',
    site: null,
    yields: ['identity', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'Someone who writes publicly about a migration they led has handed you the hook and the ' +
      'evidence in one artefact.',
    segments: ['senior_it_consultant', 'senior_executive'],
    regions: ['CA', 'US', 'GB', 'EU', 'IN', 'AU'],
    terms: {
      summary:
        'Per site, and a personal blog has no terms at all in most cases. Held at manual entry ' +
        'until a position is recorded, because "no stated terms" is not the same as permission.',
      citation: 'per-site://terms-recorded-on-source',
      verified: false,
      verifiedOn: null,
      openQuestion: 'Decide the house position on personal sites with no published terms.',
    },
    etiquette: 'Quote the piece accurately or do not mention it.',
  },
  {
    id: 'stack_overflow',
    name: 'Stack Overflow profiles and answers',
    access: 'search_xray',
    persistence: 'manual_entry_only',
    automatedFetch: 'robots_permitting',
    site: 'stackoverflow.com',
    yields: ['identity', 'skill_evidence'],
    whySeniorPeopleAreHere:
      'Sustained high reputation in a specific tag is durable evidence of depth, and the tags map ' +
      'cleanly onto the skills a mandate names.',
    segments: ['senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'IN', 'BR'],
    terms: {
      summary:
        'NOT VERIFIED. Stack Overflow blocks the user agent used to check this, so the terms have ' +
        'not been read and nothing here should be treated as a position. Held at manual entry ' +
        'until a human reads them.',
      citation: 'https://stackoverflow.com/legal/terms-of-service',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'Read the terms of service and the data licence. Recruiting use of the public data dump ' +
        'in particular needs an explicit answer.',
    },
    etiquette: 'Reference the specific answer, not the reputation number.',
  },
  {
    id: 'licensed_provider',
    name: 'Contracted people data provider',
    access: 'licensed',
    persistence: 'persist',
    // Reached through its own API under contract, never by fetching pages.
    automatedFetch: 'never',
    site: null,
    yields: ['identity', 'employer', 'contact', 'trigger'],
    whySeniorPeopleAreHere:
      'This is the surface that turns an identification into a reachable person at volume, and it ' +
      'is the difference between real global reach and aspirational global reach. It is also the ' +
      'one place where the lawful basis question has a contractual answer rather than an argument.',
    segments: ['senior_executive', 'senior_it_consultant'],
    regions: ['CA', 'US', 'GB', 'EU', 'AU', 'IN', 'BR', 'JP'],
    terms: {
      summary:
        'Whatever the contract says, and nothing else. The bake off should turn on two questions ' +
        'rather than on coverage claims: on what lawful basis was this data collected, and will ' +
        'you indemnify us. A provider whose index is rebadged scraped data fails the first ' +
        'question however good the second answer sounds.',
      citation: 'contract://not-yet-executed',
      verified: false,
      verifiedOn: null,
      openQuestion:
        'No provider contracted. This is the open decision already recorded in the executive ' +
        'summary, and it gates real reach on every other surface here.',
    },
    etiquette:
      'A licensed record is still a person. The send gate and the suppression list apply exactly ' +
      'as they do to anything else.',
  },
];

/**
 * The sources that may actually write to the ledger.
 *
 * Unverified terms means manual entry at most, whatever the catalogue entry
 * says it yields. This is the same shape as the mandate vocabulary gate and the
 * compensation band: the cautious state is the default and a human with a date
 * against their name is the only thing that moves it.
 */
export const enabledSources = (): readonly DiscoverySource[] =>
  DISCOVERY_SOURCES.filter((s) => s.persistence === 'persist' && s.terms.verified);

/** Everything that can be searched, including the pointer only surfaces. */
export const searchableSources = (segment: DiscoverySource['segments'][number]) =>
  DISCOVERY_SOURCES.filter((s) => s.segments.includes(segment));

export const sourceById = (id: string): DiscoverySource | undefined =>
  DISCOVERY_SOURCES.find((s) => s.id === id);
