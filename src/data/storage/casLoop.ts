// Cross-machine write safety:
// Each attempt receives a fresh crypto UUID (writeToken). The caller embeds it in the
// written JSON and verifies it on read-back. If another machine wrote concurrently it
// will have stored a different token, making the false-positive revision match detectable.

const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_BASE_DELAY_MS = 200;

// Post-success settle window before the caller's optional `verify` re-read runs.
// A competing machine that reads the same base revision and commits slightly AFTER
// us clobbers our write; the plain in-attempt read-back cannot see that later write,
// so we pause a jittered moment and re-read to catch the lost update.
const VERIFY_MIN_DELAY_MS = 80;
const VERIFY_MAX_DELAY_MS = 180;

// Terminal failure surfaced to callers when the workspace folder handle has lost
// its grant (tab backgrounded, permission revoked, folder moved/renamed). Retrying
// cannot recover it, so casLoop aborts immediately with this distinct message.
const PERMISSION_LOST_ERROR =
  "فقد الوصول إلى مجلد العمل — أعد الاتصال بمساحة العمل.";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Add ±50 % random jitter to avoid thundering-herd retries across machines.
function withJitter(ms: number): number {
  return ms * (0.5 + Math.random());
}

// Uniform delay in [VERIFY_MIN_DELAY_MS, VERIFY_MAX_DELAY_MS] before a verify re-read.
function verifyDelayMs(): number {
  return (
    VERIFY_MIN_DELAY_MS + Math.random() * (VERIFY_MAX_DELAY_MS - VERIFY_MIN_DELAY_MS)
  );
}

// A DOMException that means the folder permission is gone, identified by its
// stable platform name. Do not classify from message text: Chromium's transient
// NotReadableError message can mention "permission problems" even though a
// retry may succeed.
function isPermissionLostError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    name === "NoModificationAllowedError"
  );
}

/**
 * Result of a single CAS attempt.
 *
 * `{ done: true, result }` — the write succeeded and its in-attempt read-back
 * verified. Optionally supply `verify`: casLoop then sleeps a jittered delay and
 * calls it; a `false` return means a concurrent machine clobbered the write
 * AFTER our own read-back verified (the lost-update interleaving), and the whole
 * attempt is retried. `{ done: false }` signals an immediate write conflict.
 */
export type CasAttemptResult<T> =
  | { done: true; result: T; verify?: () => Promise<boolean> }
  | { done: false };

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
 * For the highest-risk shared files, also return a `verify` callback (step 4 as a
 * delayed re-read) so a lost-update interleaving — A-read / B-read / A-commit-ok /
 * B-commit-clobbers / B-read-back-ok — is caught and retried instead of silently
 * losing A's data.
 *
 * Embedding the token in the persisted JSON lets machines running on the same shared
 * folder detect when a concurrent write from a different machine has won the race —
 * a situation the revision counter alone cannot distinguish.
 */
export async function casLoop<T>(
  fn: (writeToken: string) => Promise<CasAttemptResult<T>>,
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
      if (r.done) {
        if (!r.verify) return r.result;
        // Delayed re-read: give a competing machine's clobber time to land.
        await sleep(verifyDelayMs());
        const stillMine = await r.verify();
        if (stillMine) return r.result;
        // Lost update detected — fall through to retry the whole attempt.
      }
    } catch (err) {
      // A lost folder grant is terminal: retrying cannot recover it. Abort now
      // with a distinct message so the UI can prompt a reconnect rather than
      // reporting a generic write conflict.
      if (isPermissionLostError(err)) {
        return { ok: false, error: PERMISSION_LOST_ERROR };
      }
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
    if (attempt < max - 1) {
      await sleep(withJitter(baseDelay * (attempt + 1)));
    }
  }

  return { ok: false, error: lastError };
}
