/**
 * Drizzle wraps driver errors, so the message that matters (permission denied,
 * a check constraint name) sits on the cause chain rather than the surface.
 */
export function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' | ');
}

/** Assert that a rejected promise carries `pattern` anywhere on its cause chain. */
export async function expectRejection(promise: Promise<unknown>, pattern: RegExp, note?: string) {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(`${note ?? 'expected a rejection'}, but the promise resolved`);
  }
  const chain = errorChain(thrown);
  if (!pattern.test(chain)) {
    throw new Error(`${note ?? 'rejection'} did not match ${pattern}. Actual chain: ${chain}`);
  }
}
