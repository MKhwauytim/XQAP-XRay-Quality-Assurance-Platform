// Cross-machine write safety:
// Each attempt receives a fresh crypto UUID (writeToken). The caller embeds it in the
// written JSON and verifies it on read-back. If another machine wrote concurrently it
// will have stored a different token, making the false-positive revision match detectable.

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BASE_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Add ±50 % random jitter to avoid thundering-herd retries across machines.
function withJitter(ms: number): number {
  return ms * (0.5 + Math.random());
}

/**
 * Run an async operation in a Compare-And-Swap retry loop with exponential backoff.
 *
 * A fresh `writeToken` (UUID) is generated for every attempt and passed to `fn`.
 * The caller should:
 *  1. Read current state (note revision N).
 *  2. Compute next state (revision N+1, _writeToken = writeToken).
 *  3. Write next state.
 *  4. Read back and verify BOTH revision AND _writeToken match.
 *  5. Return `{ done: true, result }` on success or `{ done: false }` to
 *     signal a write conflict and trigger a retry.
 *
 * Embedding the token in the persisted JSON lets machines running on the same shared
 * folder detect when a concurrent write from a different machine has won the race —
 * a situation the revision counter alone cannot distinguish.
 */
export async function casLoop<T>(
  fn: (writeToken: string) => Promise<{ done: true; result: T } | { done: false }>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    conflictError?: string;
  }
): Promise<T | { ok: false; error: string }> {
  const max = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: string =
    options?.conflictError ?? "تعارض في الكتابة: فشلت جميع المحاولات.";

  for (let attempt = 0; attempt < max; attempt++) {
    const writeToken = crypto.randomUUID();
    try {
      const r = await fn(writeToken);
      if (r.done) return r.result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
    if (attempt < max - 1) {
      await sleep(withJitter(baseDelay * (attempt + 1)));
    }
  }

  return { ok: false, error: lastError };
}
