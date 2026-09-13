# Phase 1: The Mandate Engine

**Status:** Code complete. 90 tests passing, typecheck clean. **One exit criterion is operational
and cannot be met from the keyboard**, see below.
**Scope:** [Architecture s5](architecture.md#5-the-mandate-engine) and s16, phase one of the Pilot Cut.

A job specification goes in. A confirmed market vocabulary, a ranked channel plan, four search
strings and the pipeline arithmetic come out. This is the Outreach Channel Matrix workbook as
software, plus the intake discipline the workbook assumes but cannot enforce.

## What was built

**Structured extraction** (`src/mandate/extraction.ts`, `src/llm/`). A versioned prompt behind a
gateway that validates output against a schema and logs every call for audit. The prompt's first
rule is never invent: where the specification does not say what the person must accomplish or why
this is a career move rather than a lateral one, the model returns null and that null becomes a
specific question for the hiring leader.

**Market vocabulary validation** (`src/mandate/vocabulary.ts`). Proposed titles are ranked by how
often they actually occur in the target universe. A title that appears zero times is returned with
its zero rather than dropped, because a zero is a finding: either the market calls the role
something else or the target company list is wrong.

**The confirmation gate** (`src/mandate/service.ts`). A mandate lands as `awaiting_confirmation` and
cannot produce a search plan until a recruiter has accepted or rejected each proposed term and added
any the model missed. A mandate with every title rejected cannot go live at all.

**Channel planning** (`src/mandate/planner.ts`, `channel-matrix.ts`). All twenty nine channels with
their researched fit ratings, generated directly from your workbook rather than retyped. Every
channel is returned with a reason, including the skipped ones, and the recommended set is trimmed to
three to five weighted toward warm and network channels.

**Search string generation** (`src/mandate/strings.ts`). LinkedIn Recruiter Boolean, a code host
X-ray, a conference and talks X-ray and a structured query for the licensed provider, in the formats
your workbook already produces.

**Pipeline arithmetic** (`src/mandate/pipeline.ts`). Shown as a working rather than a number, with
the long list gap surfaced alongside the moves that close it.

**Source of hire instrumentation** (`source_of_hire_events`). Capturing from the first event,
reported in phase four, and append only so attribution history cannot be rewritten.

## Exit criteria

**Source of hire instrumentation is in place and capturing.** Met. The table exists, the service
writes to it, and a test proves the rows cannot be updated or deleted.

**A real job specification produces a channel plan and search string set a recruiter runs without
editing, on three consecutive real mandates.** **Not met, and not meetable from here.** This is an
operational criterion that requires you to run three real searches and report whether you edited the
output. The machinery is tested end to end against your own worked example, which is the most that
can be demonstrated without real mandates.

Two things follow from that honestly. First, **extraction quality is unproven**: the tests cover the
machinery around the model (nothing is auto confirmed, gaps derive from what was left null,
malformed output is rejected) but not whether the model reads a real specification well. That needs
an evaluation suite built from real job specifications, which is the first thing to do when you have
three of them. Second, **the title frequency source is a fixture** until a data provider is
contracted, so validation currently says plainly that the variants are unvalidated model output
rather than pretending otherwise.

## What running a real specification found

A NAV CANADA Technologist posting was run through the engine: an entry level field electronics role
maintaining air navigation equipment, with no minimum years of experience, a diploma standing in for
experience, an explicit statement that prior sector experience is not required, and a training salary
band ahead of a qualified band.

**The engine had no way to say "this is not a role I handle".** `mandate_segment` offered exactly two
values, so extraction was forced to pick one, and the planner then recommended GitHub, AWS Community
Builders, Microsoft MVP and the CNCF ambassador directories for a technician who maintains radar. That
is the "excellent search string for the wrong search" failure the architecture warns about, occurring
one level higher than the architecture anticipated: at the segment rather than the title.

Fixed in `migrations/0004_segment_triage.sql` and the triage tests. Triage now runs before anything
else, `out_of_scope` is a first class verdict carrying its reasoning, the mandate is recorded rather
than discarded (what the practice is being sent and cannot serve is worth knowing), and there is no
path from an out of scope mandate to a search plan: confirmation and planning both refuse.

The same run found a second, smaller miss. The specification named no location, and the engine did
not ask. A national employer with site based roles and no geography produces search strings that
return the wrong people everywhere, so that is now an intake gap.

Two further gaps were found and are **not** fixed, because they are enhancements rather than defects
and the scope is yours to set. The mandate model has no field for **compensation**, though this
specification carried two structured bands, and the method calls for holding a range without leading
with it. It also has nowhere to put a **hard qualification that is not a search term**: bilingual
English and French, a valid driver's licence, a credential completed within ten years. These are
filters, not skills, and today they would be forced into the skill list where they would corrupt the
Boolean.

### A second specification: Senior Database Administrator

A genuinely in scope specification was run next: enterprise Oracle and SQL Server administration with
Azure migration and DBaaS platform development. **The engine handled the role well.** Triage put it in
the senior IT consultant segment and flagged the tenure as borderline (the specification asks for five
or more years where the segment usually implies eight, which is exactly the kind of call a recruiter
should be given the chance to overrule). The title ranking surfaced that the market says Senior
Database Engineer and Cloud Database Engineer as well as the client's own Senior Database
Administrator. The Boolean was runnable as written. The location and target company gaps both fired
correctly, because the specification genuinely names neither.

**Then it lost every one of six hard constraints:** eligibility for Secret clearance, priority to
Canadian citizens and permanent residents, no relocation assistance, twelve on-site days a month
within commuting distance of an office the specification never names, a required on-call rotation,
and the language requirement.

Three consequences, which is why this was a defect rather than a nicety. The pipeline arithmetic
**silently overstated the addressable market**, since the published default rates were measured on
unconstrained senior searches. The sequence would have **wasted its scarce capacity**, because
nothing stopped five touches landing on someone who cannot obtain clearance or will not commute. And
it **contradicted the scoring model**: factor 7 of the receptivity score is freedom from
deal-breakers, a deal-breaker is a property of the mandate, and phase 2 would have had nothing to
score it against.

Fixed in `migrations/0005_mandate_constraints.sql`. Constraints are now first class, typed by kind and
severity, each carrying the words from the specification that established it so a recruiter can check
it against the source rather than trust a paraphrase. They never enter a search string. The search
plan carries them, and when any is disqualifying the projection says plainly that the default rates
overstate this market and must be replaced with the practice's own.

**No multiplier was invented.** There is no published figure for how much a clearance requirement
shrinks a senior technology market, so the arithmetic is unchanged and only the honesty about it
changes. That is decision record entry 15.

**Compensation remains the one open gap** and is still your call. The NAV CANADA specification carried
two structured bands; this one carries none.

### The first run against a live model

Everything above was found with hand authored extractions. Running the Senior Database Administrator
specification through an actual model, using the Claude Code CLI as a backend since this environment
has no API key, **failed on the first attempt and found four defects that fixtures structurally could
not have caught**, because the fixtures were written by hand and were therefore already well formed.

**The prompt and the schema had drifted.** The prompt described the fields in prose while only the
schema knew the permitted enum values, the numeric types and the array caps. The model invented a
reasonable taxonomy of its own (`on_site_requirement`, `residency_commuting_radius`,
`prior_experience_floor`) and every guess was rejected; confidences came back as strings; a sector
name landed in the `kind` field. The prompt is now **generated from the schema**, so the instruction
and the validation cannot disagree again, and a test asserts every enum value appears in the rendered
prompt.

**Search terms were descriptions.** The model produced
`"Azure database platforms (Azure SQL Managed Instance, Azure Database for PostgreSQL, Oracle Database@Azure)"`
as a must-have skill. It is an excellent summary of the role and it matches nobody on any platform,
because a term goes verbatim into a quoted Boolean phrase. A term is now validated as a searchable
token: at most 48 characters, no brackets or semicolons, not a sentence. **Commas are deliberately
allowed**, because `"Director, Cloud Infrastructure"` is how the market writes that title.

**Location took a whole sentence.** `"Canada, the specification requires living within reasonable
commuting distance of the Bank's office, but names no city"` went straight into both X-ray queries and,
worse, suppressed the intake gap that should have fired. Location is now validated as a place name or
null, and null is the finding that raises the question.

**Two of the model's inventions were better than the taxonomy it was given** and were adopted:
`prior_experience` as a constraint kind, and `unstated` as an engagement type, because the
specification genuinely does not say and forcing a guess would put an invented fact into the mandate.

After the fixes the same specification produces a Boolean a recruiter can paste and run:

```
("Senior Database Administrator" OR "Senior DBA" OR "Database Administrator" OR
 "Senior Database Engineer" OR "Cloud Database Engineer" OR "Database Platform Engineer" OR
 "Lead Database Administrator" OR "Database Architect")
AND ("SQL Server" OR "Oracle" OR "Azure SQL Managed Instance" OR "Database Migration" OR
     "Always On Availability Groups" OR "Oracle RAC")
NOT ("Junior" OR "Intern" OR "Sales")
```

eleven constraints with their source quotes, a correctly null location with the sharpened question
attached, and a pipeline that reports five disqualifying constraints narrowing the market.

**This is what the unproven exit criterion was hiding.** The machinery was well tested and the
extraction was not, and every defect above sat in the gap between them.

## Notable decisions

**The Anthropic adapter opts into refusal fallback by default.** Extraction runs over real people's
career data, which is the shape of input that can trip a safety classifier, so a decline on the
primary model re-runs the same request on a fallback inside the same call rather than failing the
mandate. It also checks `stop_reason` before reading content, because a refusal arrives as a
successful HTTP response.

**Regenerating a search plan appends rather than overwrites.** `search_strings` and
`pipeline_projections` are append only, so an old string stays explicable after the vocabulary
changes. Channel selections are per mandate and stable.

**Every target company joins the employer watchlist permanently**, whether or not the mandate stays
open, because phase two's highest leverage mechanism is watching employers rather than people.

## Deliberate omissions

No web interface. The service is the API the interface will call, and building screens before the
phase two data model is settled would mean rebuilding them.

No live connector fetches. The public evidence directory connector is still fixture backed, and the
title frequency source is an interface with a fixture implementation, both waiting on the provider
bake off.

No evaluation suite for the extraction prompt, for the reason given above: an eval built on invented
job specifications would measure the wrong thing.

## What phase two builds on

The employer watchlist is already being populated by every mandate. The signal taxonomy, the two
clocks and the eight factor score attach to `organizations` and `persons`, both of which exist with
their provenance discipline intact.
