# Compensation

**Status:** Complete. 38 compensation tests, part of 266 passing overall.
**Currency:** CAD throughout, stored explicitly on every figure.
**Audience:** Engineers. The reasoning is written so a recruiter can argue with it.

Three parts of this system already referred to a compensation band that did not exist. Factor 8 of
the receptivity model is "Compensation openness and fit" and carries five points with nothing to
weigh. `calls.compensation_discussed` is a boolean with no figure behind it, so the system knew pay
was raised and not whether it landed. And the intake gaps never asked for a band, so a search could
run to offer before anyone discovered the number did not work. That last one is the expensive
failure: a search that dies at offer on a number knowable at intake has burned the whole sequence
budget, the client's patience and the candidate's goodwill.

## The shape

**A band belongs to the mandate, not to a level.** A mandate is one role at one level, which is
also how the channel plan and the pipeline arithmetic already treat it. A search covering two levels
is two mandates. If the practice later needs banded levels inside one search, the change is a level
column and a widened unique index, not a redesign.

**A band is versioned, never edited.** It is the single field on a mandate most likely to be revised
mid search, and a silent overwrite destroys the answer to the only question that matters afterwards:
what were we telling candidates in week two? One live version per mandate, enforced by a partial
unique index. Superseding and inserting happen inside one database function, because a caller that
did the two halves itself and got interrupted between them would leave a mandate with two live bands,
which is two recruiters quoting two different numbers on the same search.

**Money is cents, as integers.** Never a float. A rounding error in a compensation band is one a
candidate notices.

**Currency is carried on every row and defaults to CAD.** The practice quotes Canadian dollars; the
system identifies talent globally, so an expectation will eventually arrive in another currency.
There is no conversion anywhere in this module, deliberately: converting needs a rate, a date and a
source, and a number converted at an unrecorded rate cannot be defended to a client. Figures in
different currencies are reported as incomparable until somebody supplies the rate.

**Pension has its own field.** Not a line inside the equity note. A defined benefit pension is a
material part of total reward at exactly the Canadian employers this practice recruits from, the
Bank of Canada, NAV CANADA, Hydro One, the provincial Crowns, and a base compared against a private
sector band without it misleads the candidate and the recruiter in the same direction.

## Provenance and confirmation

A band carries the same contract as a mandate constraint: `inferred` plus a `source_quote` checked
verbatim against the specification. On top of that it carries a confirmation, for the same reason
the market vocabulary does.

**An inferred band cannot be confirmed.** The database refuses it and so does the service. A market
estimate that a recruiter confirmed reads downstream exactly like a number the client committed to,
and the person who discovers the difference is the candidate, at offer.

**Only a confirmed band is quotable, and only a confirmed band is compared.** The reply ladder
already tells a recruiter to answer a compensation question with a range anchored to track record.
`quotableRange()` is where that range comes from, and it returns a refusal with a reason rather than
a number when the band is absent, inferred or unconfirmed. The send gate enforces the same rule
independently: a draft that mentions money at all is blocked unless the mandate's band is confirmed.
That detector over-detects on purpose. A false positive costs a recruiter one look at a draft; a
false negative puts an unapproved figure in front of a senior candidate and cannot be taken back.

## Pay transparency, and the feature that would have been wrong

The tempting feature is: an Ontario posting with no salary range is non-compliant, so flag it. That
feature would be wrong most of the time for this practice.

Ontario's requirement took effect **1 January 2026** under the Employment Standards Act, 2000, and
O. Reg. 476/24 sets its limits: an advertised range may not exceed the equivalent of **$50,000** a
year, and the requirement **does not apply where the expected compensation, or the top of the range,
exceeds the equivalent of $200,000** a year, nor to employers with fewer than 25 employees. Most
senior technology executive mandates sit above that exemption. A missing band in an Ontario posting
for a VP of Engineering is usually lawful and tells you nothing at all.

So what the system encodes is the rule and its exemptions, and what it produces is a question for
the hiring leader rather than a verdict. In Ontario the question adds a useful edge: ask whether the
client treated the posting as exempt, because their answer locates the band roughly before they name
it.

British Columbia's Pay Transparency Act, SBC 2023 c 18, requires the expected pay or range with no
upper exemption and no cap on range width, so the same silence there is worth asking about directly.
Prince Edward Island has required it since 2022 with no employer size threshold. Newfoundland and
Labrador passed the Pay Equity and Pay Transparency Act in 2022 but its posting provisions are not
yet in force.

## Pay history, and an unresolved question for counsel

**British Columbia and Prince Edward Island both prohibit employers from asking an applicant what
previous employers paid them.** Whether a search firm acting as the client's agent is caught by those
provisions is a legal question this code does not answer and should not.

The system takes the conservative route regardless. It is built around the candidate's
**expectation**, which is the more useful number anyway, and it will hold a **current package** only
where the person volunteered it unprompted and a lawful basis is recorded against the row. Both
conditions are enforced at the service and again as a database CHECK, so a caller that skips the
service is refused too. Where the jurisdiction restricts asking, the jurisdiction is written into the
row so a later review can find it. An unrecognised location is treated as restricted, because the
safe default for a question nobody needs to ask is not to ask it.

**This needs a decision.** The practice's own Receptivity Scorecard describes a five on factor 8 as
"discloses the current package and the expectation is within range." That rewards collecting exactly
what these statutes restrict. The implementation here scores fit from the expectation alone and
leaves the scorecard wording untouched, because changing the practice's own instrument is not a
change to make unilaterally. It is worth putting to counsel alongside the agency question.

## What the gap analysis does, and refuses to do

`analyseGap()` compares the candidate's expectation against the confirmed band and returns one of
six verdicts with a sentence a recruiter can act on. Where the candidate gave a range it takes the
top, because that is what they will hold out for. Above the band it reports how far over and calls
anything beyond twenty percent the gap that kills searches at offer. Below the floor it says check
the level rather than congratulating anyone on a bargain: an expectation under the floor usually
means the person has read the role as smaller than it is.

It proposes a factor 8 score and will not assign one. Factor 8 is openness **and** fit. The gap
answers fit; whether someone would discuss pay at all is a judgment about a conversation that no
arithmetic on two numbers can make.

## Open

The twenty percent unbridgeable threshold and the five percent ceiling tolerance are practice
defaults, not findings. They are the kind of number that should be replaced with the practice's own
once enough searches have run to measure where offers actually fail.
