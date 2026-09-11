# Searchical: Executive Summary

**Status:** Design for decision. September 2026.
**Companion document:** [Technical Architecture](architecture.md)
**Prepared by:** Principal Web Developer and Technical Lead
**Prepared for:** Emil Simms, as operator and owner

---

## 1. What is being built

Searchical turns a job specification into a named, prioritised, contactable shortlist of senior
technology talent anywhere in the world, and then runs the conversation that converts that
shortlist into exploratory calls.

It does four things in sequence.

It **reads the mandate**. A job specification goes in. The system extracts what the person must
accomplish rather than what boxes they must tick, expands the client's title into the titles the
market actually uses, defines the talent universe including the adjacent sectors where the same
capability lives, and produces the search strings and the channel plan for that specific role. It
also does the pipeline arithmetic, so the recruiter knows on day one that ten real conversations
means roughly one hundred people contacted, not thirty.

It **finds the people and watches the clock**. Identification runs globally from licensed
professional data, public evidence of work, and the practice's own growing database. Separately
and continuously, the system watches the employers on the target list for the events that make
whole teams receptive at once: a return to office mandate, a new chief executive, an acquisition,
a funding round, a headcount decline, a bonus cycle closing. When one of those fires, every person
the system tracks at that employer is re-ranked within the hour.

It **scores receptivity honestly**. Twenty three typed signals feed an eight factor weighted model
that decays over time, tiers each person Hot, Warm or Cool, and sets the next touch date from that
tier. The score is decision support and the system says so on the screen. It tells the recruiter
who to call first, not whether the person will move.

It **runs the approach**. A five to six touch sequence across LinkedIn, email, the hiring leader's
own voice and the telephone, drafted against eight proven templates, personalised with a verified
specific hook, and **approved by a human before anything sends**. Replies are classified against a
response ladder so that a polite decline routes to nurture rather than to silence, and every
conversation ends with the referral ask.

---

## 2. Why this wins

Most recruiting software optimises the wrong number. It counts messages sent, profiles viewed and
candidates added. The research underneath this system says plainly that **the win is forward
progress along the interest scale and a booked exploratory conversation**, and that somewhat
personalised outreach performs no better than none at all. A system that makes it easy to send
more mediocre messages actively destroys value.

Searchical is built around four claims that competitors do not make.

**Openness is a state, not a trait, so the system models time as a first class thing.** The same
leader who is unreachable in January is receptive in March once the bonus lands. Every signal in
the system is a timestamped event with an expiry, every score decays when the relationship goes
quiet, and the employer is watched independently of the person because that is where the starting
gun actually fires. Software that stores openness as a field on a record cannot do this.

**Provenance is not a compliance feature, it is the product.** Every attribute, every signal and
every score records where it came from, how it was collected, on what lawful basis, how confident
the system is, and when it expires. That single decision is what makes the system defensible under
Canadian and European privacy law, honours the right to be forgotten that the executive search
profession's own standards grant candidates, and gives the recruiter the one thing that opens a
senior conversation: a specific, truthful reason for the call.

**The score is a hypothesis the system is built to test.** There is no validated predictive model
of candidate openness in the published research. Every scoring construct in the field, including
the one in this design, is a practitioner heuristic. Searchical therefore versions its scoring
model, records which version produced every historical score, and can replay the practice's own
history under a revised model to show whether it would have ranked better. **After two years of
operation the practice owns something nobody else in the market has: a calibrated, evidence backed
model of senior technology receptivity, built from its own outcomes.** That is the durable asset
here, and it accumulates from the first search.

**Human judgment is designed in, not bolted on.** The system drafts, personalises, schedules and
queues. A person approves before anything reaches a candidate. This is the right call ethically,
it is what the profession's standards expect, it keeps the platform clear of the regulatory
category reserved for automated employment decision tools, and it protects the personalisation
quality that the evidence says is the entire game. It also produces a quietly valuable dataset:
what the recruiter accepted, what they edited, and how they edited it.

---

## 3. What it cannot do, stated plainly

**No compliant system anywhere can search LinkedIn programmatically.** LinkedIn's Talent Solutions
APIs are partner gated and they synchronise records between an applicant tracking system and a
Recruiter seat. None of them exposes member search. The obvious workaround is a litigated dead
end: LinkedIn's ban on scraping is enforceable as contract, and in 2025 LinkedIn sued and shut
down Proxycurl, the largest LinkedIn data interface in the market, which removed roughly half of a
ten million dollar business overnight. Any architecture that ingests LinkedIn profiles is a
business risk wearing a technical costume.

**The consequence is a deliberate split.** LinkedIn stays exactly what it is in the practice
today, a human operated identification and messaging surface. The recruiter works the Recruiter
seat, and Searchical captures the outcome of that work rather than the platform's data. Everything
else, the market map, the trigger watching, the scoring, the sequencing, the consent ledger and
the institutional memory, lives in Searchical. **The system is an orchestration and intelligence
layer, not a scraped copy of a social network.**

**Global identification is real; global outreach is phased.** Licensed professional data plus
public evidence of work gives genuine worldwide identification from launch. Outreach starts in
Canada, under Canada's anti spam legislation and federal and Quebec privacy law, and extends to
further jurisdictions as the policy engine is extended. The engine is built to be extended from
day one; the jurisdictions are switched on deliberately rather than optimistically.

**Coverage is uneven by geography and the system will say so.** Professional data coverage is deep
in North America, Western Europe, India and Australia, thinner in Japan, Korea and Latin America,
and effectively absent in mainland China where the professional network of record has no
accessible interface. Searchical will show coverage confidence per region rather than present a
thin result as a complete market map. A search that quietly returns eleven people in Tokyo because
the data is poor, and presents them as the market, is worse than no search at all.

