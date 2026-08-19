export type ErrorEntry = {
  context: string;
  message: string;
  timestamp: string;
  /** Optional stack trace, present only when the logged error carried one. */
  stack?: string;
  /**
   * True only for an entry hydrated from localStorage at module init (a ring
   * carried over from a previous tab/session), never set on an entry logged
   * within the current module lifetime.
   */
  restored?: boolean;
};

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

export function logError(context: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const stack = error instanceof Error ? error.stack : undefined;

  entries.push({
    context: truncate(context, MAX_CONTEXT_LENGTH),
    message: truncate(message, MAX_MESSAGE_LENGTH),
    timestamp: new Date().toISOString(),
    ...(stack !== undefined ? { stack: truncate(stack, MAX_STACK_LENGTH) } : {})
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  persistToStorage();
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
