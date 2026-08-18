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

/**
 * Backoff ladder for reading back a file we JUST WROTE — `retryMissing: true`.
 * 8 attempts, ~11 s of waiting worst case, against the ladder above's ~630 ms.
 *
 * The two cases are not comparable, and sharing one ladder was the mistake.
 * Everywhere else, "not found" is a question: the file might genuinely not be
 * there, so giving up in under a second and reporting it is right. On a
 * post-write verification read it is not a question — `close()` has already
 * resolved, so the file provably exists and its absence can ONLY be the share
 * not yet showing an entry it already holds. There is nothing to "surface
 * quickly": the sole outcome of giving up early is failing an operation that
 * actually succeeded.
 *
 * The old shared ladder ran out in ~630 ms and users on a real SMB share hit
 * XQ-IO-031 — `cause=directory-writable`, i.e. the probe found the directory
 * healthy and only one entry temporarily invisible, which is precisely the case
 * that more patience fixes. A cloud-synced or contended share can take several
 * seconds to publish a new entry; 630 ms was never going to be enough.
 *
 * 11 s is a long time to wait, but it is paid ONLY on the failure path, and the
 * alternative it replaces is aborting a whole month save. A genuinely broken
 * share still fails — just after trying properly first.
 */
export const VERIFY_READBACK_RETRY_DELAYS_MS = [
  20, 60, 150, 400, 800, 1600, 3000, 5000,
] as const;

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
  | "extension-blocked"
  | "name-too-long"
  | "unknown";

const PROBE_FILE_NAME = ".fs-reachability-probe.tmp";

/**
 * How long to wait before re-checking that a probe file is still there.
 *
 * The round-trip probe below writes and immediately re-reads, which every
 * antivirus, DLP and file-sync client wins: they quarantine ASYNCHRONOUSLY,
 * typically a second or more after the write lands. An instant round trip
 * therefore reports the folder healthy for exactly the deployment where the
 * app's own files keep disappearing — which is how a permanent failure kept
 * being classified `directory-writable` (XQ-IO-031, "just retry").
 *
 * Paid only on the failure path, after every retry ladder has already been
 * exhausted, so this adds no cost to a working share.
 */
const PROBE_SURVIVAL_WAIT_MS = 1_200;

/**
 * Only probe for a length problem when the failing name is long enough for
 * length to be a plausible cause. Below this a `.tmp`/`.ndjson` probe already
 * covers the same path budget, so the extra round trip would prove nothing.
 */
const NAME_LENGTH_PROBE_THRESHOLD = 24;

/** The extension of `fileName`, including the dot, or "" if it has none. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

/**
 * Write a throwaway file, then immediately try to READ IT BACK, then clean up.
 *
 * The read-back is the point. A plain create-succeeds check only proves the
 * directory accepts writes; it does not prove a file written there stays
 * visible, which is the actual failure being diagnosed.
 */
async function probeRoundTrip(
  dir: DirectoryHandleLike,
  name: string,
  /**
   * Wait this long and re-open the probe a SECOND time before calling it a
   * survivor. Zero keeps the original instant check (used where the caller only
   * needs "can this name be created at all").
   */
  survivalWaitMs = 0
): Promise<boolean> {
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    if (handle.createWritable) {
      const writable = await handle.createWritable();
      await writable.write("probe");
      await writable.close();
      // Re-open by name: this is what fails when something removes the file
      // between the write and the next directory lookup.
      const check = await dir.getFileHandle(name, { create: false });
      await check.getFile();
      if (survivalWaitMs > 0) {
        await waitFor(survivalWaitMs);
        // Second look, after the delay an async remover needs. A file that
        // passed the instant check and is gone now was taken by something
        // outside the browser.
        const recheck = await dir.getFileHandle(name, { create: false });
        await recheck.getFile();
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      await dir.removeEntry?.(name);
    } catch {
      // A leftover probe file is harmless and reused by the next probe.
    }
  }
}

/**
 * A probe name with the SAME total length and extension as `fileName`, so the
 * only difference from the real write is the bytes of the stem.
 *
 * This is the one hypothesis every earlier probe left untested: a path that is
 * too long for the target filesystem. The app's short probes (`.tmp`,
 * `.ndjson` — 26 characters) fit under Windows' 260-character path limit on a
 * deep UNC workspace path where a 73–87 character distribution segment name
 * (plus Chromium's `.crswap` sibling) does not. That failure is a permanent,
 * per-name `NotFoundError` in a directory that is genuinely writable — i.e.
 * indistinguishable from a share flake until something probes for length.
 */
