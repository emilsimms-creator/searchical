# The third segment, and the recruiter's overrule

**Status:** Complete. 492 tests passing, typecheck clean, and the live extraction eval passing 7 of 7 cases (run before the domain pack, which does not touch extraction).
**Audience:** Engineers, and the recruiter who will use the override and has to defend it later.
**Found by:** the Algonquin College Network Designer tender, run through the Mandate Engine on 28 October 2026.

## What the tender showed

A real specification for a contract Network Designer in Ottawa went through live extraction twice.
Both runs returned `out_of_scope`, and both said in their own rationale that the role was borderline
and that a recruiter might reasonably overrule it. The reasons were consistent: a stated minimum of
five years of progressively responsible experience, a title with no seniority marker, and work that
coordinates rather than carries design authority.

The system then gave the recruiter no way to act on that. A refusal was final. That is two defects
in one: the practice has real demand in a band below the senior consultant, and triage will always
have a boundary that the model will sometimes sit on the wrong side of.

## Two changes, one defect

**A third segment, `technical_specialist`.** Experienced hands on practitioners and coordinators who
work without supervision but do not carry design authority over an architecture or run a function:
network designers, infrastructure and cabling coordinators, systems and network administrators,
senior technicians and analysts. Typically about five years of progressively responsible experience
stated as a minimum, usually on contract. Entry level, trainee and no minimum years remain out of
scope, and the NAV CANADA Technologist is still refused.

**A recruiter's overrule that is recorded.** `MandateService.overrideTriage` takes a refused mandate,
a segment, a reason and a named person, and puts the mandate back on the normal path. It does not
skip anything after triage: the mandate lands as `awaiting_confirmation` and the vocabulary gate
still stands.

## What can and cannot be overruled

**Only a refusal on seniority can be overruled.** A refusal on domain says the role is outside
technology, which is the market the channel matrix was researched for. Moving it into a segment
would aim the search at the wrong people with confidence, which is the failure the refusal exists to
prevent. Opening a new function is a build decision, not a triage override. A refusal on both axes is
treated the same way, and a refusal with no recorded axis is treated as the strict case, because a
missing axis is not permission.

The check uses the axis the mandate was **first recorded with**, not whatever a fresh extraction
says. A second look from the model can add a reason to refuse, because the overrule re-reads the
specification and a domain finding there still blocks it. It can never remove one. A mandate cannot
be argued into scope by re-rolling the extraction.

**The reason is the record.** At least thirty characters, kept verbatim, with the person's name. The
original verdict is stored beside it, exactly as the model gave it, in `triage_overrides`. That table
is append only for the application role, one row per mandate, and the database itself refuses an
overrule of a domain refusal, a target that is still out of scope, or a reason too thin to be a
record. The service checks these rules first so it can say why. The constraints mean a caller that
skips the service still cannot write a bad row.

**The mandate keeps one record.** The refused row held no terms, constraints or intake, because
nothing past triage was built for a role the practice did not recruit. So the specification comes in
again, extraction runs fresh, and the draft is built onto the same row. The practice keeps one record
of what it was sent, with the refusal and the overrule both on it.

## The channel plan for this segment is provisional, and says so

The Outreach Channel Matrix was researched for two senior segments. It has no ratings for technical
specialists, and inventing twenty nine of them for a market nobody has researched would be the
confidently wrong plan this system exists to avoid.

The rule instead is the most conservative one available: **a channel is rated at the lower of its
two researched scores**, so it is recommended only if the research supports it for both senior
segments. Referrals, email, LinkedIn Recruiter and conferences survive. GitHub, the ambassador
programmes and Stack Overflow fall to the bottom because the executive research rates them 1, which
is the failure that started this: a cabling coordinator pointed at GitHub.

The plan carries `provisional: true` and a note that says the ratings are borrowed. It is a starting
position until the practice has placements of its own in this band to rate channels against.

## What it deliberately does not do yet

