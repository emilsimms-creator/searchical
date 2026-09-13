import { z } from 'zod';
import { logger } from '@/observability/logger';

/**
 * The model gateway.
 *
 * Feature code never calls a provider SDK directly. Everything goes through a
 * named, versioned prompt with a schema for its output, so prompts are
 * versioned artefacts, the provider is swappable, every call is logged for
 * audit and replay, and an evaluation suite can gate deployment.
 *
 * The governing rule from architecture.md s11: no model output ever causes an
 * outward facing action, or changes a ranking, without either a deterministic
 * rule or a human between it and the effect.
 */

export interface PromptVersion<TInput, TOutput> {
  readonly id: string;
  readonly version: string;
  readonly outputSchema: z.ZodType<TOutput>;
  render(input: TInput): { system: string; user: string };
}

export interface LanguageModel {
  readonly id: string;
  complete(request: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

export interface ModelCallRecord {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly modelId: string;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly ok: boolean;
}

export class ModelOutputError extends Error {
  constructor(promptId: string, detail: string) {
    super(`model output for prompt "${promptId}" did not match its schema: ${detail}`);
    this.name = 'ModelOutputError';
  }
}

export class LlmGateway {
  readonly #model: LanguageModel;
  readonly #records: ModelCallRecord[] = [];

  constructor(model: LanguageModel) {
    this.#model = model;
  }

  /**
   * Run a versioned prompt and validate its output against the prompt's schema.
   * An output that does not parse is an error rather than a best effort guess:
   * downstream code is entitled to assume the shape it was promised.
   */
  async run<TInput, TOutput>(prompt: PromptVersion<TInput, TOutput>, input: TInput): Promise<TOutput> {
    const { system, user } = prompt.render(input);
    const startedAt = new Date();
    let ok = false;
    try {
      const raw = await this.#model.complete({ system, user });
      const parsed = prompt.outputSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        throw new ModelOutputError(prompt.id, parsed.error.issues.map((i) => i.message).join('; '));
      }
      ok = true;
      return parsed.data;
    } finally {
      const record: ModelCallRecord = {
        promptId: prompt.id,
        promptVersion: prompt.version,
        modelId: this.#model.id,
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        ok,
      };
      this.#records.push(record);
      // Inputs and outputs are deliberately not logged: person level data
      // belongs in the ledger, not in a log file.
      logger.debug(record, 'model call');
    }
  }

  /** Call records for audit and replay. Persisted by the caller. */
  get records(): readonly ModelCallRecord[] {
    return this.#records;
  }
}

/** Models wrap JSON in prose or fences more often than not. Tolerate both. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return undefined;
  }
}
