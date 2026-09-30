# Test run: University of Ottawa, Lead Analyst, IT Security (IAM)

**Date:** 30 September 2026. **Specification:** a real University of Ottawa job description, saved
as `fixtures/uottawa-iam-lead-analyst.txt`. **Result:** the chain ran end to end against a live
model and a real PostgreSQL. Five defects were found and four were fixed.
**Audience:** You as operator, and anyone deciding what to build next.

## What ran

| Stage | Outcome |
| --- | --- |
| Extraction (live model, three runs) | `senior_it_consultant`, with the borderline to executive argued in the rationale. 6 of 6 source quotes verified. Did not infer Ottawa from uOttawa. Bilingualism held as a strong preference because the spec lists it under Other Qualifications |
| Vocabulary | Market titles proposed (IAM Architect, Lead IAM Engineer, Identity Architect). The HR title "Lead Analyst, IT Security" was rated at 0.2 confidence |
| Search plan | 4 strings, 5 channels |
| Compensation | No band stated, so nothing is quotable and a gap is raised |
| Discovery | Generated queries were run against the real web. No person was found; one local event was |
| Screening | Initially advanced 14 of 16 documentation pages. Fixed |
| Engagement | Technologist path: LinkedIn connection note first, then email, email, voicemail, email over 14 days |
| Gates | Over-length note refused. Note missing one of two hooks refused. Draft quoting money refused. Valid note queued |
| Approval queue | The draft rendered with both hooks cited, the purpose of the touch and the evidence behind its wording |

The candidate in the engagement stages was **synthetic**, and its evidence cites example.org.
Discovery found no named person with a verifiable hook. The honest end of the chain on real data is
the personalisation gate refusing to draft, so a synthetic candidate was used to exercise everything
after that point without attributing invented facts to a real person.

## Defects found

**1. A hedged intake answer silenced the question it admitted was open. Fixed.** The spec lists
duties and states no first-year outcomes. The model restated the duties as "twelve months in" and
then wrote that "the specification does not state targets ... the outcome measures themselves are a
question for the hiring leader". Because the field was not null, no gap was raised. The career move
case went null on one run and hedged on the next, so the prompt alone could not be relied on. Fixed
twice: prompt rule five now separates an outcome from a restated duty and forbids hedged answers,
and `admitsNotStated` makes the model's own admission raise the gap deterministically. Confirmed on
three further live runs, and the full eval passes 6 of 6 on the new prompt.

**2. Screening advanced documentation over people. Fixed.** The real hits from the generated queries
went through harvest and screening, and 14 of 16 advanced. None was a person: a Udemy course, a
Wikipedia article, a GitHub topic page, vendor explainers. Skill terms appear far more densely in
documentation about a skill than on the page of anyone who has it. The one real lead, a local IAM
summit, came last. Advance now needs a confirmed role title, or skill matches on a URL shaped like a
person's own page. Skills alone are a hold, with the reason given.

**3. Common words in a constraint counted as evidence. Fixed.** "based" (from "office based")
matched inside "Role-Based", and "access" matched inside "Access Control". Constraint observations
now rest only on specific tokens (a named language, or a credential acronym), and they no longer
count toward a lead's ranking.

**4. Refused policy decisions vanished from the audit trail. Fixed.** Each gate wrote its audit row
inside the transaction that the refusal then rolled back. So allowed decisions were recorded and
refusals were lost, which is the wrong way round. The earlier test had only checked an allowed
decision. `withTenant` now writes a durable copy of a refusal after rollback, marked `rolled_back`,
and each refusal is recorded exactly once either way.

**5. The discovery layer and the channel plan are domain blind. Not fixed; the next build.** The
foundation query is hardcoded to CNCF, Apache and the Linux Foundation. The ambassador query targets
AWS, Microsoft and Google programmes. The channel plan recommends GitHub at 5 of 5 for an IAM lead.
Identity practitioners gather elsewhere: identity conferences, professional and standards bodies,
and IGA vendor communities. On the real web, the generated foundation query returned **0 people in
9 results**. A domain-aware query named practitioners on its first page. This is the same class of
failure as the radar technician pointed at GitHub, one layer further down. Fixing it properly means
domain packs chosen by the mandate's function domain, and the specific bodies and events should be
verified before they are hardcoded.

Also fixed in passing: the dry run now prints the intake fields, so "never invent" can be checked by
reading the report. The length refusal for a connection note no longer cites a finding about InMails.

## What the run says about reach

The pipeline arithmetic calls for 100 people contacted. On the open web, automated discovery for
this mandate returned no people and one event. **This is the clearest evidence so far that real reach
depends on the contracted provider**, or on LinkedIn Signals if the entitlement is sorted, with human
research on the event lists in the meantime.

## Questions this mandate raises for the hiring leader

- Location: which campus, and how many days on site?
- Compensation: the band, the pension (a university defined benefit plan matters here), and how
  much of it is movable.
- First-year outcomes: what must be delivered in twelve months? The spec lists duties, not outcomes.
- Bilingualism: is it tested, and is it a hard bar at offer?
- The spec asks for recommendations on "delivering PeopleSoft solutions". Is that real, or left over
  from the template this job description was built from?

## For a recruiter working this search

Keep the HR title in the vocabulary even though the model rated it low. Canadian universities share
job families like Analyst, Senior Analyst and Lead Analyst, so the peer at another university likely
holds exactly that title. Rejecting it would miss the sector's own talent pool.
