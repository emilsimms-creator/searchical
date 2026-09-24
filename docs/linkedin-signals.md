# LinkedIn Signals

**Status:** Slot built and tested. **Not connected, not enabled.** It cannot open until an
agreement naming the operating entity is recorded and the server's spec is in hand.
**Audience:** You as operator, and whoever at CDW holds the LinkedIn agreement.

## What is known, and what is not

You report that LinkedIn has released a Signals tool exposed over the Model Context Protocol, and
that CDW is its first partner. **Neither could be confirmed from public sources on 24 September
2026.** Searches found no LinkedIn or CDW announcement, and at the time LinkedIn had no public MCP
server while its Sales Navigator API (SNAP) was limited to approved partners. That is consistent with
an early partner programme under NDA, and it is not evidence either way.

Not known, and deliberately not guessed: the endpoint, the tools and their arguments, the signal
vocabulary it returns, what the terms allow to be kept, and whose agreement Searchical would run on.

## Why this is allowed when LinkedIn scraping is not

LinkedIn public profiles stay `manual_entry_only` and are never fetched. Nothing LinkedIn has
published permits automated access to them, and the community Sales Navigator MCP servers work by
driving a logged-in session through cookies or browser automation, which puts the seat itself at risk.

A tool LinkedIn built and licenses is the opposite case: sanctioned access under contract. So it
sits in the catalogue as `licensed`, governed by its contract, alongside the contracted people data
provider. The entitlement check is what makes that distinction enforceable rather than just claimed.

## The entitlement gate

`src/connectors/licensed/agreement.ts`. **A partner agreement belongs to the entity named in it.**
Access that one company holds is not access a separate entity may use, however closely the two are
connected. So the slot refuses to open unless a recorded agreement:

- names the entity actually operating this system as licensee
- is in force, neither expired nor post dated
- permits recruitment as a purpose (a sales intelligence licence is not automatically a
  recruiting licence)

Every reason is returned at once. Whether results may be **kept** comes from the agreement too, and
defaults to no.

## The slot

`src/connectors/licensed/linkedin-signals.ts`. The seam is a transport that calls a named tool, so
the real MCP client can be written against the spec without touching anything else. The map from
LinkedIn's signal codes to this system's is **empty**. Several of the twenty three scorecard signals
are LinkedIn native and are the likely matches, but likely is not good enough for a table that decides
who is called first. An unmapped code is reported, never translated. A map entry pointing at a signal
type this system does not define is refused, because it would drop the signal silently.

## What is needed to switch it on

1. **The answer on entitlement.** Either Searchical is operated by CDW under CDW's agreement, or
   Searchical gets its own agreement or LinkedIn's written consent. This is a question for whoever at
   CDW holds the agreement, and probably for counsel.
2. **The spec:** endpoint, authentication, tool list, argument and result shapes, rate limits.
3. **The terms:** what may be kept, for how long, for what purpose, and any display or attribution
   obligations.
4. **The signal vocabulary**, so the map can be filled from documentation rather than inference.

With those, the work left is writing the transport and filling the map. Everything around them is
already tested.

## One etiquette rule that applies from the first signal

Never tell someone you saw their Open to Work setting. A recruiter only setting is shared on the
understanding it stays with recruiters, and quoting it back to them breaks that confidence in the
first sentence.