function sameLengthProbeName(fileName: string): string | null {
  const extension = extensionOf(fileName);
  const prefix = ".fs-len-probe";
  const padding = fileName.length - prefix.length - extension.length;
  if (padding < 0) return null;
  return `${prefix}${"x".repeat(padding)}${extension}`;
}

/**
 * Probes the containing directory by creating (then best-effort removing) a
 * throwaway entry. `create: true` is the only probe that separates the two
 * causes: a reachable directory accepts it, a stale/removed directory handle
 * rejects it with the very same `NotFoundError`. Runs only after all retries
 * are exhausted, so its cost and its temp file are confined to the failure path.
 */
export async function classifyNotFound(
  dir: DirectoryHandleLike,
  /** The file that could not be found, so the probe can match its extension. */
  fileName?: string
): Promise<NotFoundCause> {
  try {
    await dir.getFileHandle(PROBE_FILE_NAME, { create: true });
    try {
      await dir.removeEntry?.(PROBE_FILE_NAME);
    } catch {
      // A leftover probe file is harmless and reused by the next probe.
    }
  } catch (error) {
    if (isNotFoundError(error)) return "directory-unreachable";
    if (errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError") {
      return "permission-denied";
    }
    return "unknown";
  }

  // The directory accepts a `.tmp` file. That used to end the diagnosis at
  // "directory-writable" — advice to retry, which is useless when the same
  // failure repeats indefinitely.
  //
  // It leaves one hypothesis untested, and it is the one that fits a file
  // written successfully and then never visible again while the folder itself
  // is healthy: something outside the browser is REMOVING the file. Antivirus,
  // DLP and sync clients routinely quarantine unfamiliar extensions, and this
  // app writes `.ndjson` — which almost nothing allowlists — while the probe
  // above uses `.tmp`, which nearly everything does.
  //
  // So probe again with the failing file's OWN extension and do a full
  // write-then-read-back round trip. If `.tmp` survives and `.ndjson` does not,
  // the cause is the extension, not the share, and no amount of retrying will
  // help: the fix is an exclusion rule on the folder.
  const extension = fileName ? extensionOf(fileName) : "";
  if (extension && extension !== ".tmp") {
    const survived = await probeRoundTrip(
      dir,
      `.fs-extension-probe${extension}`,
      PROBE_SURVIVAL_WAIT_MS
    );
    if (!survived) return "extension-blocked";
  }

  // Extension is fine and the folder is writable — the remaining per-name
  // hypothesis is LENGTH (see sameLengthProbeName). Probing it is what turns
  // "retry forever" into "the path is too long; move the workspace closer to
  // the share root", which is the only remedy that works.
  if (fileName && fileName.length >= NAME_LENGTH_PROBE_THRESHOLD) {
    const lengthProbe = sameLengthProbeName(fileName);
    if (lengthProbe) {
      const survived = await probeRoundTrip(dir, lengthProbe);
      if (!survived) return "name-too-long";
    }
  }

  return "directory-writable";
}

/** The user-facing code implied by each probed cause. */
const CAUSE_CODE: Readonly<Record<NotFoundCause, ErrorCode | null>> = {
  // Retrying is futile — nothing on this handle will ever resolve again.
  "directory-unreachable": "XQ-IO-030",
  // The share lost sight of one entry; the action is worth repeating.
  "directory-writable": "XQ-IO-031",
  // Retrying is futile in a different way: the folder is fine, this file TYPE
  // is being removed from it.
  "extension-blocked": "XQ-IO-033",
  // Futile for a third reason: the folder is fine and the type is fine, but a
  // name of THIS LENGTH cannot be created there — a path-length limit.
  "name-too-long": "XQ-IO-034",
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
  const cause = await classifyNotFound(dir, fileName);
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
  diagnostics?: { context: string; dir: DirectoryHandleLike; fileName: string },
  /**
   * Ladder to retry on. Defaults to the short one — right for a write whose
   * failure the caller can report cheaply. Callers whose failure aborts a whole
   * month save (the distribution event append) pass
   * `VERIFY_READBACK_RETRY_DELAYS_MS` instead: giving up on THAT in 630 ms buys
   * nothing, since the alternative to waiting is failing the operation.
   */
  delays: readonly number[] = TRANSIENT_WRITE_RETRY_DELAYS_MS
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isTransientWriteError(error) && attempt < delays.length) {
        await waitFor(delays[attempt]!);
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
