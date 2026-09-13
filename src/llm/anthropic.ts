import Anthropic from '@anthropic-ai/sdk';
import type { LanguageModel } from './gateway';

/**
 * The Claude adapter.
 *
 * Feature code never imports this directly; it goes through the gateway, so the
 * provider stays swappable and every call is versioned and logged. See
 * architecture.md s11.
 */

export const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Refusal fallback. A policy decline on the primary model re-runs the same
 * request on the fallback inside the same call rather than failing the mandate.
 * Worth having here because extraction runs over real people's career data,
 * which is exactly the shape of input that can trip a classifier.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-06-01';
const FALLBACK_MODEL = 'claude-opus-4-8';

export class ModelRefusalError extends Error {
  readonly category: string | null;
  constructor(category: string | null, explanation: string | undefined) {
    super(`the model declined this request${category ? ` (${category})` : ''}: ${explanation ?? 'no explanation given'}`);
    this.name = 'ModelRefusalError';
    this.category = category;
  }
}

export interface ClaudeModelOptions {
  /** Defaults to the environment's resolved credentials. */
  readonly client?: Anthropic;
  readonly model?: string;
  readonly maxTokens?: number;
  /** low | medium | high | xhigh | max. Extraction is judgment heavy, so high. */
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export function claudeModel(options: ClaudeModelOptions = {}): LanguageModel {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? 16_000;
  const effort = options.effort ?? 'high';

  return {
    id: model,
    async complete({ system, user, maxTokens: perCall }) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: perCall ?? maxTokens,
          betas: [FALLBACK_BETA],
          fallbacks: [{ model: FALLBACK_MODEL }],
          output_config: { effort },
          system,
          messages: [{ role: 'user', content: user }],
        });

        // A refusal is an HTTP 200 with stop_reason "refusal", so it must be
        // checked before the content is read.
        if (response.stop_reason === 'refusal') {
          throw new ModelRefusalError(
            response.stop_details?.category ?? null,
            response.stop_details?.explanation ?? undefined,
          );
        }

        return response.content
          .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
      } catch (error) {
        // Most specific first: the distinction between retryable and terminal
        // is lost if everything is caught as one class.
        if (error instanceof Anthropic.AuthenticationError) {
          throw new Error('Anthropic credentials are missing or invalid. Run `ant auth login` or set ANTHROPIC_API_KEY.');
        }
        if (error instanceof Anthropic.RateLimitError) {
          throw new Error('Anthropic rate limit reached. The mandate is unchanged; retry the extraction.');
        }
        if (error instanceof Anthropic.BadRequestError) {
          throw new Error(`Anthropic rejected the request: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
