import { readErrorContext } from "./errorContext";

export type ErrorEntry = {
  context: string;
  message: string;
  timestamp: string;
  /** Optional stack trace, present only when the logged error carried one. */
  stack?: string;
  /**
   * Every field below is OPTIONAL on purpose. They are filled from the ambient
   * `errorContext` and from the context string itself, so all 56 existing
   * `logError(context, error)` call sites keep working verbatim — and an entry
   * hydrated from an older localStorage ring, which predates these fields
   * entirely, stays a valid ErrorEntry.
   */
  /** Active tab, or `tab/sub-tab`. `errorContext.readErrorContext().page`. */
  page?: string;
  /** What was being attempted. Defaults to `context`, which already names it. */
  action?: string;
  /** `XQ-AREA-NNN`, when the throw site tagged one or logCodedError supplied it. */
  errorCode?: string;
  /** Signed-in username at the time. Absent on the sign-in screen. */
  username?: string;
  /** That user's REAL role — never an admin's previewed role. */
  role?: string;
  /**
   * True only for an entry hydrated from localStorage at module init (a ring
   * carried over from a previous tab/session), never set on an entry logged
   * within the current module lifetime.
   */
  restored?: boolean;
};

/**
 * Optional, opt-in enrichment for a single `logError` call.
 *
 * Nothing requires it. `action` is worth supplying at a call site whose
 * `context` string is terse and whose failure an admin will read out of an
 * Excel export months later; `errorCode` is supplied by `logCodedError` only.
 */
export type ErrorLogMeta = {
  action?: string;
  errorCode?: string;
};

/**
 * Durable persistence hook. `errorLogger` cannot import the workspace layer —
 * `safeWrite.ts` imports THIS module, so the edge back is a cycle — so the
 * persisted error log (`src/data/errorLog/`) registers itself here instead.
 *
 * A sink is called synchronously with each new entry and must return
 * immediately (queue, do not await). It must never throw; this module catches
 * anyway, because a logging side-channel breaking the call site that reported
 * the original error is the one failure mode this module exists to prevent.
 */
export type ErrorSink = (entry: ErrorEntry) => void;

const MAX_ENTRIES = 50;

/** Registered in src/data/storage/storageRegistry.ts. */
const STORAGE_KEY = "xray_error_log_v1";

// Bounds on what gets mirrored to (and hydrated from) localStorage — keeps a
// single pathological error message/stack from blowing past a reasonable
// quota footprint for a 50-entry ring.
const MAX_CONTEXT_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 500;

const entries: ErrorEntry[] = [];

// Persistence is best-effort and must NEVER be able to recurse back into
// itself (e.g. if some future change made the catch branch below log through
// this same module). This guard makes that structurally impossible rather
// than relying on the branch never doing so.
let isPersisting = false;

let sink: ErrorSink | null = null;

// Depth counter, not a boolean: the sink may itself call into code that logs,
// which may log again. `isPersisting` above guards the localStorage mirror
// against exactly one level of recursion; this guards the sink against any
// number. While it is non-zero, entries still land in the ring buffer (the
// caller's guarantee) but are NOT handed to the sink — otherwise an error
// raised while writing the error log queues another error to write, forever.
let suppressDepth = 0;

/** Install (or, with `null`, remove) the durable persistence sink. */
export function registerErrorSink(next: ErrorSink | null): void {
  sink = next;
}

/** @internal — test-only. Module state outlives a test file's `beforeEach`. */
export function __resetErrorSinkForTests(): void {
  sink = null;
  suppressDepth = 0;
}

// Matches the `[XQ-AREA-NNN]` suffix that `logCodedError` (errorCodes.ts:659)
// appends to its context string. Parsed rather than imported: errorCodes.ts
// imports THIS module, so reading `resolveErrorCode` from here is a cycle.
const CODE_SUFFIX_PATTERN = /\[(XQ-[A-Z]+-\d{3})\]\s*$/;

