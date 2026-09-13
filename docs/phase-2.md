# Phase 2: The Receptivity Engine

**Status:** Core complete. 190 tests passing, typecheck clean. All three exit criteria proven by test.
**Scope:** [Architecture s6](architecture.md#6-the-receptivity-engine), phase two of the Pilot Cut.

Determines **who** to approach and **when**. This is the Candidate Receptivity Scorecard as software,
with the event model the spreadsheet could not express.

## What was built

**The two clocks** (`src/receptivity/signal-types.ts`, `service.ts`). Twenty three signals generated
from the practice's own workbook, each declaring which subject it attaches to. The six in the
`employer_trigger` category attach to an **organization** and fan out to everyone currently tracked
there; the other seventeen attach to a **person**. That split is the highest leverage mechanism in
the system, because one return to office mandate makes a whole floor receptive and the event fires
before any individual behaviour appears.

The engine refuses to fan out a personal signal. Applying "public open to work frame" to every
employee of a company would be nonsense, and it is the kind of nonsense that is obvious in a
sentence and invisible in a query.

**The employer watchlist.** Every target company of every mandate lands on it permanently. The entry
outlives the mandate deliberately: the watchlist is the practice's standing view of the employers it
recruits from, and a trigger at one of them is worth knowing about whether or not a search is open.

**The stacking rule.** Two or more independent signals inside a thirty day window with at least one
employer level trigger. A single signal is noise, and the engine says so in the recruiter's own
terms rather than silently ranking them low.

**The score** (`scoring.ts`, `scoring-model.ts`). Eight weighted factors out of one hundred, decaying
ten percent per thirty untouched days to a floor of half, tiered Hot, Warm and Cool with the cadence
each tier implies. Factors one and two are **derived** from the ledger and the interest scale; the
other six come from the exploratory call. The scoring function is pure: the same inputs under the
same model version always produce the same output, which is what makes a score replayable and a
model change measurable.

**Versioned, backtestable models.** Weights, decay, tiers and cadence are data, not constants.
Installing a new version never rewrites history; `backtest` replays every prospect under a candidate
model and writes the results flagged, so a replay can never be mistaken for what the practice
actually did.

**Identity resolution.** Deterministic on a verified email, a provider identifier or a profile URL.
Everything below that, including name plus employer window, returns `ask_recruiter` rather than
guessing. Merges are recorded and reversible. A bad merge in a database holding consent records is a
compliance incident, not a data quality annoyance.

## Exit criteria, and how each is proven

**An employer trigger fires and re-ranks the people tracked at that employer.**
`tests/receptivity/engine.test.ts` builds an employer with four people: two current employees, one
who left in 2022, and one who works somewhere else. A return to office mandate is recorded against
the employer and exactly the two current employees are rescored. The trigger appears in their score
explanations flagged `viaEmployer`, and in the headline.

**Any score explains itself.** Every score stores an explanation carrying the model version, all
eight factors with their weights, values, contributions and a note each, every signal with its
liveness, the stacking verdict, the raw score, the decay applied, the tier and a one line headline
naming the evidence rather than the number. The test asserts the payload is complete rather than
merely present.

**A model version change does not alter a single historical score.** The test scores two prospects
under version 1.0.0, installs a 2.0.0 that zeroes the signal weight and raises the motivator weight,
backtests, and asserts every original row is byte for byte unchanged while the replays are present,
flagged, and say something different. A grant separately makes a score physically unwritable.

Three further properties were cheap to prove now and expensive to retrofit: the model is rejected if
its weights do not total one hundred or if a score could fall through its tiers; a personal signal
cannot be fanned out; and **the three worked examples in the workbook are reproduced exactly**,
which is the cheapest possible proof that the arithmetic in software is the arithmetic the practice
already agreed to.

## What is NOT from the source, and should be tuned

**Per signal expiry windows.** The research gives a single thirty day window for the stacking rule
and says only that stale signals expire. The per signal lifetimes, fourteen days for a layoff, one
hundred and eighty for a merger, three hundred and sixty five for a silver medalist, are practice
defaults set from what each signal is. They are tenant data. Where a source does speak to duration
the seed records it in `windowNote`.

Everything else, the weights, the decay rate and floor, the tier thresholds and the cadence
intervals, comes from the workbook, and the workbook's own caveat travels with it in the model's
`notes` field: **decision support, not prediction.** No validated predictive model of candidate
openness exists in the published research. The cadence intervals and decay parameters in particular
are vendor guidance rather than peer reviewed findings.

## Deliberate omissions

No live trigger feeds. The watchers that would poll funding, leadership change, layoff notices and
headcount are connectors, and the connector contract already exists to hold them; what they need is
a contracted data source, which is the same open decision that limits phase one.

No probabilistic identity matching. The deterministic tier and the escalation path are built; the
middle tier is deliberately absent until there is enough real data to calibrate a threshold against,
because a threshold guessed in advance is a merge policy nobody can defend.

No interface. The service is the API the interface will call.
