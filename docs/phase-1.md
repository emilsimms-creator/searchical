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