function codeFromContext(context: string): string | undefined {
  return CODE_SUFFIX_PATTERN.exec(context)?.[1];
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

/**
 * Mirrors the in-memory ring to localStorage. Swallows every failure
 * (quota exceeded, storage disabled, serialization edge case) — a logging
 * side-channel must never be able to break the call site that reported the
 * original error.
 */
function persistToStorage(): void {
  if (isPersisting) return;
  if (!hasLocalStorage()) return;

  isPersisting = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort only — quota exceeded, storage disabled, or a serialization
    // failure. The in-memory ring (already updated by the caller) is
    // unaffected either way.
  } finally {
    isPersisting = false;
  }
}

/**
 * Runs once at module init: restores whatever ring a previous tab/session
 * left behind, so the log does not die exactly when a user reports "it broke
 * and I reloaded". Hydrated entries are tagged `restored: true` and are
 * re-truncated defensively in case an older/foreign payload carried larger
 * fields than the current limits allow.
 */
function hydrateFromStorage(): void {
  if (!hasLocalStorage()) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<ErrorEntry>;
      if (
        typeof candidate.context !== "string" ||
        typeof candidate.message !== "string" ||
        typeof candidate.timestamp !== "string"
      ) {
        continue;
      }

      entries.push({
        context: truncate(candidate.context, MAX_CONTEXT_LENGTH),
        message: truncate(candidate.message, MAX_MESSAGE_LENGTH),
        timestamp: candidate.timestamp,
        ...(typeof candidate.stack === "string"
          ? { stack: truncate(candidate.stack, MAX_STACK_LENGTH) }
          : {}),
        restored: true
      });
    }

    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  } catch {
    // Corrupted or foreign payload — start with an empty ring rather than
    // throwing at module init.
  }
}

hydrateFromStorage();

export function logError(context: string, error: unknown, meta?: ErrorLogMeta): void {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const stack = error instanceof Error ? error.stack : undefined;
  const safeContext = truncate(context, MAX_CONTEXT_LENGTH);
  const { page, username, role } = readErrorContext();
  const errorCode = meta?.errorCode ?? codeFromContext(safeContext);

  const entry: ErrorEntry = {
    context: safeContext,
    message: truncate(message, MAX_MESSAGE_LENGTH),
    timestamp: new Date().toISOString(),
    ...(stack !== undefined ? { stack: truncate(stack, MAX_STACK_LENGTH) } : {}),
    page,
    // The context string already IS the action label at every existing call
    // site ("audit:append", "datatable:export", "population:save"), so this
    // default is honest rather than a placeholder — and it is what makes the
    // owner's "what was being attempted" requirement land on all 56 of them
    // without editing any.
    action: truncate(meta?.action ?? safeContext, MAX_CONTEXT_LENGTH),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(username !== null ? { username } : {}),
    ...(role !== null ? { role } : {})
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  persistToStorage();

  // Last, and fenced off. Everything above is the contract this module has
  // always kept; nothing the sink does may be allowed to undo it.
  if (sink === null || suppressDepth > 0) return;
  suppressDepth += 1;
  try {
    sink(entry);
  } catch {
    // A durable-persistence failure is not the caller's problem, and it must
    // not be logged through this module either — that is the recursion the
    // suppressDepth counter above already blocks, and re-raising it here would
    // be a second way in.
  } finally {
    suppressDepth -= 1;
  }
}

export function getRecentErrors(): ErrorEntry[] {
  return entries.slice();
}

export function clearErrors(): void {
  entries.length = 0;

  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only, same as persistToStorage.
  }
}

/**
 * `.catch` handler for intentionally fire-and-forget promises: logs the
 * rejection to the ring buffer instead of leaving it unhandled. State simply
 * isn't updated on failure (safe degradation).
 */
export function logRejection(context: string): (error: unknown) => void {
  return (error: unknown) => logError(context, error);
}
