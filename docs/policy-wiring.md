# Wiring the policy engine

**Status:** Complete. 295 tests passing, typecheck clean, and the approval queue driven end to end
against real PostgreSQL with every gate live.
**Audience:** Engineers, and anyone who needs to know which compliance claims are now enforced by
machine rather than written down.

The policy engine was built in phase zero with three gates, ten rules and a full test suite, and it
was called by nothing. Every compliance guarantee in the architecture was a statement about code
that never ran on the write path. This wires it in.

## Where the gates now run

**Collection** runs inside `Ledger.ingest` and `Ledger.recordManualEntry`. **Enrichment** runs
inside `Ledger.recordAttribute`. **Send** runs inside `EngagementService.queueMessage`, before a
draft can reach the approval queue.

The engine is constructed by the `Ledger` and `EngagementService` themselves rather than passed in
by callers. A gate a caller has to remember to pass is a gate that will eventually be forgotten, and
the forgetting will look exactly like ordinary code.

Every decision is written to the audit trail, allowed and refused alike. The question a regulator
asks is not "did you block anything" but "on what basis did you proceed", and a trail that holds
only refusals cannot answer it.

## What is now enforced that was not

**A connector may not collect outside its licensed jurisdictions.** This rule existed from phase
zero and bound nothing. The public directory connector declares Canada, the United States, Great
Britain, the EU and Australia; an ingest against Japan is now refused. Nothing in the system said a
word about this before.

**Sensitivity is decided by the attribute key, not by the caller.** The quarantine rule previously
read a boolean the caller supplied, which meant a caller passing `sensitive: false` for a date of
birth defeated it completely and nothing noticed. `src/policy/sensitivity.ts` now holds the system's
opinion, matched against the prohibited grounds of discrimination under the Canadian Human Rights
Act plus the categories PIPEDA and Quebec's Law 25 treat as requiring heightened care. A caller may
**escalate** an attribute the list does not recognise, which is right because a recruiter who knows
a free text note contains a health disclosure is correct even when the key is `call_notes`. A caller
may never **de-escalate** one the list does recognise; that combination is refused rather than
silently corrected.

**An email draft needs a recorded consent basis.** Canadian anti spam law puts the burden of proving
consent on the sender, so a send with no recorded basis is not permitted. This now binds at draft
time.

**A suppression stops contact on every identifier, not the one it was recorded against.** Someone
who asks to be forgotten by replying to an email must not then receive an InMail. The service
supplies every identifier hash it holds for the person, including one derived from the person record
itself, so the control works before any contact detail is on file.

**A draft must say who wrote it**, and must not quote money, both from the first draft.

## Draft and send are different moments

A draft sitting in the approval queue is not a commercial electronic message being sent, so the
rules about what a **sent** message must carry do not bind it yet. The mailing address and the
unsubscribe are added by the sending layer in phase 3b; running those checks on a draft would block
every draft forever and teach a recruiter to ignore the gate, which is how a real control becomes
decoration.

That distinction is modelled rather than fudged. `PolicyContext.message` carries a `stage`, every
rule declares which stages it binds at, and nothing is quietly skipped. `send.required_elements` was
split: sender identification binds from the first draft because it is a drafting concern, and the
address and unsubscribe bind at send. The rule is not softened, only correctly placed, and phase 3b
cannot send without satisfying it.

## What the wiring found

**The persistence rule blocked its own documented exception.** `connector.persistence` refuses a
`manual_entry_only` connector, and its statement says such a connector reaches the ledger "only
through a human". Wiring the gate showed it refusing `recordManualEntry`, which is precisely that
human route. The rule now declares that `recruiter_entered` collection is the path it leaves open,
and the jurisdiction rule still applies to it. A rule nobody calls is a rule nobody has checked.

**The consent rule immediately blocked every email draft in the existing tests.** Touches two,
three and five are email, the test prospects had no consent record, and CASL puts the burden on the
sender. That is the rule working on its first day. The fixtures now record an implied consent basis
through conspicuous publication at the point the public evidence is collected, which is what a real
pipeline does, rather than routing around the gate. `npm run seed:pilot` does the same.

**A type assertion was hiding a wrong assumption**, caught by typecheck rather than by tests: a new
test constructed a connector with an options object the factory does not take. The tests passed
anyway, for the right reason by accident. Vitest does not typecheck, so `npm run verify` running
`tsc` before the suite is what caught it.

## Open

**The send gate is not yet the last word, because nothing sends.** It runs at draft. Phase 3b must
run it again at the moment of sending, with `stage: 'send'`, against the rendered and addressed
message. The rules are ready for that; the call site does not exist.

**Jurisdiction is hardcoded to Canada** in the engagement service, which matches the practice's
stated Canada first outreach posture and is wrong the moment outreach goes wider. It should come
from the person's own location, which means location has to be a fact on the person with provenance
rather than a field on the mandate.

**The EU is modelled as a jurisdiction alongside member states**, so a connector licensed for `EU`
does not match `DE`. That is pre-existing and needs a decision rather than a patch: either
jurisdictions become hierarchical, or connectors enumerate member states.

**The indirect collection notice is recorded, not sent.** `notice.indirect_collection` allows and
states that a notice is owed. Generating and delivering it is GDPR Article 14 work that belongs with
phase 3b, alongside the consent ledger and the forget operation.
