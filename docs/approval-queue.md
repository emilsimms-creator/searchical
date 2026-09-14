# The approval queue

**Status:** Complete. Driven end to end against real Postgres, not only tested.
**Scope:** The interface half of [Phase 3a](architecture.md#phase-3-engagement-engine), which the
architecture named and phase 3a shipped without.
**Audience:** Engineers, and the operator who will live in this screen.

Phase 3a delivered three engines and no interface. The approval queue is the screen this system
genuinely needs first, because it is where the operator spends their day and because the edit rate,
the one number that says whether the drafting is worth keeping, is measured on nothing until a human
is deciding at volume.

## Two screens

**The queue** lists every draft awaiting a human, oldest first. Oldest rather than by score or by
mandate, deliberately: the draft that has waited longest is the one whose scheduled day is closest
to passing, and a sequence whose touch three goes out a week late is no longer the sequence the
research supports. The edit rate sits at the top of this page rather than in a report, and turns
amber above seventy percent, which is the point at which the operator is writing the messages and
the drafting is theatre.

**The draft** shows the evidence before the prose. That order is the whole design. The argument for
a human in this loop is that they read the claim against its source, and a screen that leads with
the paragraph invites approval of the paragraph. So the hook comes first: the bracketed token, the
value filled into it, the citation as a link, whether the evidence is still live, and the date it was
collected. Expired evidence is badged, because a talk from four years ago cited as recent is the
sentence that ends the conversation.

Below that, what the touch is for and what its wording rests on, then any decision already made for
this person, so touch three reads in the context of touch one. Then the draft itself, in an editable
box, with approve and reject.

## The decision follows the text, not the button

Putting the draft in an editable box creates a way to corrupt the only metric that matters: change
the words, click Approve, and the edit disappears from the edit rate.

So the action compares the submitted body against the original and records an edit as an edit,
whatever button was pressed. The service refuses the dishonest combination outright, which is a
change this screen forced and which is now covered by a test: an `approved` decision carrying a
changed body throws. Defence in both places, because the service is the invariant and the action is
the ergonomics.

A rejection still needs a reason, and the screen surfaces the refusal rather than swallowing it. The
reason is the signal that improves the drafting, and a rejection without one teaches nothing.

## What it is not

**It does not send.** Approving marks a draft approved and nothing more. The operator relays by hand
from their own seat, and the page says so at the bottom of every draft.

**Authentication is a shim.** The Pilot Cut has one operator and one tenant, so `src/web/session.ts`
reads both from the environment and refuses to start without them. Every query still goes through
`withTenant`, so row level security is doing the confining exactly as it does everywhere else, and
no screen passes a tenant id into a WHERE clause. Replacing the shim with real authentication
changes that one file and nothing downstream of it. That property is the reason the shim is
acceptable and the reason it must not be copied.

**There is no interface yet for the rest.** No mandate intake, no score explanation, no exploratory
call form, no compensation band entry. Those services exist and are tested; they have no screen.

## How it was verified

Tests cover the two queries: what the queue lists, the ordering, that a cancelled sequence and a
decided draft both drop out, that one practice cannot see another's queue, and that the detail
payload carries the hooks, their live or expired state, and the prior decisions.

Beyond that the screen was driven end to end with a browser against a real PostgreSQL instance
seeded with three prospects, since a screen that only typechecks is not a screen. Approving
unchanged recorded `approved` with the original body intact. Rewriting the text and pressing Approve
recorded `edited`, with the original preserved and the rewrite as the final body. Rejecting with no
reason was refused, the error shown on the page, and nothing decided. Rejecting with a reason
recorded it. The queue then reported three drafts decided at a thirty three percent edit rate,
computed from real rows.

`npm run seed:pilot` builds that database. `npm run dev` runs the screen against it.

## Open

The queue has no filter, no search and no pagination, which is correct at pilot volume and will not
be at a hundred drafts. The obvious first addition is grouping by mandate, and the obvious trap is
adding a sort by receptivity score, which would quietly turn a first in first out queue into a
reason to let the cold prospects' touches go out late.
