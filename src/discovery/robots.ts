/**
 * The Robots Exclusion Protocol, as much of it as matters here.
 *
 * Standardised as RFC 9309 in September 2022, which is worth knowing because it
 * turned a twenty five year convention into a specification with defined
 * matching rules. Those rules are not obvious and getting them wrong in the
 * permissive direction is the whole risk:
 *
 *   - Group selection is by the MOST SPECIFIC matching user agent, not the
 *     first group in the file. A crawler that reads the `*` group while a group
 *     naming it sits further down is ignoring an instruction addressed to it.
 *   - Rule selection inside a group is by the LONGEST matching path, not by
 *     document order, and Allow wins a tie. A short Disallow does not beat a
 *     long Allow.
 *   - An empty Disallow value allows everything. A Disallow of "/" denies it.
 *
 * `*` and `$` are the only wildcards, and both are in the standard.
 *
 * What this deliberately does NOT do is treat a missing or unreachable
 * robots.txt as permission. A fetch that cannot establish the rules does not
 * proceed, which is the opposite of the usual crawler default and the right
 * choice for a system taking data about named individuals.
 */

export interface RobotsRule {
  readonly allow: boolean;
  readonly path: string;
}

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelayMs: number | null;
}

export interface Robots {
  readonly groups: readonly RobotsGroup[];
}

export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelayMs: number | null = null;
  // A blank line does not end a group; a new User-agent line after rules does.
  let collectingAgents = false;

  const flush = () => {
    if (agents.length > 0) groups.push({ agents, rules, crawlDelayMs });
    agents = [];
    rules = [];
    crawlDelayMs = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!collectingAgents && agents.length > 0) flush();
      agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (field === 'disallow') rules.push({ allow: false, path: value });
    else if (field === 'allow') rules.push({ allow: true, path: value });
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.round(seconds * 1000);
    }
  }
  flush();
  return { groups };
}

/** The group addressed to this agent, most specific first, falling back to `*`. */
export function groupFor(robots: Robots, userAgent: string): RobotsGroup | null {
  const agent = userAgent.toLowerCase();
  let best: { group: RobotsGroup; length: number } | null = null;
  for (const group of robots.groups) {
    for (const candidate of group.agents) {
      if (candidate === '*') continue;
      if (agent.includes(candidate) && (best === null || candidate.length > best.length)) {
        best = { group, length: candidate.length };
      }
    }
  }
  if (best) return best.group;
  return robots.groups.find((g) => g.agents.includes('*')) ?? null;
}

/** RFC 9309 path matching: `*` is any run, `$` anchors the end. */
function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

export interface RobotsVerdict {
  readonly allowed: boolean;
  /** The rule that decided it, so a refusal can be shown rather than asserted. */
  readonly rule: string;
  readonly crawlDelayMs: number | null;
}

export function isAllowed(robots: Robots, userAgent: string, url: string): RobotsVerdict {
  const group = groupFor(robots, userAgent);
  if (!group) {
    return { allowed: true, rule: 'no group applies to this agent', crawlDelayMs: null };
  }

  const path = pathOf(url);
  let winner: RobotsRule | null = null;
  for (const rule of group.rules) {
    // An empty Disallow value means "allow everything" and matches nothing.
    if (rule.path === '') continue;
    if (!pathMatches(rule.path, path)) continue;
    if (winner === null
      || rule.path.length > winner.path.length
      // Longest match wins; Allow breaks a tie of equal length.
      || (rule.path.length === winner.path.length && rule.allow && !winner.allow)) {
      winner = rule;
    }
  }

  if (winner === null) {
    return { allowed: true, rule: 'no rule matches this path', crawlDelayMs: group.crawlDelayMs };
  }
  return {
    allowed: winner.allow,
    rule: `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.path}`,
    crawlDelayMs: group.crawlDelayMs,
  };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url.startsWith('/') ? url : `/${url}`;
  }
}

export const robotsUrlFor = (url: string): string => {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/robots.txt`;
};
