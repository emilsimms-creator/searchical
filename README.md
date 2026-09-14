# Searchical

An evidence driven talent discovery and engagement system for senior technology search.

Searchical ingests a job specification, builds the market map and channel plan for it, identifies
senior talent worldwide, scores how receptive each person is likely to be right now, and runs a
human approved multi channel outreach sequence against them. It is built first for Information
Technology roles and is designed so that opening it to other functions is a configuration change
rather than a rewrite.

The system is not a candidate database with a search box on it. It is an operating system for a
search practice, and its defining commitment is that **every fact it holds carries its provenance,
and every score it produces can be explained and replayed.**

## Documents

| Document | Audience | What it covers |
| --- | --- | --- |
| [Executive Summary](docs/executive-summary.md) | Sponsor, partner, investor, anyone deciding whether to fund or proceed | What the system does, why it wins, what it cannot do, the honest constraints, the build shape and the decisions that need making |
| [Technical Architecture](docs/architecture.md) | Engineers who will build and operate it | Principles, system and container views, the three engines, data model, policy engine, connector framework, technology choices, build plan, decision record |
| [Phase 0 notes](docs/phase-0.md) | Engineers | What the foundations layer contains, and how each exit criterion is proven |
| [Phase 1 notes](docs/phase-1.md) | Engineers | The Mandate Engine: extraction, vocabulary validation, the confirmation gate, channel planning, search strings, pipeline arithmetic |
| [Phase 2 notes](docs/phase-2.md) | Engineers | The Receptivity Engine: the two clocks, the employer watchlist, the stacking rule, versioned and backtestable scoring |
| [Phase 3a notes](docs/phase-3a.md) | Engineers | The Engagement Engine, drafting half: the sequence, the eight templates, the personalisation gate, the approval queue, the reply ladder |
| [Compensation](docs/compensation.md) | Engineers, and a recruiter who wants to argue with it | The band, its provenance and confirmation, the gap analysis, Canadian pay transparency and the pay history question for counsel |
| [Eval notes](evals/README.md) | Engineers | The extraction eval: the cases, the pass criteria, and what it deliberately does not measure |

Read the Executive Summary first. It stands alone. The Architecture assumes it.

## Source research

The design is built on four research documents prepared for CDW Canada Consulting Services by
Emil Simms in September 2026, which are the practice's own evidence base and are treated here as
the functional specification:

1. Candidate Openness and Outreach Playbook
2. Active Outreach Channel Guide
3. Candidate Receptivity Scorecard (workbook)
4. Outreach Channel Matrix (workbook)

Where this design departs from those documents, or adds a constraint they do not cover, the
departure is stated explicitly and the reason given.

## Running the code

```bash
npm ci
npm run verify                  # typecheck, then the full test suite
npm run eval -- --via-cli       # the extraction eval, against a live model
```

`npm run verify` costs nothing and needs no services. `npm run eval` calls the model once per case
and spends real quota; `--via-cli` routes through the Claude Code CLI for machines with no API key.

No database service is needed. The suite runs Postgres in process through PGlite, because the
properties under test are roles, forced row level security, grants and `SECURITY DEFINER`
functions, and only a real Postgres demonstrates those.

## Status

**266 tests passing, typecheck clean.**

**Phase 0 complete.** Tenancy, the evidence ledger, the connector capability contract, the policy
engine, the audit trail and CI are in place, with all three exit criteria proven by test. See
[docs/phase-0.md](docs/phase-0.md).

**Phase 1 complete, with a live eval.** The Mandate Engine turns a job specification into a confirmed
market vocabulary, a ranked channel plan, four search strings and the pipeline arithmetic.
`npm run eval` grades the extraction prompt against five real job specifications on eighteen
programmatic pass criteria, and passes 5 of 5. See [docs/phase-1.md](docs/phase-1.md) and
[evals/README.md](evals/README.md).

**Phase 2 complete.** The Receptivity Engine scores who to approach and when: twenty three signals on
two independent clocks, the employer watchlist that fans a trigger out to everyone tracked there, the
stacking rule, and a scoring model that is versioned data rather than constants so a change can be
backtested before it is installed. See [docs/phase-2.md](docs/phase-2.md).

**Phase 3a complete.** The Engagement Engine drafts: the five touch sequence, the eight templates, the
personalisation gate that makes a generic message unqueueable at both the service and the database,
the approval queue with its edit rate, the reply ladder and the exploratory call. Nothing sends. See
[docs/phase-3a.md](docs/phase-3a.md).

**Compensation, in CAD.** The band is versioned on the mandate with its source quote and a
confirmation the client stands behind, only a confirmed band is quotable or comparable, and the gap
between the band and the candidate's expectation is surfaced at the first call rather than at offer.
Closes factor 8 of the scoring model. See [docs/compensation.md](docs/compensation.md).

Next is phase 3b, connecting a channel so approved drafts can leave the building, which needs the
consent and suppression rules bound at send time and the open commercial decisions settled first.
Those decisions are listed at the end of the [Executive Summary](docs/executive-summary.md).
