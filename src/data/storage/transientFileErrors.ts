import type { DirectoryHandleLike } from "./fileSystemAccess";
import { logError } from "./errorLogger";
// Safe direction: errorCodes.ts imports only labelsStore + errorLogger, so it
// cannot import back into this module and no cycle is possible.
import { tagError, type ErrorCode } from "./errorCodes";

/**
 * Transient File System Access failures, and the one distinction that matters
 * when classifying them: **"absent on read" is not the same condition as
 * "transient on write".**
 *
 * On a local disk, Chromium's `NotFoundError` reliably means "this entry does
 * not exist". On a UNC/SMB network share it does not: the directory entry for a
 * file is not always immediately visible to the next `getFileHandle()` after
 * the writable stream's `close()` has already returned successfully. The bytes
 * are on the server; only the client's view of the directory is stale. A write
 * path that treats that as proof of absence reports a completed write as a
 * failure — which is exactly what produced the reported
 * "تمت إضافة البديل للعينة لكن فشل تسجيل الحدث …
 * A requested file or directory could not be found at the time an operation was
 * processed." (the sample row WAS written; only the event-append verification
 * could not see its own file yet).
 *
 * Hence the rule this module exists to enforce:
 *
 * - **Write / verify path** — a `NotFoundError` is *transient*. Retry it with
 *   the bounded backoff below before concluding the write failed.
 * - **Read path** — a `NotFoundError` still means *absent*, and must resolve
 *   promptly to `null`. Retrying it would add latency to every first write and
 *   every optional-file probe in the app (safeReadJson alone probes `.bak` and
 *   `.tmp` on every miss). Retrying a read is therefore opt-in per call site,
 *   never the default: see `safeWrite.ts`'s `readText(dir, name, { retryMissing })`,
 *   which is set only for post-write verification read-backs.
 *
 * `NotReadableError` was already treated as transient on both paths (a handle
 * can briefly become unreadable while another process swaps a file); that is
 * unchanged and orthogonal.
 */

function errorName(error: unknown): string | undefined {
  return error && typeof error === "object" ? (error as { name?: string }).name : undefined;
}

export function isNotFoundError(error: unknown): boolean {
  return errorName(error) === "NotFoundError";
}

export function isNotReadableError(error: unknown): boolean {
  return errorName(error) === "NotReadableError";
}

/** Transient on the WRITE/VERIFY path only — see the module doc above. */
export function isTransientWriteError(error: unknown): boolean {
  return isNotFoundError(error) || isNotReadableError(error);
}

/**
 * Backoff ladder for write/verify retries: 4 attempts after the first, ~630 ms
 * of waiting worst case. Long enough to ride out an SMB directory-metadata
 * refresh, short enough that a genuine failure still surfaces to the user
 * within a second rather than hanging the action.
 */
export const TRANSIENT_WRITE_RETRY_DELAYS_MS = [20, 60, 150, 400] as const;

export function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Why a `NotFoundError` survived every retry. The two causes need completely
 * different responses, and the raw DOMException text cannot tell them apart:
 *
 * - `directory-writable` — the containing directory is reachable and writable,
 *   so the share really did lose sight of one entry. Transient share flake;
 *   retrying the user action is the right advice.
 * - `directory-unreachable` — the directory handle itself no longer resolves.
 *   The workspace folder was moved, renamed, or re-created since the root
 *   handle was restored from IndexedDB (`WorkspaceProvider` holds that handle
 *   for the whole session), so EVERY write will keep failing this way until the
 *   user re-picks the workspace. Automatic handle recovery is deliberately out
 *   of scope here — this classification exists so the logs say which one it was.
 */
export type NotFoundCause =
  | "directory-writable"
  | "directory-unreachable"
  | "permission-denied"
  | "unknown";

const PROBE_FILE_NAME = ".fs-reachability-probe.tmp";

