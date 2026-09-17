# Profile depth promotion

**Status:** Complete. 51 promotion, robots, redirect and budget tests, part of 404 passing overall.
**Audience:** Engineers, and anyone who needs to know what this system fetches and what it keeps.

Screening at snippet depth judges forty words a search engine chose. Promotion reads the page, so
the screen has something real to work with. It is also the first place this system reaches out and
takes content from somebody else's server, which makes three things real at once: the site's terms,
its robots.txt, and the load we put on it.

## Fetching and keeping are different permissions

Conflating them gets one of them wrong. The source catalogue now carries `automatedFetch` separately
from `persistence`.

LinkedIn is the clear case. Its User Agreement prohibits automated access, so the page is **never
fetched by this system at any depth**, whatever anyone intends to do with the result afterwards. It
is not a robots decision; the system does not even ask. A human opens the profile on their own seat,
as they always did.

Everywhere else the site's own robots.txt is the operative instruction.

## What is kept: nothing

`Promoter` writes to no table. It returns the page text so the screening layer can read it in
memory, along with the retention the source's terms allow, and the caller discards the body once a
verdict exists.

Every source in the catalogue currently returns `ephemeral`, because none has cleared its terms. So
today promotion **sharpens a judgment without creating a record**. That is the correct default
rather than a limitation: the reading is real, the retention waits for a human to read the terms and
date it.

## Robots, to the standard rather than to habit

The Robots Exclusion Protocol became RFC 9309 in September 2022, which turned a twenty five year
convention into a specification with defined matching rules. Those rules are not obvious and getting
them wrong in the permissive direction is the entire risk, so all three are implemented and tested:

Group selection is by the **most specific matching user agent**, not the first group in the file. A
crawler that reads the `*` group while a group naming it sits further down is ignoring an
instruction addressed to it. Rule selection inside a group is by the **longest matching path**, not
document order, with Allow breaking a tie: a short Disallow does not beat a long Allow. An empty
Disallow value allows everything; a Disallow of `/` denies it.

**An unreachable robots.txt is a refusal, not permission.** The usual crawler default is to proceed
when the file is missing or the request errors. This refuses, because the thing being fetched is a
page about a named individual and the cost of being wrong is not symmetrical. A 404 is treated as
unrestricted, because under the standard an absent file genuinely is an answer; a 500 is not an
answer and gets no benefit of the doubt.

The crawler identifies itself, with a contact URL, rather than pretending to be a browser. robots.txt
is read once per host and a crawl delay is honoured, with a two second floor per host even where the
site names none.

## Redirects are re-checked against the host that answers

The platform's `fetch` will happily follow a redirect to another host, and that host's robots.txt
would never be consulted. That was a real defect rather than a missing feature: **a site that
disallows this crawler could be reached anyway by any page elsewhere that happened to redirect to
it.**

So the fetcher uses `redirect: 'manual'` and hands the target back, and the promoter loops: resolve
the location against the page it came from, work out the new host, read that host's robots.txt, and
apply its rules. Every hop, not just the first. A chain longer than five is a loop or a page that
does not want to be read, and is refused as such.

Each promotion carries its `chain`, every URL actually requested in order. More than one entry means
the page redirected, and **the last entry is what was really read**. That is what a citation should
name: citing the URL you asked for when a different one answered is a small lie that becomes a
problem the first time somebody checks.

A cross-host redirect also waits on the new host's own crawl delay rather than inheriting the first
host's.

## The fetch budget

The crawl delay bounds the **rate** and bounds nothing else, which is how a mandate with a wide
market and a permissive robots file quietly sends several hundred requests to a small conference
site over an afternoon. Politeness at two seconds a request is still a lot of requests.

`Promoter` carries a budget, per host and in total, defaulting to 25 and 250. **Every request
counts**: robots.txt, the page, and each redirect hop. Undercounting would defeat the purpose,
because a redirect chain is three requests to someone's server however it is described in the code.
Enforcement sits in the one method every outbound request passes through, so the budget counts what
was actually sent rather than what the code meant to send.

Exhausting the budget is a stop, not a failure. Leads not reached keep their snippet verdict and say
why they were not read, and `spend()` reports the run's load so it can be stated rather than
guessed.

## Fetch cheap first

`promoteAndRescreen` spends a request only on leads the snippet screen did not already settle.

A lead the mandate's own exclusions rejected is never fetched: nothing a page could say would change
the verdict, so fetching it would be load on a stranger's site in exchange for nothing. A `hold` is
fetched, because thin evidence is exactly what promotion is for, and in the worked example a lead
held on its snippet advances once the page is read.

A refused promotion is not a failure. The lead keeps its snippet verdict and carries the reason, so
a recruiter can see the page was not read and why, rather than assuming it was.

## Reading a page without reading the furniture

`htmlToText` drops scripts, styles, navigation and footers before anything else. That is not
tidiness: a page whose footer lists every product a company sells would otherwise appear to prove
the person knows all of them, which is the commonest source of a false skill match.

A stated location is taken **only** from a machine readable declaration the author put there on
purpose, schema.org address markup or an explicit label. Never from prose, a top level domain, a
language or a name. Guessing a place is how a screen starts inferring things it has no business
inferring, and the screening layer still treats a stated location as weak evidence even when it is
real.

The protected ground rules hold unchanged at profile depth. A page that states a city does not make
citizenship checkable, and a test pins that.

## Not proven live

`httpPageFetcher` has never made a live call, like the Brave adapter before it: the environment this
was written in blocks outbound fetches to arbitrary hosts. The size cap, the timeout, the redirect
handling and the capped streaming read are written from the platform's documented behaviour and
covered by tests against a recorded fetch. Whoever runs it against the open web first should expect
to fix something.

`npm run discover` shows the whole chain against recorded pages: catalogue, queries, leads, snippet
screen, then promotion.

## Open

**No caching between runs.** Re-running a mandate refetches every page. Storing fetched bodies would
change the retention answer, so the cache needs its own terms position rather than being added as an
optimisation.

**A cross-host redirect is followed without questioning relevance.** Robots now governs whether it
may be fetched, which was the defect. Whether a lead from a conference programme that lands on an
unrelated host is still evidence about the same person is a separate question, and the `chain` makes
it visible rather than answering it.

**The budget is per run, not per period.** Two runs an hour apart each get a fresh allowance. A
standing daily cap per host would be the honest next step if this ever runs on a schedule.
