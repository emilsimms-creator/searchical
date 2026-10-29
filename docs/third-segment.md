# The third segment, and the recruiter's overrule

**Status:** Complete. 454 tests passing, typecheck clean, and the live extraction eval passing 7 of 7 cases.
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

**No domain pack.** Where infrastructure and cabling practitioners actually gather, such as their
professional bodies, trade events and regional employers, has not been researched, and the specific
names should be verified before they are hardcoded. This is the same domain blind gap the uOttawa
run found, and it is the next build.

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

**The full suite:** 454 tests passing, 22 of them new, and typecheck clean.

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
