# Mandate extraction eval

Measures one thing: whether the extraction prompt turns a real job specification into a mandate a
recruiter can act on. Not the database, not the channel matrix, not the sequence engine. Those have
unit tests. This exists because the extraction step is the only part of the system whose behaviour
is not determined by code, and **every defect found in phase one lived in the gap between the
well tested machinery and the untested extraction.**

```bash
npm run eval -- --via-cli              # one pass over every case
npm run eval -- --via-cli --runs 3     # three passes, showing per check stability
npm run eval -- --via-cli --case senior-database-administrator
```

Every pass calls the model once per case and costs real quota. Nothing is written to a database.
Drop `--via-cli` to run against the Anthropic API instead of the Claude Code CLI.

## The cases

Three real specifications, all supplied by the practice. No synthesised inputs: a fabricated job
specification would measure the prompt against a fiction of what job specifications look like, which
is the failure this eval exists to prevent.

| Case | Label | Why it is in the set |
| --- | --- | --- |
| `nav-canada-technologist` | negative | Entry level field electronics role. The engine must refuse it rather than force it into the nearest segment. Found the triage defect |
| `senior-database-administrator` | positive | In scope senior individual contributor carrying six hard constraints that are not search terms, and naming no city despite an on-site rule. Found the lost constraints defect, then the description-shaped search terms defect |
| `senior-cybersecurity-grc` | positive | In scope, carries two different titles for the same role, and invites domain inference the engine must label rather than assert. Found the unearned provenance defect |
| `vp-engineering` | positive | The first in-scope executive: VP Engineering reporting to a Chief Product and Technology Officer, clearing both bars. Closes the last untested path, and confirms the location rule holds on a specification that names its employer and an office environment but never a city |
| `director-enterprise-strategy` | negative | A genuine executive and genuinely not this practice's market: corporate strategy at a credit union. Clears the seniority bar, fails the domain bar. Found the second axis of force fitting, and the search strings that contradicted their own channel plan |

**Five cases is below the honest floor.** The guidance for a first eval is fifteen to a hundred
inputs, and at n=3 a single flaky case swings the score by a third. This set is what exists, every
member of it earned its place by finding a real defect, and **the first priority for this eval is
more real specifications**. All three verdicts are now covered by a real document: `senior_executive`, `senior_it_consultant` and
`out_of_scope` on each of its two axes. The gaps now: a contract or consulting engagement, a
specification carrying a stated compensation band, and one that actually names its work location, so
that `location_shape` is exercised in the positive direction rather than only against null.

## How it grades

Every check is programmatic. The output space is constrained, a label from a closed set plus
structured data plus strings that must satisfy a syntactic rule, so a model judge would add cost and
non-determinism without measuring anything a deterministic check cannot.

Each check is a **hard gate**. A case passes only if every applicable check passes; the suite passes
only if every case passes; a failing suite exits non-zero.

| Check | What it catches | Found by |
| --- | --- | --- |
| `schema_valid` | Output that does not parse at all | First live run, which failed on every enum |
| `segment_correct` | The wrong segment, which makes every downstream artefact confidently wrong | NAV CANADA |
| `rationale_substantive` | A verdict delivered without its evidence | |
| `terms_searchable` | A description used where a search token belongs | Senior DBA |
| `no_duplicate_terms` | The same title proposed twice at different confidences | Senior DBA |
| `no_constraint_leakage` | Requirement text (clearance, on-call, years of experience) used as a search term | Senior DBA |
| `location_shape` | A sentence in the location field, which poisons two queries and suppresses the gap | Senior DBA |
| `stated_have_quotes` | A stated constraint with nothing to check it against | |
| `quotes_verified` | A quote that is not actually in the document | GRC |
| `inference_labelled` | Reports how much was inferred rather than stated | GRC |
| `required_constraints` | Constraint kinds the specification plainly carries but the model missed | |
| `required_skills` | Capabilities the specification plainly requires but the model missed | |
| `required_gaps` | A question the specification leaves open that the engine failed to raise | |
| `boolean_runnable` | A search string a recruiter cannot paste and run | |
| `scope_reason_correct` | A refusal that does not say which bar failed, or an in-scope mandate carrying a refusal reason | Director, Enterprise Strategy |
| `strings_match_plan` | A search string generated for a channel the same plan says to skip | Director, Enterprise Strategy |
| `no_search_plan` / `channel_plan` | A plan produced for a refused mandate, or refused for a live one | NAV CANADA |

Triage accuracy is reported separately from the overall pass rate, because it is a classification and
because **force fitting an out of scope role is a different and more expensive error than missing one
required skill**. The negative case is called out on its own line for the same reason.

## What this eval deliberately does not measure

Named so that nobody mistakes a green suite for a complete one.

**Whether the extraction is *good*, only whether it is *correct in the ways that break things*.**
A mandate can pass every check and still summarise the role dully. Judging that needs a human or a
rubric, and neither is worth the cost until the mechanical failures stop.

**Whether the market vocabulary is right.** `required_skills` checks that plainly stated capabilities
survive. It cannot check that "Cloud Database Engineer" is what this market actually calls the role,
because nothing in the repository knows that. **That is what the title frequency provider is for**,
and until one is contracted this remains the largest unmeasured risk in the engine.

**Whether the career move case is persuasive.** The engine checks it exists and asks for it when it
does not. Whether it would move a passive candidate is a judgment call for the recruiter.

**Stability.** A single run measures one sample of a non-deterministic process. Use `--runs 3` before
trusting a change; the per check table then shows how often each check holds rather than whether it
held once.

This is not theoretical. The GRC case returned `location: null` on one run and `location: "Ontario"`
on the next, from a specification that names the Ontario Cyber Security Framework and the Ontario
electrical sector and never once says where the person sits. The inferred place both bounded the
search on a guess and silenced the intake gap that should have asked, and a single green run would
have reported neither. The prompt now states that location is the work location and must not be
inferred from the regulator, the sector or the employer's identity, and three independent runs of
that case now hold `location_shape` and `required_gaps` at 3/3 where a single run had reported one
of each answer.

## Output

`evals/results/results.jsonl` carries one row per case per run with the per check scores and timing.
It is written in the shape the bundled hillclimb report builder consumes, so a report can be rendered
over a run without reshaping it.
