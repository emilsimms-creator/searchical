# Phase 3a: The Engagement Engine, drafting half

**Status:** Core complete. 228 tests passing, typecheck clean. All three exit criteria proven by test.
**Scope:** [Architecture s7](architecture.md#7-the-engagement-engine), phase three of the Pilot Cut.

Determines **what to say** and **when to say it**, and stops at an approved draft. The Pilot Cut
relays by hand: nothing in this phase sends. That is not a limitation to be lifted quietly, it is
the compliance posture the Canadian anti spam rules make expensive to get wrong, and the point at
which a human reads every word is the control that makes the rest defensible.

## What was built

**The sequence** (`src/engagement/sequence-plan.ts`). Five touches across eighteen days, each with a
distinct job and a channel that varies between them, because five InMails in a row is worse than
three InMails plus an email. Touch one differs by segment: a connection note for senior
technologists, an InMail for executives. Six is the absolute ceiling and the sixth needs a stated
reason recorded against it. There is no configuration that permits a seventh, and the attempt is
rejected with the research that says why.

**The eight templates** (`templates.ts`), generated from the practice's Playbook rather than
paraphrased, each carrying the tokens it must have filled and the evidence its claims rest on.

**The personalisation gate** (`personalisation.ts`, migration `0010`). A message cannot be queued
unless every token its template names is filled by a hook, and every hook points at evidence that is
**live, about this person, and carries a citation**. The gate is enforced twice: once in the service,
where it returns a typed verdict naming exactly which tokens are missing so an interface can show
it, and once in `engagement_queue_message()`, the SECURITY DEFINER function that is the only INSERT
path into `messages`. A caller that skips the service hits a permission denied; a caller that
reaches the function and lies about the hook count is refused by the function. **A generic message
cannot reach the approval queue by any route the application offers.**

**The approval queue** (`service.ts`). Every draft is decided, approved, edited or rejected, and the
decision is appended to a corpus that cannot be rewritten. An edit that changed nothing is refused
(record it as approved), and a rejection with no reason is refused. `approvalMetrics()` reports the
edit rate from the very first decision, with a plain statement that says when the rate means the
drafting is not doing its job.

**The reply ladder and the exploratory call.** Every rung returns the prescribed next action, not a
bare status. Any reply that engages cancels the live sequence, an explicit no and an agreed
conversation alike, because a sequence that keeps running after someone answers is the single most
damaging thing an outreach system does. A cancelled sequence does not resume. The call record
refuses a short call that claims compensation was discussed: pay is raised once the conversation has
earned it.

## The three exit criteria and how each is proven

**A message with no verified person specific hook cannot be queued.** Four tests: the service
refuses and names the missing token; the typed error carries the verdict; a direct INSERT into
`messages` is permission denied; and the database function refuses when told there is a hook but
sent none.

**A full sequence schedules, cancels on a recorded reply and never double queues.** The five touches
land on the days the research gives with the channels it prescribes. A partial unique index makes a
second live sequence for one prospect a constraint violation; a unique constraint on
`sequence_step_id` makes two messages against one touch the same. All three reply rungs cancel.

**The approval edit rate is measured from the first draft.** Three decisions produce a 33 percent
edit rate with the counts behind it; two edits out of two produce the warning.

## What the tests found

The first run failed three tests, and all three were the engine being right.

The reply loop shared one tenant across three rungs and looked up `sequence_steps WHERE touch = 1`
without naming a sequence, so the second iteration found the first iteration's **cancelled**
sequence and was correctly refused. The lookup is now scoped to the sequence under test.

The two approval metric tests reused the InMail's hook token for touch two and touch three, whose
templates are `first_email` and `hiring_leader_followup` and name different brackets. The gate
rejected them, which is exactly its job: a hook that does not match the template's claim is not
personalisation. The tests now derive the hook from the template the step actually uses.

The schema parity test then failed on `message_hooks`, and it was right too. A hook carries a NOT
NULL `evidence_id`, which makes it a fact table under the provenance rule, so it belongs on the
list.

## Deliberate omissions

**No sending.** No SMTP, no InMail automation, no dialler. Approved drafts stop at `relayed`, marked
by hand when the operator has sent them from their own seat. The send gate in the policy engine
already exists and already runs; what it gates is a human.

**No suppression list enforcement at send time**, because there is no send. The consent and
suppression tables are populated and the send rules are written; they bind when phase 3b connects a
channel.

**No interface.** The service is the API the approval queue will call. The queue is the first screen
this system genuinely needs, because it is where the operator spends their day.
