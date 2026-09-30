import { describe, expect, it } from 'vitest';
import { fixtureSearchProvider, harvest, type SearchHit } from '@/discovery';
import { personShaped, screen, screenLeads } from '@/screening';
import type { MandateConstraint, MandateTerm } from '@/mandate/types';

/**
 * Regression tests from the live end to end run against a real University of
 * Ottawa specification (Lead Analyst, IT Security) on 30 September 2026.
 *
 * The hits below are the real results the generated foundation and conference
 * queries returned. None of them is a person. Before the fix, fourteen of these
 * sixteen advanced, and the one genuine lead, a local IAM summit, came last.
 * Every URL is a public documentation or event page; no individual is named.
 */
const t = (kind: MandateTerm['kind'], term: string, rank: number): MandateTerm =>
  ({ kind, term, origin: 'extracted', status: 'confirmed', observedCount: null, rank });

const TERMS: MandateTerm[] = [
  t('title_variant', 'IAM Architect', 1), t('title_variant', 'Lead IAM Engineer', 2),
  t('title_variant', 'Lead Analyst, IT Security', 3),
  t('must_have_skill', 'Identity and Access Management', 1), t('must_have_skill', 'SAML', 2),
  t('must_have_skill', 'OAuth', 3), t('must_have_skill', 'SCIM', 4), t('must_have_skill', 'RBAC', 5),
  t('exclusion', 'junior', 1), t('exclusion', 'intern', 2),
];

const CONSTRAINTS: MandateConstraint[] = [
  { kind: 'prior_experience', severity: 'disqualifying', inferred: false, statement: 'At least 7 years of experience in identity and access management.' },
  { kind: 'language', severity: 'strong_preference', inferred: false, statement: 'Written and spoken French and English.' },
  { kind: 'location_or_onsite', severity: 'strong_preference', inferred: false, statement: 'Office based on a multi-building site.' },
];

const h = (url: string, title: string, rank: number): SearchHit => ({ url, title, snippet: '', rank });

const REAL_HITS: SearchHit[] = [
  h('https://cloudsecurityalliance.org/artifacts/navigating-identity-and-access-management-iam', 'Identity and Access Management (IAM) Standards', 1),
  h('https://github.com/topics/saml', 'saml · GitHub Topics · GitHub', 2),
  h('https://www.udemy.com/course/identity-access-management-learn-oauth-openidsaml-ldap/', 'Identity & Access Management-Learn LDAP, SAML, OAuth, OpenID', 3),
  h('https://www.loginradius.com/blog/identity/what-is-scim', 'What is SCIM? How SCIM Provisioning Works?', 4),
  h('https://en.wikipedia.org/wiki/SAML-based_products_and_services', 'SAML-based products and services', 5),
  h('https://www.loginradius.com/blog/engineering/rbac-enterprise-sso-federation', 'Role-Based Access Control Best Practices in SAML & OIDC', 6),
  h('https://www.codecademy.com/article/identity-and-access-management-iam-technical-guide', 'Identity and Access Management (IAM): Technical Guide', 7),
  h('https://securityboulevard.com/2025/02/sso-deep-dive-saml-oauth-and-scim-in-enterprise-identity-management/', 'SSO Deep Dive: SAML, OAuth, and SCIM in Enterprise Identity', 8),
  h('https://thenkst.com/iam-summit-2026/', 'IAM Summit 2026', 9),
];

describe('the live uOttawa run', () => {
  it('advances none of the documentation the real search returned', async () => {
    const result = await harvest(
      fixtureSearchProvider(new Map([['q', REAL_HITS]])),
      [{ sourceId: 'conference_programmes', query: 'q', rationale: '' }],
    );
    const screened = screenLeads(result.leads, TERMS, CONSTRAINTS);
    expect(screened.filter((s) => s.verdict === 'advance')).toEqual([]);
    expect(screened.every((s) => s.verdict === 'hold')).toBe(true);
  });

  it('says why a topic match was held, so it does not read as a bug', () => {
    const r = screen({
      evidence: { text: 'Role-Based Access Control Best Practices in SAML & OIDC', sourceId: 'x', depth: 'snippet',
        url: 'https://www.loginradius.com/blog/engineering/rbac-enterprise-sso-federation' },
      terms: TERMS, constraints: CONSTRAINTS,
    });
    expect(r.verdict).toBe('hold');
    expect(r.headline).toMatch(/shows no sign of being a person/);
  });

  /** "based" from "office based" matched inside "Role-Based" before the fix. */
  it('no longer treats common words in a constraint as evidence', () => {
    const r = screen({
      evidence: { text: 'Role-Based Access Control Best Practices', sourceId: 'x', depth: 'snippet' },
      terms: TERMS, constraints: CONSTRAINTS,
    });
    expect(r.matches.map((m) => m.matched)).not.toContain('based');
    expect(r.matches.map((m) => m.matched)).not.toContain('access');
  });

  it('still advances a person with a confirmed role title', () => {
    const r = screen({
      evidence: { text: 'Lead IAM Engineer at a Canadian bank. SAML, SCIM, Saviynt.', sourceId: 'x', depth: 'snippet',
        url: 'https://example.org/blog/post' },
      terms: TERMS, constraints: CONSTRAINTS,
    });
    expect(r.verdict).toBe('advance');
  });

  it('advances skills alone only on a page shaped like a person\'s own', () => {
    const onProfile = screen({
      evidence: { text: 'SAML and SCIM integrations', sourceId: 'x', depth: 'snippet',
        url: 'https://conf.example.org/speakers/ada-okafor' },
      terms: TERMS, constraints: [],
    });
    expect(onProfile.verdict).toBe('advance');
  });

  it('reads a named language as a real observation, not a common word', () => {
    const r = screen({
      evidence: { text: 'Lead IAM Engineer, bilingual French and English, SAML.', sourceId: 'x', depth: 'snippet' },
      terms: TERMS, constraints: CONSTRAINTS,
    });
    const language = r.matches.find((m) => m.statement.includes('bears on "Written and spoken French and English."'));
    expect(['english', 'french', 'bilingual']).toContain(language?.matched);
  });

  it('knows a person page from a topic page', () => {
    expect(personShaped('https://www.linkedin.com/in/someone')).toBe(true);
    expect(personShaped('https://identiverse.com/idv26/speakers/someone')).toBe(true);
    expect(personShaped('https://stackoverflow.com/users/123/someone')).toBe(true);
    expect(personShaped('https://github.com/someone')).toBe(true);
    expect(personShaped('https://github.com/topics/saml')).toBe(false);
    expect(personShaped('https://www.udemy.com/course/identity-access-management/')).toBe(false);
    expect(personShaped('https://en.wikipedia.org/wiki/SAML-based_products_and_services')).toBe(false);
    expect(personShaped(undefined)).toBe(false);
  });
});
