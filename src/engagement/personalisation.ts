import type { MessageTemplate, PersonalisationHook, PersonalisationVerdict } from './types';

/** What the caller must tell the gate about each cited evidence row. */
export interface EvidenceFact {
  readonly id: string;
  /** False once the evidence has passed its own expiry. */
  readonly live: boolean;
  /** True when the evidence is about this person rather than their employer or the role. */
  readonly aboutThisPerson: boolean;
  readonly citation: string | null;
}

/**
 * The personalisation gate.
 *
 * A message may not be queued unless every hook token the template declares is
 * filled from verified, person specific, live evidence carrying a citation a
 * human could check.
 *
 * This is validated rather than requested because the approval queue cannot
 * catch it. A plausible generic message is exactly what a tired recruiter
 * approves, and the cost lands weeks later as a response rate nobody can
 * explain. The research is unambiguous: somewhat personalised outreach performs
 * no better than none at all, so a system that quietly degrades to generic when
 * research is thin burns the addressable market at speed.
 *
 * **Refusing to send is a feature.** See architecture.md s7.2.
 */
export function evaluatePersonalisation(
  template: MessageTemplate,
  hooks: readonly PersonalisationHook[],
  evidence: ReadonlyMap<string, EvidenceFact>,
): PersonalisationVerdict {
  if (!template.requiresPersonalEvidence) {
    return {
      permitted: true,
      hooks,
      missingTokens: [],
      statement:
        `"${template.name}" responds to a relationship that already exists, so it carries no hook ` +
        `requirement. Demanding fresh evidence here would block one of the highest converting ` +
        `messages in the sequence.`,
    };
  }

  const problems: string[] = [];
  const missingTokens: string[] = [];
  const good: PersonalisationHook[] = [];

  for (const token of template.hookTokens) {
    const hook = hooks.find((h) => h.token === token);
    if (!hook || hook.value.trim() === '') {
      missingTokens.push(token);
      continue;
    }

    const fact = evidence.get(hook.evidenceId);
    if (!fact) {
      missingTokens.push(token);
      problems.push(`"${token}" cites evidence ${hook.evidenceId}, which does not exist.`);
      continue;
    }
    if (!fact.aboutThisPerson) {
      missingTokens.push(token);
      problems.push(
        `"${token}" cites evidence about the employer or the role, not about this person. ` +
          `A company fact is not a personal hook.`,
      );
      continue;
    }
    if (!fact.live) {
      missingTokens.push(token);
      problems.push(`"${token}" cites evidence that has expired. A stale hook reads as a stale approach.`);
      continue;
    }
    if (!hook.citation.trim() && !fact.citation) {
      missingTokens.push(token);
      problems.push(`"${token}" has no citation, so a recruiter cannot check it before sending.`);
      continue;
    }
    good.push(hook);
  }

  const permitted = missingTokens.length === 0 && good.length > 0;

  return {
    permitted,
    hooks: good,
    missingTokens,
    statement: permitted
      ? `${good.length} verified person specific hook${good.length === 1 ? '' : 's'}: ` +
        `${good.map((h) => `${h.token} (${h.citation || evidence.get(h.evidenceId)?.citation})`).join('; ')}.`
      : `Blocked: ${template.name} needs ${template.hookTokens.length} verified hook` +
        `${template.hookTokens.length === 1 ? '' : 's'} and has ${good.length}. ` +
        `Missing: ${missingTokens.join(', ')}. ` +
        (problems.length > 0 ? `${problems.join(' ')} ` : '') +
        `Somewhat personalised outreach performs no better than none, so this goes back to research ` +
        `rather than out as a generic message.`,
  };
}

/** Length ceilings are enforced at composition, not suggested. */
export function checkLength(template: MessageTemplate, body: string): string | null {
  if (template.maxChars !== undefined && body.length > template.maxChars) {
    return `${body.length} characters, over the ${template.maxChars} ceiling for ${template.name}. ` +
      `The shortest InMails outperform the longest by 41 percent.`;
  }
  if (template.maxWords !== undefined) {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    if (words > template.maxWords) {
      return `${words} words, over the ${template.maxWords} ceiling for ${template.name}.`;
    }
  }
  return null;
}
