// Cross-machine write safety:
// Each attempt receives a fresh crypto UUID (writeToken). The caller embeds it in the
// written JSON and verifies it on read-back. If another machine wrote concurrently it
// will have stored a different token, making the false-positive revision match detectable.

import { codedMessage, logCodedError, resolveErrorCode, type ErrorCode } from "./errorCodes";
import { isCommittedUnverified, isTransientWriteError, writeStepOf } from "./transientFileErrors";
import {
  isDeadlineExpired,
  nextRetryDelayMs,
  type OperationDeadline,
} from "./operationDeadline";

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
export const PERMISSION_LOST_ERROR =
  "فقد الوصول إلى مجلد العمل — أعد الاتصال بمساحة العمل.";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Add ±50 % random jitter to avoid thundering-herd retries across machines.
export function withJitter(ms: number): number {
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
//
// `NoModificationAllowedError` used to be listed here and is deliberately NOT.
// It is file-LOCK contention — another machine on the share holds the entry
// open — so it is exactly what this retry loop exists for. Treating it as a
// lost grant aborted on the first attempt and told the user they had lost
// access to the workspace, whose only offered remedy (re-pick the folder) is
// powerless against someone else's open handle. See `isLockContentionError`
// in transientFileErrors.ts; it now falls through to the retry path below.
export function isPermissionLostError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "NotAllowedError" || name === "SecurityError";
}

/**
 * The terminal `{ ok: false, error }` for a write that failed by THROWING, with
 * the same classification, logging and `onExhausted` observation `casLoop`
 * applies when its attempts are exhausted. Exported so a caller that has
 * deliberately left the retry loop (a single, non-racing append — see
 * `performAnswerWrite`) reports an identical failure instead of a second,
 * drifting copy of this mapping.
 *
 * A lost folder grant maps to the reconnect message and is not logged, exactly
 * as inside the loop.
 */
export function casFailureFromCause(
  cause: unknown,
  options?: { context?: string; onExhausted?: (cause: unknown, code: ErrorCode) => void }
): { ok: false; error: string } {
  if (isPermissionLostError(cause)) return { ok: false, error: PERMISSION_LOST_ERROR };
  // An exception beat us, so this is NOT a write conflict — report what it
  // actually was, with a quotable code, and put the raw detail in the log.
  const code = resolveErrorCode(cause) ?? "XQ-IO-032";
  // Which step of safeWriteJson threw (stage / commit / post-commit read-back),
  // when known: a refused close() swap (nothing written) and an unreadable
  // read-back (written) need opposite responses and look identical otherwise.
  const step = writeStepOf(cause);
  logCodedError(
    (options?.context ? `casLoop:exhausted(${options.context})` : "casLoop:exhausted") +
      (step ? ` step=${step}` : ""),
    code,
    cause
  );
  try {
    options?.onExhausted?.(cause, code);
  } catch {
    // The observer's own failure is not this write's problem — see the
    // `onExhausted` option's doc comment on `casLoop`.
  }
  return { ok: false, error: codedMessage(code) };
}

/**
 * The in-attempt token read-back, aware of a `safeWriteJson` that reported
 * COMMITTED-BUT-UNVERIFIED (E3b).
 *
 * `written` is whatever `safeWriteJson` resolved to. On the healthy path
 * (`undefined`) this is exactly `read()` + `isMine()`, errors propagating as
 * before. When the commit landed but safeWrite's own read-back hit a stale or
 * transient error, the caller's token read is the one verification we make —
 * ONCE, with no waiting:
 *   - it returns our token   -> "mine" (verified);
 *   - it returns someone else -> "not-mine" (a real lost race; retry);
 *   - it throws a transient error -> "unconfirmed": logged as
 *     `casLoop:verify-inconclusive`. The write very likely landed (byte-exact
 *     `.tmp` verify + a resolved close()) but there is no positive evidence.
 *     The CALLER decides: a rebuildable cache (the feedback threads index)
 *     accepts it; DURABLE content (feedback replies, decision events) retries,
 *     and is made idempotent by its own id so the retry either finds its write
 *     already present (writes nothing) or writes it (no loss, no duplicate).
 * A non-transient error still propagates.
 */