**No discovery surface.** None of the eleven open web surfaces was researched for this band, and each
carries a terms position that has to be read and dated. Discovery for a technical specialist
therefore forms no query and says so, rather than applying a developer market's etiquette to a
different market. A test fails if a surface is added without a deliberate decision.

**No discovery surface, and a domain pack that suggests instead.** See the next section.

**Supplier terms are still reported as candidate constraints.** The tender's insurance, WSIB and IP
assignment clauses bind the supplier, not the person, and come out as disqualifying constraints on
the candidate. They need their own kind.

**The compensation question is salary shaped.** For a contract paid by the hour it asks for base,
bonus and pension. It also adds a note on Ontario's pay transparency rule, and whether that rule
applies to a contractor tender is not established, so it is a question for counsel.

**The plan skips phone and voicemail while the sequence has a voicemail touch.** The matrix rates
phone 2 for senior IT consultants and 4 for executives, so the lower score skips it, yet touch four
of every sequence is a voicemail. This predates the new segment and applies to the consultant plan
too. It needs a decision on which one is right.

**Sequences follow the technologist path.** Touch one is a connection note, as for senior IT
consultants. That is the practice's own etiquette for practitioners and not research on this
segment.

## The domain pack

The channel matrix is domain blind by construction: a segment is a seniority band, so a network
designer and a platform engineer in the same band get the same plan. A **domain pack**
(`src/mandate/domain-packs.ts`) holds what the practice knows about where one kind of practitioner
actually is. The first is **structured cabling and physical technology infrastructure**, built from
the Algonquin tender and one round of open web search on 29 October 2026.

**A pack is knowledge, not a search surface.** It suggests vocabulary, names employer classes,
credentials and bodies, and carries a catchment. It enables no automated query: `discoverySurfaces`
is typed as an empty list and a test holds it there, because a surface needs its terms read and
dated first.

**Everything in it is flagged unverified.** The sites that would settle most of it (BICSI, Job Bank)
could not be reached from the session, so every entry carries its source, the day it was collected
and a reason it has not been read. The type for a verified entry requires a name and a date, so the
first promotion has to be deliberate. A test fails while any entry is anything else.

**It widens where the search looks and never what it looks for.** The pack's title variants are
offered on the draft as suggestions. They enter the vocabulary only if the recruiter accepts them
through `additions`, and the confirmation gate still stands. The test for this adds one accepted
title and shows that nothing else from the pack reaches the strings.

**What it says about the market.** This band is found through employers, not communities: cabling
and ICT contractors, engineering firms with a telecommunications group, institutional IT and
facilities teams, and federal institutions. Four credentials (BICSI RCDD, Technician, Installer and
the registered project manager credential) matter, and no BICSI event in Canada was found for 2026.
It also lists the look alikes that share the words and not the market, such as an outside plant
network designer at a carrier, and holds a standing exclusion: the client's own staff, and for a
contract role the client's current cabling vendors and consultants, until the client says otherwise.

**Gatineau.** Added to the search at the operator's instruction as close to Ottawa. The **work
location stays Ottawa**: the catchment widens where a person may live, not where the role is. It
reaches the conference search and the provider query as a place group. The LinkedIn Recruiter Boolean
carries no place, because Recruiter takes location as a filter, so the recruiter adds Gatineau there.
Whether French is needed, and how a Quebec resident working on site in Ontario is handled, are not
established.

**Pay is not in the pack**, and a test keeps it out. The operator set pay aside for this mandate as
inaccurate.

**Still open.** Whether BICSI runs an Ottawa or Eastern Ontario chapter or a searchable credential
directory, which vendors the client uses and whether a non solicit applies, whether the federal
standing arrangement's unionized split matters, which college programmes feed the role, and whether
any posting found is still open. The pack lists them as questions.

## Who is off limits

