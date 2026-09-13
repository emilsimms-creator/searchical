# Phase 0: Foundations

**Status:** Complete. 35 tests passing, typecheck clean.
**Scope:** [Architecture s16](architecture.md#16-build-plan), phase zero of the Pilot Cut.

Phase zero exists to make the architecture's non negotiable principles into properties of the
system rather than statements in a document. Nothing here is a feature a recruiter will see. All of
it is the thing that makes every later phase safe to build quickly.

## What was built

**The evidence ledger** (`src/ledger`, `migrations/0001_init.sql`). Every factual table carries a
`NOT NULL` foreign key to `evidence`, and every evidence row carries its source, collection method,
collection timestamp, lawful basis, jurisdiction, confidence and expiry. A bare fact is not
representable in this schema.

**Tenancy enforced by the database** (`migrations/0002_security.sql`, `src/db/client.ts`). Row level
security is enabled and forced on every table. `withTenant()` opens a transaction, sets the tenant
claim for that transaction only, and drops to an unprivileged application role. No application code
filters by tenant anywhere, deliberately.

**The ledger as the only write path.** The application role holds no `INSERT` on `evidence`,
`attributes`, `sensitive_attributes`, `signals`, `employments`, `consents` or `audit_log`. Those
tables are written exclusively by `SECURITY DEFINER` functions that validate the tenant claim
themselves. A direct insert from anywhere in the codebase fails with permission denied at the
database.

**The connector capability contract** (`src/connectors`). `persistence` is the discriminant of a
union rather than a field on a shared interface, so a connector whose output may not be persisted
has no method that returns records. The LinkedIn Recruiter seat is modelled this way.

**The policy engine** (`src/policy`). Three gates, collection, enrichment and send, each with its
rules, each returning every failing reason at once rather than short circuiting, and each reason
carrying the basis it rests on so a block can be argued with on the merits.

**Supporting pieces.** Structured logging with person level fields redacted, an append only audit
trail written through its own function, a hand written migration runner, and CI that runs typecheck
and the suite on every push.

## Exit criteria, and how each is proven

**A fact can be written only through the ledger, with full provenance.**
`tests/ledger.test.ts` attempts a direct insert into all seven append only tables and asserts
permission denied on each, then attempts an update and a delete and asserts the same. It then
writes a fact properly and reads back the full provenance chain from attribute to evidence to
source.

**Row level security blocks a cross tenant read.**
`tests/rls.test.ts` creates two tenants, writes to each, and asserts that a hostile query filtering
explicitly for the other tenant's identifier returns nothing, that a cross tenant write is
rejected, that a query with no tenant claim returns nothing rather than everything, and that the
claim and the role both revert when the transaction ends.

**A connector declaring `manual_entry_only` cannot be made to persist by any code path.**
Two proofs, because one is not enough for the constraint that carries the most business risk.
The compile time proof is a `@ts-expect-error` in `tests/connector-persistence.test.ts`: `ingest`
accepts `PersistingConnector` only, so passing the LinkedIn seat connector does not compile.
Deleting that directive makes `npm run typecheck` fail with
`Argument of type 'ManualEntryConnector' is not assignable to parameter of type 'PersistingConnector'`,
which is the assertion. The runtime proof covers a connector arriving from a registry lookup typed
as the union, where the compile time guarantee does not apply.

Three further properties are proven because they were cheap to prove now and expensive to retrofit:
signal expiry is derived inside the database from the signal type's recency window rather than
trusted from the caller; an incomplete conspicuous publication consent record is rejected by a check
constraint; and the typed schema and the SQL migrations are compared column by column so they cannot
drift apart silently.

## Running it

```bash
npm ci
npm run verify     # typecheck, then the full suite
```

No database service is required. The suite runs Postgres in process through PGlite, which is a real
Postgres build rather than an emulation. That matters here, because the properties under test are
roles, forced row level security, grants and `SECURITY DEFINER` functions, and nothing but a real
Postgres would demonstrate them.

## Deliberate omissions

No web interface, no authentication provider integration, no durable workflow runner and no live
connector implementations. Each belongs to the phase that first needs it, and building them now
would mean guessing at requirements that phases one and two will establish.

The send gate rules are implemented and tested but are not yet wired to a sending path, because
there is nothing to send until phase 3a. They are here so that phase 3a is assembled against a
policy engine that already exists rather than written alongside one.

## What phase one builds on

The mandate engine will register the public evidence directory connector properly, write its
findings through `Ledger.ingest`, and evaluate the collection gate before doing so. The interfaces
it needs are all present and tested.
