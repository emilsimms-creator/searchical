import { allRules } from './rules';
import { PolicyViolation, type PolicyContext, type PolicyDecision, type PolicyLookups, type PolicyRule } from './types';

/**
 * Policy is evaluated by machine, at the moment of action, at three gates:
 * collection, enrichment and send.
 *
 * The engine evaluates every applicable rule rather than short circuiting on the
 * first denial, because a recruiter who fixes one blocker only to hit the next
 * one learns nothing. A blocked action returns every reason at once.
 *
 * Principle 5, and architecture.md s9.
 */
export class PolicyEngine {
  readonly #rules: readonly PolicyRule[];
  readonly #lookups: PolicyLookups;

  constructor(lookups: PolicyLookups, rules: readonly PolicyRule[] = allRules) {
    this.#lookups = lookups;
    this.#rules = rules;
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyDecision> {
    const applicable = this.#rules.filter((r) => r.gate === ctx.gate && r.appliesTo(ctx));
    const reasons = await Promise.all(applicable.map((r) => r.evaluate(ctx, this.#lookups)));
    return { allowed: reasons.every((r) => r.allowed), gate: ctx.gate, reasons };
  }

  /**
   * Evaluate and throw on denial. Used on the write paths, so that a message
   * which fails policy never reaches the approval queue and a human is never
   * asked to rubber stamp something the system already knows is not permitted.
   */
  async enforce(ctx: PolicyContext): Promise<PolicyDecision> {
    const decision = await this.evaluate(ctx);
    if (!decision.allowed) throw new PolicyViolation(decision);
    return decision;
  }
}
