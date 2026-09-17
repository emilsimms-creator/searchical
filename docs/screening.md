# Screening

**Status:** Complete. 26 screening tests, part of 353 passing overall. Deterministic and pure.
**Audience:** Engineers, and anyone who has to defend a screening decision later.

The autonomous sourcing tools advertise evaluating every profile against the role's criteria
"including non-negotiables it never relaxes". This is that capability, built honestly, and the
difference between the two is the whole design.

## The problem with the marketing version

Run "evaluate every profile against every criterion" against a search snippet and most of it is
theatre. Nobody publishes their security clearance. Nobody publishes whether they will take an
on-call rotation, how far they will commute, or whether they can travel quarterly. A screen that
reports a pass on a clearance requirement it could not possibly have verified is **worse than no
screen**, because a recruiter believes it and stops asking.

So the honest version of "never relaxes a non-negotiable" is **never pretends to have checked one**.

## What can be checked, from what

`src/screening/checkability.ts` is a matrix of requirement kind against evidence depth, and it is
the load-bearing part of this layer. Evidence comes at three depths and they are not
interchangeable: a **snippet** is forty words a search engine chose, a **profile** is what the
person wrote about themselves, a **conversation** is what they told you when asked directly.

Clearance, schedule and travel are `never` checkable from anything but a conversation. Location,
language, credentials and prior experience are `weak` from web evidence and `reliable` only in
conversation, and `weak` is deliberately never enough to reject on: a stated city is not a commuting
radius, and it is usually stale.

Anything marked `never` becomes an **open question**, phrased to be asked out loud, carried through
to the exploratory call. A screen that outputs "UNVERIFIED: security_clearance" has done half the
job; the recruiter still has to work out what to say. This one says it.

## Citizenship is not screened at all

`citizenship_or_status` is marked `prohibited` at every depth short of the person telling you
directly, and that is not caution, it is the point.

It looks checkable, which is the danger. The only methods available from a web page are inferring a
protected ground from a name, a photograph or a location. That is precisely the inference the
sensitivity classifier already prevents at the enrichment gate, and it is the shape of automated
screening that New York City's Local Law 144 and Illinois HB 3773 were written about.

The system will not do it, and the result **says so** rather than silently omitting the check:
`prohibitedChecksSkipped` names the ground, and the open question explains why the screen declined.
A control nobody can see is a control nobody can audit.

## Presence, never absence

The only observations this layer makes from thin evidence are positive ones. "The page mentions
CISSP" is a fact about the person. "The page does not mention CISSP" is a fact about the page, and
treating it as a finding is how a screen quietly rejects qualified people for having a short
profile.

That bias has a direction. A screen that reads silence as a negative discards the half of the market
whose public writing is sparse, which skews hard toward people who market themselves rather than
people who are good. The same reason `hold` exists as a verdict distinct from `reject`: thin
evidence is a fact about the evidence.

## Why this is not a language model call

The screen is deterministic and pure. The same evidence under the same mandate always produces the
same verdict, with the matched text attached to every finding so a recruiter can check rather than
trust. That property is what lets a screening decision be explained six months later, to the
candidate or to a regulator, and it is why the judgment is spent on the vocabulary confirmation step
rather than here.

Only **confirmed** vocabulary is used, the same rule the search strings and discovery queries
follow.

## What running it found

A sample harvest advanced a lead titled "Junior Platform Engineer" when `Junior` should have
excluded it. That looked like a bug and was not: the mandate under test had no confirmed exclusions,
so the screen had no power to reject anybody at all.

That is a real and quiet failure mode. A screen that can only advance or hold looks like it is
working right up until somebody notices it has never said no. `screeningSummary` now says so
explicitly when a mandate has no confirmed exclusions, and a test pins it.

## Open

**Nothing promotes a lead to profile depth.** Doing so means fetching and reading the page, which is
a separate step with its own terms position per source. Until that exists everything is screened at
snippet depth, which is the most conservative reading and the correct default.

**No model assisted judgment.** Whether "Head of Platform" is equivalent to "VP Engineering" is a
judgment this layer cannot make, so it does not. The LLM gateway and its versioned prompts are the
right place for that if it is wanted, clearly marked as model opinion rather than as a finding.

**No learning loop.** The competing tools recalibrate per role from thumbs up and down. Nothing here
learns yet. The approval corpus and the constraint model are the right substrate, and the honest
warning is that a screen which learns from a recruiter's clicks will learn that recruiter's biases
along with their judgment, so it needs the protected ground rules above enforced on the learned
behaviour too, not just on the hand written one.
