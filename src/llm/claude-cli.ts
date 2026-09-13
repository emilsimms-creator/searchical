import { spawn } from 'node:child_process';
import type { LanguageModel } from './gateway';
import { DEFAULT_MODEL } from './anthropic';

/**
 * A model backed by the Claude Code CLI rather than the API.
 *
 * Useful wherever Claude Code is installed but no API key is configured, which
 * includes a developer machine and this repository's own dry runs. The API
 * adapter in `anthropic.ts` remains the one to deploy: it is the supported
 * surface, it carries refusal fallback, and it does not depend on a CLI being
 * on the path.
 *
 * Single turn and no tools, deliberately. Extraction is a completion, not an
 * agent: giving it a tool loop would let it wander, and the gateway's schema
 * validation assumes one JSON answer.
 */

export class ClaudeCliError extends Error {}

export interface ClaudeCliOptions {
  readonly model?: string;
  readonly binary?: string;
  readonly timeoutMs?: number;
}

export function claudeCliModel(options: ClaudeCliOptions = {}): LanguageModel {
  const model = options.model ?? DEFAULT_MODEL;
  const binary = options.binary ?? 'claude';
  const timeoutMs = options.timeoutMs ?? 300_000;

  return {
    id: `${model} (via claude cli)`,
    complete({ system, user }) {
      return new Promise<string>((resolve, reject) => {
        const child = spawn(
          binary,
          ['-p', '--model', model, '--system-prompt', system, '--max-turns', '1', '--allowedTools', ''],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new ClaudeCliError(`claude cli timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => (stdout += String(chunk)));
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(new ClaudeCliError(`could not run "${binary}": ${error.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new ClaudeCliError(`claude cli exited ${code}: ${stderr.trim() || '(no stderr)'}`));
            return;
          }
          resolve(stdout);
        });

        child.stdin.end(user);
      });
    },
  };
}
