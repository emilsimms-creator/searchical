# Profile depth promotion

**Status:** Complete. 38 promotion and robots tests, part of 391 passing overall.
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

**No per source fetch budget.** A mandate with a wide market and a permissive robots file could put
real load on a small conference site. The crawl delay bounds the rate but nothing bounds the total,
and it should.

**No caching between runs.** Re-running a mandate refetches every page. Storing fetched bodies would
change the retention answer, so the cache needs its own terms position rather than being added as an
optimisation.

**Redirects are followed without re-checking robots.** A redirect to another host is currently
fetched under the first host's rules. That is wrong and worth fixing before this runs at volume.
