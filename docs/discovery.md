# Discovery: where the system looks for people

**Status:** Source catalogue, query generation, search provider and harvest complete. 32 discovery
tests, part of 327 passing overall. **No source is enabled for persistence yet**, by design.
**Audience:** Engineers, and you as operator deciding which surfaces to clear.

This layer answers one question: where, on the open web, does a senior technology person leave a
trace, and what may we do with it. It was built by studying what the autonomous sourcing tools in
this market actually do, and then building the honest version of it.

## What noon.ai and its peers actually source from

Their stated capability is an agent that searches "the whole web, not just LinkedIn", evaluates
every profile against role criteria including non-negotiables, learns per role from recruiter
feedback, enriches verified contact details, and runs sequences across email, LinkedIn and SMS. They
cite 800M+ profiles.

**That number is the tell.** It is not the size of anything they crawl. It is the standard size of
the licensed people data aggregate layer, and the vendors who sell that layer describe it candidly.
Coresignal's employee dataset of the same order is "aggregated from multiple public sources,
primarily LinkedIn, but also alternative professional networks, public CV databases, and other web
sources". SeekOut and Juicebox quote the same magnitude from "dozens of data sources".

So "searches the whole web" in this market usually means three things stacked: a licensed aggregate
index whose backbone is LinkedIn derived data, a contact enrichment vendor on top, and some genuine
open web search around the edges.

**One caveat on method.** noon.ai's own site is blocked by the network egress proxy in the
environment this was written in, so their pages could not be read directly. The capability
description above comes from search summaries of their site plus third party comparisons, and the
inference about which layer sits underneath is drawn from the market pattern and from Coresignal's
own description of its index, **not** from anything noon.ai published about its vendors. I am not
certain which provider they use.

## What this system does instead

Searchical refuses the LinkedIn derived aggregate on the evidence recorded in
[architecture.md s10](architecture.md): the hiQ consent judgment of December 2022 and the permanent
injunction that shut Proxycurl down in July 2025. It also refuses automated LinkedIn outreach, which
breaches LinkedIn's User Agreement whatever a competitor advertises.

What is left, done properly, is most of the practical reach: eleven named surfaces, each with a
query shaped for what it actually indexes, plus a contracted provider that can answer the lawful
basis question in writing.

`src/discovery/sources.ts` is the catalogue, and it is code rather than a document so it cannot
drift away from the system that acts on it. Each entry carries what the surface yields, why a senior
person is there at all, its regional coverage, its etiquette, and its terms position.

## The verification rule

**A source whose terms are unverified cannot be enabled for persistence.** It can be searched, and
what comes back is a pointer for a human to open, but nothing reaches the ledger.

Today that means **no source is enabled**. Two have been read and dated: LinkedIn, which is pointer
only by design, and GitHub, which needs a counsel answer before it could persist. The other nine
say plainly that nobody has read their terms. That is the honest state, and a test asserts it, so
the number cannot rise quietly.

The GitHub entry is worth reading as an example of getting this right rather than getting it safe.
Its Acceptable Use Policies prohibit using information from the service for spamming, which they
define to include unsolicited emails and **selling personal information to recruiters, headhunters
and job boards**, and require that collected personal information be used "only for the purpose for
which the User has authorized it". Reading a public profile to identify someone is **not** what that
forbids. Overstating the prohibition would have been as wrong as ignoring it, and would have thrown
away the best evidence of technical depth on the open web.

Stack Overflow blocks the user agent used to check these, so its terms have **not** been read and
the entry says so in capitals rather than guessing.

## Why each surface gets a different query

This is the part the naive X-ray generators get wrong. One template fired at every site returns the
same mediocre results everywhere.

A code host indexes what people build, so it is queried by skill; nobody writes "Vice President,
Engineering" in a repository, and the live mandate runs earlier in this project showed exactly that
failure. A speaker programme is queried by the words a programme page uses, because a speaker list
is a pre vetted shortlist and it supplies the specific hook the personalisation gate requires. A
corporate leadership page is queried by title and bounded to the mandate's own target companies,
which is what makes it a market map rather than a web search; when no target list is confirmed the
query still runs and the rationale says it will be noisy.

Every query carries the advert exclusions. Without them a title search returns job boards all the
way down, which is the commonest way an open web sourcing query wastes an afternoon.

Only **confirmed** vocabulary is used, the same rule the outreach search strings follow. A query
built from terms a model proposed and no human accepted searches for the wrong person very
efficiently.

## A lead is not a person

`harvest` turns hits into leads and writes nothing. The step that finds pages and the step that
asserts facts about people are different steps with different rules, and collapsing them is how a
sourcing tool ends up holding a database of half read web pages presented as a talent map.

Each lead carries its disposition, decided by the source rather than by the caller: `may_persist`,
or `human_reads_it`. Because no source is cleared, everything is currently the second. Reach is
reported as two numbers and never one: pointers a human must open are not records, and a tool that
blurs them is selling the wrong figure.

One surface failing is not the search failing. A provider outage on the code host should not cost
the recruiter the speaker programmes, so failures are collected and reported per surface.

## The search provider

Behind one interface, for the same reason the language model is: which engine answers is a
commercial decision that should not reach into the code.

`fixtureSearchProvider` is how the whole layer is built and tested without a key, a network or a
bill, and it is how a regression gets pinned once a real query produces a surprising result: record
the hits, feed them back, and the failure reproduces forever.

`braveSearchProvider` is the reference real adapter. **It has never made a live call.** The
environment this was written in has no key and its egress proxy blocks every search API host. The
request shaping and response mapping are written from the published API and covered by tests against
recorded payloads, but whoever first runs it with a key should expect to fix something.

Run `npm run discover` to see the catalogue and every query without a key. Add `--live` with
`BRAVE_SEARCH_API_KEY` set to run them against the web.

## What is deliberately not here yet

**No connector turns a lead into ledger evidence.** That path goes through `Ledger.ingest` and the
collection gate like anything else, and it is unreachable today because no source is cleared to
persist. Building it before a single source has cleared terms would be building a door into a wall.

**No screening.** noon.ai evaluates every profile against role criteria including non-negotiables it
never relaxes. Searchical already holds those non-negotiables as `mandate_constraints` with
severities, so the screen has something real to run against, but the screen itself is not written.
This is the highest value next piece.

**No feedback loop.** Their thumbs up and down recalibrates what good looks like per role. Nothing
here learns yet. It should, and the approval corpus plus the constraint model are the right
substrate.

**No contact enrichment**, which is the other half of what makes their reach usable. That is the
contracted provider decision, already open.

## Open

The ORCID query is weak for infrastructure mandates, because ORCID indexes research and Kubernetes
is not a research topic. The surface is right for applied research and machine learning mandates and
close to useless otherwise. It should probably be gated on the mandate's own domain rather than
offered to every technologist search.