export async function readBackOwnWrite<V>(
  written: unknown,
  read: () => Promise<V>,
  isMine: (value: V) => boolean,
  context?: string
): Promise<"mine" | "not-mine" | "unconfirmed"> {
  if (!isCommittedUnverified(written)) {
    return isMine(await read()) ? "mine" : "not-mine";
  }
  try {
    return isMine(await read()) ? "mine" : "not-mine";
  } catch (error) {
    if (!isTransientWriteError(error)) throw error;
    logCodedError(
      context ? `casLoop:verify-inconclusive(${context})` : "casLoop:verify-inconclusive",
      resolveErrorCode(error) ?? "XQ-IO-032",
      error
    );
    return "unconfirmed";
  }
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
    /**
     * Additive observability hook, called once — only when every attempt
     * THREW (never on a plain lost-revision exhaustion, where there is no
     * exception to report) — right before casLoop resolves to the generic
     * coded result. casLoop itself has already logged the exhaustion under
     * its own generic `casLoop:exhausted` context via `logCodedError` by the
     * time this runs; this hook exists because casLoop has no idea WHICH
     * feature called it, so a specific call site (e.g. the answer-save write
     * in `answerStorage.ts`) can attach its own page/action context to the
     * same raw error for its own diagnosability. Must never throw — a
     * misbehaving observer must not be able to change what the caller
     * receives back — and never changes the resolved value either way.
     */
    onExhausted?: (cause: unknown, code: ErrorCode) => void;
    /**
     * `module:operation` naming the WRITE this loop is running, e.g.
     * `"feedback:threadsIndex"`. Appended to the `casLoop:exhausted` log
     * context so an exhaustion entry says which writer failed.
     *
     * Without it every one of casLoop's ~25 call sites logs the identical
     * string `casLoop:exhausted [XQ-IO-032]`. That is why the `admin` entry in
     * the 2026-08-25 logs is unattributable to this day: it arrived with no
     * paired action entry, and one of those ~25 writers failed, with nothing
     * recorded to say which. `onExhausted` above already solves this — for the
     * single call site that passes one. This is the cheap version every other
     * site can adopt without wiring its own observer.
     */
    context?: string;
    /**
     * Total wall-clock budget for the whole loop. Once it is spent no NEW
     * attempt starts and the loop reports the failure it already has.
     *
     * Without one, this loop's attempt count multiplies against every retry
     * ladder inside `fn` — 14 attempts over safeWriteJson's two ~11 s
     * verify-readback ladders is ~308 s of sleeping, the "answer save takes 4
     * minutes" report. See operationDeadline.ts for the full arithmetic.
     *
     * An attempt already in flight is never interrupted, so the true worst case
     * is the deadline plus one attempt. Omitting it keeps the old unbounded
     * behaviour, so call sites can adopt it individually.
     */
    deadline?: OperationDeadline;
  }
): Promise<T | { ok: false; error: string }> {
  const max = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const lastError: string =
    options?.conflictError ?? "تعارض في الكتابة: فشلت جميع المحاولات.";
  // The last EXCEPTION, if any attempt threw. Distinct from `lastError`, which
  // is the "every attempt lost the revision race" conflict sentence — those are
  // different failures and used to be collapsed into one string.
  let lastCause: unknown;

  for (let attempt = 0; attempt < max; attempt++) {
    // The first attempt always runs — a deadline bounds RETRIES, it never turns
    // a user's action into a no-op. Later attempts are gated because the
    // previous one may itself have overrun the whole budget (each carries
    // safeWriteJson's own multi-second ladders).
    if (attempt > 0 && isDeadlineExpired(options?.deadline)) break;
    const writeToken = crypto.randomUUID();
    try {
      const r = await fn(writeToken);
      if (r.done) {
        if (!r.verify) return r.result;
        // Delayed re-read: give a competing machine's clobber time to land.
        await sleep(verifyDelayMs());
        let stillMine: boolean;
        try {
          stillMine = await r.verify();
        } catch (verifyError) {
          // "Could not confirm" is NOT "was clobbered" — the same distinction
          // transientFileErrors.ts enforces between an unreadable file and an
          // absent one, applied to the confirmation read.
          //
          // The write has ALREADY passed its in-attempt read-back (revision AND
          // token), which is what `done: true` means. This delayed re-read is a
          // second, stronger check for one specific interleaving; a THROW from
          // it produces no evidence either way. Treating that as a lost update
          // — which is what happened while it sat inside the outer catch —
          // discards a write that provably succeeded and re-runs the whole
          // read-modify-write, adding another write to a share that just proved
          // it could not serve a read. That is amplification aimed at exactly
          // the wrong moment, and on the answer path it multiplies by 14.
          //
          // So: keep the verified result, and record why the second check could
          // not run, since an unconfirmed write is worth seeing in the log.
          logCodedError(
            options?.context
              ? `casLoop:verify-inconclusive(${options.context})`
              : "casLoop:verify-inconclusive",
            resolveErrorCode(verifyError) ?? "XQ-IO-032",
            verifyError
          );
          return r.result;
        }
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
      // Keep the ERROR, not just its text.
      //
      // This loop is the funnel for nearly every CAS-protected write in the app
      // — answers, notifications, the month manifest and lock, the replacement
      // index, sync settings, the distribution projection. Reducing the caught
      // exception to `.message` here destroyed the classification for all of
      // them at once: `resolveErrorCode` never ran, so a full disk, a revoked
      // grant and a moved workspace folder all arrived at the UI as the same
      // raw English string, which `userFacingErrorText` then had to report as
      // the XQ-IO-028 catch-all. Fixing individual callers could not work —
      // they were each handed an already-destroyed error.
      //
      // It also silently overwrote the caller's Arabic `conflictError` with
      // English the moment any attempt threw, so a genuine write conflict and
      // an I/O fault were indistinguishable.
      lastCause = err;
    }
    if (attempt < max - 1) {
      // Consult the operation's total budget before sleeping. `null` means it is
      // spent: stop here and report the failure we already have rather than
      // sleeping again and re-arming the same race on a share that is already
      // contended. An attempt in flight is never interrupted — only the
      // decision to start ANOTHER one is bounded.
      const delay = nextRetryDelayMs(withJitter(baseDelay * (attempt + 1)), options?.deadline);
      if (delay === null) break;
      await sleep(delay);
    }
  }

  if (lastCause !== undefined) {
    return casFailureFromCause(lastCause, options);
  }
  // No exception: every attempt lost the revision race. The caller's Arabic
  // conflict sentence is the right answer here and now survives intact.
  return { ok: false, error: lastError };
}