**Vendor performance claims in this category are unverified.** The productivity multipliers quoted
by sourcing platforms, and the accuracy figures quoted by contact data providers, are self
reported. The one independent test located during research verified fifty thousand contacts and
found raw valid email rates between sixty five and seventy one percent, against advertised
accuracy near ninety nine percent. **Treat every contact data export as roughly sixty percent
deliverable until verified, and run a paid bake off before committing to any provider.**

---

## 4. The compliance position

The practice is a Canadian operator contacting senior professionals, so three regimes bind from
launch and a fourth is on the horizon.

Canada's anti spam legislation is the binding constraint on outreach and it is stricter than its
American equivalent. It requires consent, express or implied, before a commercial electronic
message; it puts the burden of proving that consent on the sender; and it requires that every
message identify the sender, give a valid mailing address and carry a working unsubscribe honoured
within ten business days. Recruiting outreach to a prospect is a commercial electronic message.
The mechanism the practice will rely on most is implied consent through conspicuous publication,
which requires that the person published the business address themselves, that no notice beside it
refuses commercial messages, and that the message relates to their role. **Searchical records
which of those three conditions was satisfied, from which source, and on what date, for every
single send.** That record is the defence.

Federal privacy law and Quebec's Law 25 govern collection and storage. Law 25 is the sharper of
the two and requires a privacy impact assessment before personal information is transferred
outside Quebec, which is a direct input into the hosting decision. Canadian data residency is the
recommended default.

European privacy law applies the moment a European person enters the database, which happens
during global identification regardless of where outreach is sent. The obligation that bites is
the notice owed to a person whose data was collected without their knowledge. The system generates
that notice from the provenance record automatically.

The European artificial intelligence regime deserves one correction, because the widely circulated
date is wrong. The high risk obligations for recruitment tools did not commence on 2 August 2026.
The Digital Omnibus, Regulation (EU) 2026/1744, moved them to 2 December 2027. **That is breathing
room, not a reprieve.** The obligations it defers, data governance, logging, human oversight and
technical documentation, are precisely the things that cost ten times more to retrofit than to
build in. This design builds them in now and treats the deferral as a gift of sequencing rather
than a reason to skip the work.

I am not a lawyer. Every statement in this section should be confirmed by Canadian privacy counsel
before the system sends its first message, and the Quebec privacy impact assessment should be
commissioned before the hosting region is fixed.

---

## 5. Shape of the build

Four phases, each of which leaves the practice better off than it was, and none of which depends
on the next one being funded.

**Phase one delivers the mandate engine.** A job specification goes in and a complete channel
plan, search string set and pipeline projection comes out. This is the Outreach Channel Matrix
workbook turned into software. It is immediately useful on its own and it is the cheapest thing to
get right.

**Phase two delivers the receptivity engine and the trigger watchlist.** People and employers
become records, signals become events, the eight factor score goes live, and the employer watchlist
starts firing. This is where the compounding asset starts accumulating and it should not be
deferred, because the value of the historical record is a function of how early it starts.

**Phase three delivers the engagement engine.** Sequences, drafting, the approval queue, sending
from the recruiter's own mailbox, reply classification and the consent ledger. This is the phase
with the regulatory surface and it is deliberately last among the core three so that the policy
engine is built against real data rather than imagined data.

**Phase four closes the loop.** Source of hire tracking feeds the channel fit ratings, outcome
data feeds score calibration, and the system starts tuning itself against the practice's own
results instead of published industry averages. **This phase is what converts the system from a
good tool into a proprietary asset, and it is the one most organisations never build.** It is
scoped here from the beginning so that the instrumentation it needs is present in phases one
through three rather than retrofitted.

---

## 6. What success looks like

The system should be judged against numbers the source research already establishes, not against
vanity metrics.

A full outreach sequence should draw a combined response rate between fifteen and twenty five
percent. Above thirty percent means the targeting and brand are strong. Below ten percent means
the targeting, the message or the brand needs work, and the system should say which. About half of
all replies will be polite declines, and that is normal rather than failure. Every exploratory
call should produce two to three warm referrals. No candidate in an active pipeline should go more
than a tier appropriate interval without a meaningful touch, because pipelines go functionally
inactive within a month when follow up is not systematised.

Two further measures matter to the system itself. **The approval edit rate** tells you whether the
drafting is actually good: if recruiters rewrite every message, the drafting is theatre. **Score
calibration**, measured as whether Hot rated people convert at a higher rate than Warm rated
people, tells you whether the model is earning its place or merely producing confident numbers.
The system should surface both, and should be honest when the answer is unflattering.

---

## 7. Decisions needed from you

These are the open items. None of them blocks the architecture, and all of them shape the build.

**The licensed data provider.** In scope, and it is the difference between real global reach and
aspirational global reach. The recommendation is a paid, time boxed bake off between two or three
providers on a real search, measured on coverage in your actual target geographies, on match
accuracy against people you already know, and on the contractual answer to one question: on what
lawful basis was this data collected, and will you indemnify us. Vendor claims should carry no
weight in that decision.

**The hosting region,** which follows from the Quebec privacy impact assessment and should be
settled before the first line of infrastructure code.

**Whether the practice is the only tenant.** The schema is multi tenant from the first migration
because retrofitting tenancy is brutal, but the launch is single tenant. If opening the platform to
other search firms is a real ambition rather than a distant one, a few decisions change shape now
rather than later.

**Who builds it.** The technology choices in the architecture are deliberately mainstream and
deliberately boring, chosen so that the hiring pool is large and the operational burden on a small
team is small. That constraint should be confirmed rather than assumed.

**Whether to commission counsel now.** My recommendation is yes, and before phase three rather
than during it.

---

*Continue to the [Technical Architecture](architecture.md) for the system design, data model,
connector strategy and build plan.*
