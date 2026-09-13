import type { MessageTemplate } from './types';

/**
 * The eight message templates, generated from the practice's own Playbook
 * (Candidate Openness and Outreach Playbook, section 4.6, September 2026) so
 * the copy and the principles behind each are the researched text rather than a
 * paraphrase.
 *
 * `hookTokens` is the field this system adds. It names the bracketed fields
 * that must be filled from VERIFIED, PERSON SPECIFIC evidence rather than from
 * the mandate. That distinction is the whole personalisation gate: "[first
 * name]" and "[city]" are fill, while "[specific achievement, talk or
 * programme]" is the reason the message is worth sending, and the research is
 * unambiguous that somewhat personalised outreach performs no better than none
 * at all.
 *
 * Two templates carry no hook tokens on purpose. The polite close and the
 * referral ask are responses to a relationship that already exists, and
 * demanding fresh evidence to send them would block the two highest converting
 * messages in the sequence.
 */
export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
  {
    ordinal: 1,
    code: "linkedin_connection_note",
    name: "LinkedIn connection note (under 300 characters; best for senior IT consultants)",
    channel: "linkedin_connection",
    defaultTouch: 1,
    segments: ["senior_it_consultant"],
    requiresPersonalEvidence: true,
    hookTokens: ["platform or migration", "company"],
    body: "Hi [first name], I follow the [platform or migration] work your team has been shipping at [company], and I work with several technology leaders in [city or sector] on senior consulting engagements. Not pitching a role; I would value connecting and comparing notes. [Your name], CDW Canada Consulting Services.",
    appliesPrinciples: "connection-then-message conversion (Noon AI, 2026); read-their-profile specificity (Zapar via LinkedIn, 2021); no pitch in the first touch (Adler, 2023).",
    maxChars: 300,
  },
  {
    ordinal: 2,
    code: "first_inmail",
    name: "First InMail (under 400 characters; best for executives)",
    channel: "linkedin_inmail",
    defaultTouch: 1,
    segments: ["senior_executive"],
    requiresPersonalEvidence: true,
    hookTokens: ["specific achievement, talk or program"],
    body: "Hi [first name], your [specific achievement, talk or program] stood out. I lead senior [function] searches for [type of client] across Canada. Would you be open to a short, confidential conversation to see whether something we are building could be a genuine career move, even if the timing is only someday? Happy to work around your schedule. [Your name]",
    appliesPrinciples: "under 400 characters (Lewis, LinkedIn, 2021); the would-you-be-open career-move opener (Adler, 2023); confidential framing (AESC Candidate Bill of Rights).",
    maxChars: 400,
  },
  {
    ordinal: 3,
    code: "first_email",
    name: "First email (under 180 words; executive or senior consultant)",
    channel: "email",
    defaultTouch: 2,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: true,
    hookTokens: ["your work on X at company"],
    body: "Subject: [Role title] | [platform or mandate], [city]. Hi [first name], I am reaching out specifically because of [your work on X at company]; that is the reason this landed in your inbox rather than a mass send. I lead senior [function] searches at CDW Canada Consulting Services, and a client in [sector] is creating a [role] with real scope: [own the platform, lead a team of N, greenfield mandate]. I am not asking you to consider a lateral move. Could we spend 15 minutes exploring whether it is a step up for you? If it is not, I would genuinely value your read on who is doing the best work in this space. Confidential either way. [Your name], [phone].",
    appliesPrinciples: "the reason-you line (+47%, Gem, 2024); sell the discussion, not the job, and no lateral moves (Adler, 2015 and 2016); referral ask on a no (Adler, 2012); confidentiality (AESC); specific subject line (SignalRoster, 2026).",
    maxWords: 180,
  },
  {
    ordinal: 4,
    code: "hiring_leader_followup",
    name: "Follow-up email sent on behalf of the hiring leader (touch two or three)",
    channel: "email",
    defaultTouch: 3,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: true,
    hookTokens: ["specific capability"],
    body: "Subject: Re: [Role title] | [platform or mandate]. Hi [first name], [leader name] here, [title] at [client or practice]. [Recruiter name] flagged your background and I wanted to reach out directly. The problem we are handing this role is [specific challenge], and your experience with [specific capability] is exactly the angle we are missing. Worth a low-key 20 minutes to compare notes? No commitment. [Leader name]",
    appliesPrinciples: "sending on behalf of the leader lifts replies 50% or more and 56% prefer to hear from the hiring manager (Gem, 2024; LinkedIn, 2017); a new angle on every touch (SocialTalent, 2026).",
    maxWords: 200,
    sendAs: "hiring_leader",
  },
  {
    ordinal: 5,
    code: "polite_close",
    name: "Polite close (touch five, around day 14 to 18)",
    channel: "email",
    defaultTouch: 5,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: false,
    hookTokens: [],
    body: "Subject: Closing the loop on [role]. Hi [first name], I will stop filling your inbox. If the timing is not right I completely understand and I will leave the door open. Two quick things before I go: if a confidential exploratory conversation ever makes sense down the road, my line is [phone]; and even if this is not for you, is there one person you rate highly that I should be talking to? Either way, thank you for reading. [Your name]",
    appliesPrinciples: "the polite close is often the highest-converting message (SocialTalent, 2026); keep the relationship warm and ask for referrals on exit (Adler, 2023).",
    maxWords: 200,
  },
  {
    ordinal: 6,
    code: "voicemail",
    name: "Voicemail (25 to 35 seconds)",
    channel: "voicemail",
    defaultTouch: 4,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: true,
    hookTokens: ["mutual contact"],
    body: "Hi [first name], it is [your name] at CDW Canada; [mutual contact] suggested I reach out. I will keep this to ten seconds: I run senior [function] searches and have a confidential, exploratory reason to talk, nothing you need to act on. The best number is [phone], or reply to the email I just sent with the subject [subject]. If now is not the time, no problem at all. Thanks, [first name].",
    appliesPrinciples: "warm referral opener (Savage, 2022); exploratory and confidential (Adler; AESC); the five-element voicemail structure (Zeliq, 2026).",
    maxSeconds: 35,
  },
  {
    ordinal: 7,
    code: "referral_ask",
    name: "Referral ask when the person is not a fit or not interested",
    channel: "email",
    defaultTouch: null,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: false,
    hookTokens: [],
    body: "Completely fair that this is not your moment. You clearly know this space: if you were me, who are the two or three [senior platform engineers or infrastructure leaders] you would want on a shortlist? I will keep your name out of it entirely; I am just trying to talk to the best people, and referrals from people like you are how I find them.",
    appliesPrinciples: "get two or three warm referrals from every exploratory call (Adler, 2012); at least half of a top sourcer's time goes to referrals (Adler, 2015); confidentiality for the referrer (AESC).",
    maxWords: 150,
  },
  {
    ordinal: 8,
    code: "warm_introduction_request",
    name: "Warm-introduction request to a mutual contact",
    channel: "email",
    defaultTouch: null,
    segments: ["senior_executive", "senior_it_consultant"],
    requiresPersonalEvidence: true,
    hookTokens: ["target name"],
    body: "Hi [connector], a quick, no-pressure favour. I am helping [type of client] with a [role] and [target name] would be a fantastic person to talk to, not necessarily to move. Would you be comfortable making a two-line introduction, or telling me if you would rather not? Here is a copy-paste blurb if it helps: [Your name] runs senior technology searches at CDW Canada and had a smart, confidential question about your space; worth 15 minutes. Only if you are comfortable, and thank you either way.",
    appliesPrinciples: "referrals import trust the recruiter cannot manufacture (Ashby via ElevateAI, 2026); make the ask effortless for the connector and give an easy out (Savage, 2022).",
    maxWords: 200,
  },
];
