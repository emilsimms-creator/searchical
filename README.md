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
npm run verify     # typecheck, then the full test suite
```

No database service is needed. The suite runs Postgres in process through PGlite, because the
properties under test are roles, forced row level security, grants and `SECURITY DEFINER`
functions, and only a real Postgres demonstrates those.

## Status

**Phase 0 complete.** Tenancy, the evidence ledger, the connector capability contract, the policy
engine, the audit trail and CI are in place, with all three exit criteria proven by test. See
[docs/phase-0.md](docs/phase-0.md).

**Phase 1 code complete.** The Mandate Engine turns a job specification into a confirmed market
vocabulary, a ranked channel plan, four search strings and the pipeline arithmetic. 90 tests
passing. One exit criterion is operational and needs three real mandates run through it. See
[docs/phase-1.md](docs/phase-1.md).

Next is phase 2, the Receptivity Engine and the employer watchlist. The open decisions are listed at
the end of the [Executive Summary](docs/executive-summary.md).
