import { describe, expect, it } from 'vitest';
import { groupFor, isAllowed, parseRobots, robotsUrlFor } from '@/discovery/robots';

const AGENT = 'SearchicalBot/0.1';

describe('robots.txt, parsed to the standard rather than to habit', () => {
  /**
   * Group selection is by most specific agent, not document order. A crawler
   * reading the `*` group while a group naming it sits further down is ignoring
   * an instruction addressed to it.
   */
  it('takes the group that names this agent, wherever it sits in the file', () => {
    const robots = parseRobots(`
      User-agent: *
      Disallow: /

      User-agent: searchicalbot
      Disallow: /private
    `);
    expect(groupFor(robots, AGENT)!.agents).toEqual(['searchicalbot']);
    expect(isAllowed(robots, AGENT, 'https://example.org/people/ada').allowed).toBe(true);
    expect(isAllowed(robots, AGENT, 'https://example.org/private/x').allowed).toBe(false);
    // Another crawler still gets the blanket refusal.
    expect(isAllowed(robots, 'OtherBot', 'https://example.org/people/ada').allowed).toBe(false);
  });

  it('prefers the longer agent name when two groups could match', () => {
    const robots = parseRobots(`
      User-agent: search
      Disallow: /

      User-agent: searchicalbot
      Allow: /
    `);
    expect(groupFor(robots, AGENT)!.agents).toEqual(['searchicalbot']);
  });

  /** Longest matching path wins, not document order. */
  it('lets a long Allow beat a short Disallow', () => {
    const robots = parseRobots(`
      User-agent: *
      Disallow: /people
      Allow: /people/public
    `);
    expect(isAllowed(robots, AGENT, 'https://example.org/people/private').allowed).toBe(false);
    expect(isAllowed(robots, AGENT, 'https://example.org/people/public/ada').allowed).toBe(true);
  });

  it('breaks an equal length tie toward Allow', () => {
    const robots = parseRobots(`
      User-agent: *
      Disallow: /team
      Allow: /team
    `);
    expect(isAllowed(robots, AGENT, 'https://example.org/team/ada').allowed).toBe(true);
  });

  it('treats an empty Disallow as permission, and a slash as refusal', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), AGENT, 'https://x.org/a').allowed).toBe(true);
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /'), AGENT, 'https://x.org/a').allowed).toBe(false);
  });

  it('understands the two wildcards the standard defines', () => {
    const robots = parseRobots(`
      User-agent: *
      Disallow: /*/drafts
      Disallow: /search$
    `);
    expect(isAllowed(robots, AGENT, 'https://x.org/blog/drafts/one').allowed).toBe(false);
    expect(isAllowed(robots, AGENT, 'https://x.org/search').allowed).toBe(false);
    // Anchored, so a longer path is not caught by it.
    expect(isAllowed(robots, AGENT, 'https://x.org/searching').allowed).toBe(true);
  });

  it('keeps several agents sharing one group together', () => {
    const robots = parseRobots(`
      User-agent: alpha
      User-agent: searchicalbot
      Disallow: /no
    `);
    expect(groupFor(robots, AGENT)!.rules).toEqual([{ allow: false, path: '/no' }]);
  });

  it('starts a new group when rules are followed by another agent line', () => {
    const robots = parseRobots(`
      User-agent: alpha
      Disallow: /one
      User-agent: beta
      Disallow: /two
    `);
    expect(robots.groups).toHaveLength(2);
    expect(robots.groups[1]!.rules).toEqual([{ allow: false, path: '/two' }]);
  });

  it('reads a crawl delay and reports it in milliseconds', () => {
    const robots = parseRobots('User-agent: *\nCrawl-delay: 2.5\nDisallow: /x');
    expect(isAllowed(robots, AGENT, 'https://x.org/a').crawlDelayMs).toBe(2500);
  });

  it('ignores comments and blank lines without ending a group', () => {
    const robots = parseRobots(`
      # a comment
      User-agent: *

      Disallow: /private  # trailing comment
    `);
    expect(isAllowed(robots, AGENT, 'https://x.org/private/a').allowed).toBe(false);
  });

  it('names the rule that decided, so a refusal can be shown rather than asserted', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /private');
    expect(isAllowed(robots, AGENT, 'https://x.org/private/a').rule).toBe('Disallow: /private');
  });

  it('allows when a file exists but says nothing about this path', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /admin');
    const v = isAllowed(robots, AGENT, 'https://x.org/people/ada');
    expect(v.allowed).toBe(true);
    expect(v.rule).toBe('no rule matches this path');
  });

  it('finds robots.txt at the host root, whatever the path', () => {
    expect(robotsUrlFor('https://example.org/deep/page?x=1')).toBe('https://example.org/robots.txt');
  });
});