The pack named cabling contractors as the likeliest place to find candidates, and in the same breath
as the class most exposed to a non solicit, because the client's own vendors are in it. The question
was put to the client and the answer was one vendor, **FCI**. That answer had nowhere to go except a
sentence, so it now has a table (`migrations/0013_off_limits.sql`) and a rule.

**The record.** `recordOffLimits` takes the organisation as the client named it, a basis (client
vendor, client staff, non solicit or other) and its source: who said so and when, which is required
because an exclusion nobody can trace is one nobody will dare lift. Entries are never deleted or
renamed. `liftOffLimits` records who lifted it and why, at least twenty characters, and the entry
stays, so "we approached them after the client said no" and "after the client lifted it" stay
distinguishable. The database holds this too: the application role can only change the three lift
columns, a half completed lift is refused, and there is one live entry per organisation.

**The rule in screening.** Evidence that names an off limits organisation is a **hold** whatever else
it shows, never an advance, and it sorts last so nobody works it first. It is not a reject. A mention
is not proof of employment, and a former employee or an unrelated namesake is still somebody a person
may approach. The matcher errs towards a hit on purpose: "FCI Connectors" matches, and "Pacific" does
not. A false hit costs a look. A miss approaches somebody the client said not to. The deeper read in
profile promotion carries the same list, because a page read in full is where an employer turns up
that a snippet did not carry.

**Aliases are never guessed.** The entry is the name as the client gave it. "FCI" is an abbreviation
other companies share, so an alias is added only once somebody has confirmed it is the same
organisation. For the Algonquin search the operator confirmed on 30 October 2026 that FCI is
**Fleming Communications Inc.**, an Ottawa company. The entry is therefore FCI with the aliases
"Fleming Communications Inc." and the short form "Fleming Communications", which is the same company
written the way a profile usually writes it. A hit on the short form costs a look, and a miss
approaches someone the client said not to.

```ts
await service.recordOffLimits({
  mandateId, tenantId, actor: { id: 'emil' },
  name: 'FCI',
  aliases: ['Fleming Communications Inc.', 'Fleming Communications'],
  basis: 'client_vendor',
  source: 'Operator, 30 October 2026: the client\'s cabling vendor is FCI, confirmed as Fleming Communications Inc.',
});
```

**It shows on the plan.** `SearchPlan.offLimits` lists the live entries, and the dry run prints a
section that asks for them when none is recorded. LinkedIn's own company exclusion has to be set by
hand on the Recruiter seat, because a Boolean `NOT` on a short name would also remove former
employees and unrelated namesakes.

## Using it

```bash
# A refusal on seniority shows how to overrule it.
npm run mandate:dry-run -- fixtures/network-designer-algonquin.txt --via-cli

# The overrule, with the reason that will be recorded.
npm run mandate:dry-run -- fixtures/network-designer-algonquin.txt --via-cli \
  --override technical_specialist \
  --reason "Client confirms a five year contract coordinator is wanted"
```

In code, `service.overrideTriage({ mandateId, jobSpec, segment, reason, actor, tenantId })`.
The dry run applies the same pure rules (`applyTriageOverride`) and writes nothing.

## Verified

**The full suite:** 492 tests passing, typecheck clean. 22 of them came with the segment, 20 with the domain pack and 18 with off limits.

**The live extraction eval, run against the model on 29 October 2026:** 7 of 7 cases pass, triage
7 of 7, negatives 2 of 2. The Algonquin tender now comes back as `technical_specialist` with
every source quote verified, the NAV CANADA Technologist is still refused, and the credit union
strategy role is still refused on domain. One run per case, so this shows the prompt change did not
move the existing verdicts, not that they are stable.

**An overrule of a domain refusal, tried live:** the Director of Enterprise Strategy, refused on
domain, with a plausible reason supplied, is refused again with the explanation above.

**What this does not show.** The overrule path itself is exercised end to end by tests against the
in memory database and a fake model. No live run has yet been refused on seniority and then
overruled, because the updated prompt places the tender in the segment on its own.