/**
 * Probes the containing directory by creating (then best-effort removing) a
 * throwaway entry. `create: true` is the only probe that separates the two
 * causes: a reachable directory accepts it, a stale/removed directory handle
 * rejects it with the very same `NotFoundError`. Runs only after all retries
 * are exhausted, so its cost and its temp file are confined to the failure path.
 */
export async function classifyNotFound(dir: DirectoryHandleLike): Promise<NotFoundCause> {
  try {
    await dir.getFileHandle(PROBE_FILE_NAME, { create: true });
    try {
      await dir.removeEntry?.(PROBE_FILE_NAME);
    } catch {
      // A leftover probe file is harmless and reused by the next probe.
    }
    return "directory-writable";
  } catch (error) {
    if (isNotFoundError(error)) return "directory-unreachable";
    if (errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError") {
      return "permission-denied";
    }
    return "unknown";
  }
}

/** The user-facing code implied by each probed cause. */
const CAUSE_CODE: Readonly<Record<NotFoundCause, ErrorCode | null>> = {
  // Retrying is futile — nothing on this handle will ever resolve again.
  "directory-unreachable": "XQ-IO-030",
  // The share lost sight of one entry; the action is worth repeating.
  "directory-writable": "XQ-IO-031",
  "permission-denied": "XQ-IO-017",
  // No verdict: leave it untagged so `classifyFileSystemError` supplies the
  // plain XQ-IO-027 rather than asserting a cause we did not establish.
  unknown: null,
};

/**
 * Records an exhausted-retry NotFoundError with enough context to tell a
 * share flake from a stale workspace handle on the next report — AND tags the
 * error with the code that verdict implies, so the user is told which one it
 * was instead of a bare "file not found".
 *
 * The classification already existed and was already correct; it just never
 * left the log. That mattered because the two causes need opposite responses:
 * `directory-writable` means "try again", `directory-unreachable` means "trying
 * again cannot work — re-pick the workspace folder". Showing the same sentence
 * for both makes the advice useless in one case and wrong in the other.
 *
 * Tagging (rather than wrapping or rethrowing) is deliberate and required here:
 * callers all over the data layer branch on `error.name === "NotFoundError"`
 * and on `isNotFoundError`, and every one of those verdicts must survive
 * untouched. `tagError` mutates in place and returns the same object, so
 * identity, name, message, stack and cause are all preserved — see its own
 * doc comment. This adds a channel; it changes no existing one.
 */
export async function logExhaustedNotFound(
  context: string,
  dir: DirectoryHandleLike,
  fileName: string,
  attempts: number,
  error: unknown
): Promise<NotFoundCause> {
  const cause = await classifyNotFound(dir);
  const detail = error instanceof Error ? error.message : String(error);
  const code = CAUSE_CODE[cause];
  if (code) tagError(error, code);
  logError(
    context,
    new Error(
      `NotFoundError persisted after ${attempts} attempts on "${dir.name}/${fileName}" ` +
        `(cause=${cause}): ${detail}`
    )
  );
  return cause;
}

/**
 * Runs a WRITE-path operation, retrying transient NotFound/NotReadable
 * failures on the ladder above. Every operation passed here must be idempotent
 * — the callers re-open the handle and rewrite the full content, so a retry
 * after a partially-applied attempt produces the same end state.
 *
 * Never use this to wrap a read whose "not found" answer is meaningful.
 */
export async function retryTransientWrite<T>(
  operation: () => Promise<T>,
  diagnostics?: { context: string; dir: DirectoryHandleLike; fileName: string }
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isTransientWriteError(error) && attempt < TRANSIENT_WRITE_RETRY_DELAYS_MS.length) {
        await waitFor(TRANSIENT_WRITE_RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      if (isNotFoundError(error) && diagnostics) {
        await logExhaustedNotFound(
          diagnostics.context,
          diagnostics.dir,
          diagnostics.fileName,
          attempt + 1,
          error
        );
      }
      throw error;
    }
  }
}
