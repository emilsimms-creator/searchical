import { describe, expect, it } from 'vitest';
import { DISCOVERY_SOURCES, enabledSources, searchableSources, sourceById } from '@/discovery';

describe('the discovery source catalogue', () => {
  it('holds LinkedIn as a pointer surface, never a record surface', () => {
    const linkedin = sourceById('linkedin_public_xray')!;
    expect(linkedin.persistence).toBe('manual_entry_only');
    // The same position the connector contract enforces in the type system.
    expect(linkedin.terms.summary).toMatch(/nothing from this surface reaches the ledger/);
  });

  /**
   * The rule that makes this catalogue worth having: an unread terms position
   * is a liability that looks like a feature.
   */
  it('lets nothing persist until a human has read and dated its terms', () => {
    for (const source of enabledSources()) {
      expect(source.terms.verified, source.id).toBe(true);
      expect(source.terms.verifiedOn, source.id).not.toBeNull();
    }
    const unverifiedButPersisting = DISCOVERY_SOURCES.filter(
      (s) => s.persistence === 'persist' && !s.terms.verified,
    );
    expect(unverifiedButPersisting.every((s) => !enabledSources().includes(s))).toBe(true);
  });

  it('is honest that almost nothing has been cleared yet', () => {
    // If this number rises, somebody read some terms and dated it. If it rises
    // without that happening, this test is the thing that should have stopped it.
    expect(enabledSources()).toHaveLength(0);
  });

  it('carries a citation on every terms position, verified or not', () => {
    for (const source of DISCOVERY_SOURCES) {
      expect(source.terms.citation, source.id).toMatch(/^(https?|per-[a-z]+|contract):/);
      if (!source.terms.verified) {
        expect(source.terms.openQuestion, source.id).toBeTruthy();
      }
    }
  });

  it('records what GitHub actually prohibits, which is narrower than a ban', () => {
    const github = sourceById('github_xray')!;
    expect(github.terms.verified).toBe(true);
    expect(github.terms.summary).toMatch(/selling personal information to recruiters/);
    expect(github.terms.summary).toMatch(/unsolicited emails/);
    // Reading a public profile is not what the AUP forbids, and overstating the
    // prohibition would be as wrong as ignoring it.
    expect(github.terms.summary).toMatch(/Reading a public profile to identify someone is not prohibited/);
    expect(github.terms.openQuestion).toMatch(/purpose for which the User has authorized it/);
  });

  it('does not pretend to know Stack Overflow terms it could not read', () => {
    const so = sourceById('stack_overflow')!;
    expect(so.terms.verified).toBe(false);
    expect(so.terms.summary).toMatch(/NOT VERIFIED/);
    expect(so.persistence).toBe('manual_entry_only');
  });

  it('says why a senior person is on each surface, which is what separates signal from noise', () => {
    for (const source of DISCOVERY_SOURCES) {
      expect(source.whySeniorPeopleAreHere.length, source.id).toBeGreaterThan(60);
      expect(source.etiquette.length, source.id).toBeGreaterThan(20);
      expect(source.regions.length, source.id).toBeGreaterThan(0);
    }
  });

  it('serves both segments, with the code surfaces aimed at the technologists', () => {
    const exec = searchableSources('senior_executive').map((s) => s.id);
    const consultant = searchableSources('senior_it_consultant').map((s) => s.id);

    expect(exec).toContain('corporate_leadership_pages');
    expect(exec).toContain('regulatory_filings');
    // A VP of Engineering is not found by a repository search, and the live
    // mandate runs showed exactly this failure before the segment bars existed.
    expect(exec).not.toContain('github_xray');
    expect(consultant).toContain('github_xray');
    expect(consultant).toContain('foundation_contributors');
  });

  it('keeps ids unique, because a lead names its source by id', () => {
    const ids = DISCOVERY_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
