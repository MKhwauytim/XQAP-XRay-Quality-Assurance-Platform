/**
 * The in-memory batching layer between `errorLogger.ts`'s synchronous
 * `logError` and `errorLogStorage.ts`'s durable, per-user file writes.
 *
 * WHY BATCH AT ALL. `logError` is called synchronously from all over the app,
 * including hot paths, and must never itself touch disk — a single write per
 * error would multiply the SMB round trips this whole subsystem exists to
 * avoid, exactly the mistake `actionLog.ts`'s per-actor split was built to
 * fix for the audit trail. Entries are queued in memory and flushed as one
 * `appendUserErrors` batch, either when the queue fills, on a timer, or when
 * the tab is about to go away.
 *
 * WHY A BOUNDED QUEUE. An error storm (a broken network share logging one
 * error per operation) must not grow this queue without bound between
 * flushes. Past `maxPending` the OLDEST entries are dropped — matching the
 * ring buffer's own overflow behaviour (`errorLogger.ts`) — and the drop
 * count survives as one synthetic `errorlog:overflow` entry in the next
 * flush, so the fact that a storm happened is still visible in the export.
 *
 * WHY THE `errorlog:` PREFIX IS DROPPED HERE TOO. `errorLogger.ts`'s
 * `suppressDepth` guard stops a SYNCHRONOUS recursion (a sink call that
 * itself logs, re-entering the sink). It cannot stop an ASYNCHRONOUS one: an
 * `errorlog:append` failure queued here would flush later, possibly fail
 * again, and log another `errorlog:append` failure, forever. Filtering the
 * prefix out before enqueueing closes that second loop from the other end.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { type ErrorEntry, registerErrorSink } from "../storage/errorLogger";
import { isReadOnlyMode } from "../storage/readOnlyMode";
import { appendUserErrors } from "./errorLogStorage";
import type { PersistedErrorEntry } from "./errorLogTypes";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_FLUSH_DELAY_MS = 5_000;
const DEFAULT_MAX_PENDING = 200;

const INTERNAL_CONTEXT_PREFIX = "errorlog:";

export type WorkspaceErrorSinkOptions = {
  directoryHandle: DirectoryHandleLike;
  username: string;
  /** @internal test seam */
  batchSize?: number;
  /** @internal test seam */
  flushDelayMs?: number;
  /** @internal test seam */
  maxPending?: number;
};

let pending: ErrorEntry[] = [];
let droppedSinceLastFlush = 0;
let installedOptions: Required<Pick<WorkspaceErrorSinkOptions, "directoryHandle" | "username" | "batchSize" | "flushDelayMs" | "maxPending">> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightFlush: Promise<void> | null = null;
let flushAgainAfter = false;

function createEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `err-${crypto.randomUUID()}`;
  }
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPersisted(entry: ErrorEntry, fallbackUsername: string): PersistedErrorEntry {
  return {
    id: createEntryId(),
    at: entry.timestamp,
    username: entry.username ?? fallbackUsername,
    ...(entry.role !== undefined ? { role: entry.role } : {}),
    page: entry.page ?? "unknown",
    action: entry.action ?? entry.context,
    context: entry.context,
    message: entry.message,
    ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorName !== undefined ? { errorName: entry.errorName } : {}),
    ...(entry.stack !== undefined ? { stack: entry.stack } : {}),
  };
}

function clearFlushTimer(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function armFlushTimer(): void {
  if (installedOptions === null || flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushErrorLogNow();
  }, installedOptions.flushDelayMs);
}

function enqueue(entry: ErrorEntry): void {
  if (installedOptions === null) return;
  if (entry.context.startsWith(INTERNAL_CONTEXT_PREFIX)) return;

  pending.push(entry);
  if (pending.length > installedOptions.maxPending) {
    const overflowCount = pending.length - installedOptions.maxPending;
    pending.splice(0, overflowCount);
    droppedSinceLastFlush += overflowCount;
  }

  if (pending.length >= installedOptions.batchSize) {
    void flushErrorLogNow();
  } else {
    armFlushTimer();
  }
}

/**
 * Flush whatever is queued to the signed-in user's own workspace file. Safe
 * to call at any time (idempotent on an empty queue); coalesces concurrent
 * calls into a single in-flight write rather than racing two.
 */
export async function flushErrorLogNow(): Promise<void> {
  if (inFlightFlush) {
    flushAgainAfter = true;
    return inFlightFlush;
  }

  inFlightFlush = doFlush();
  try {
    await inFlightFlush;
  } finally {
    inFlightFlush = null;
    if (flushAgainAfter) {
      flushAgainAfter = false;
      // Whatever arrived while the previous flush was in progress.
      void flushErrorLogNow();
    }
  }
}

async function doFlush(): Promise<void> {
  clearFlushTimer();
  const options = installedOptions;
  if (options === null) return;
  if (isReadOnlyMode()) {
    // safeWriteJson would throw ReadOnlyModeError anyway (readOnlyMode.ts) —
    // letting that happen once per flush forever is noise for a session that
    // by definition has no workspace worth writing to.
    pending = [];
    droppedSinceLastFlush = 0;
    return;
  }

  const batch = pending;
  pending = [];
  const dropped = droppedSinceLastFlush;
  droppedSinceLastFlush = 0;

  if (batch.length === 0 && dropped === 0) return;

  const persisted = batch.map((entry) => toPersisted(entry, options.username));
  if (dropped > 0) {
    persisted.unshift({
      id: createEntryId(),
      at: new Date().toISOString(),
      username: options.username,
      page: "unknown",
      action: "errorlog:overflow",
      context: "errorlog:overflow",
      message: `Dropped ${dropped} pending error log entr${dropped === 1 ? "y" : "ies"} before they could be persisted (queue over capacity).`,
    });
  }

  await appendUserErrors(options.directoryHandle, options.username, persisted);
}

/**
 * Install the durable persistence sink for `options.username`'s own errors.
 * Returns an uninstall function. Only one sink can be installed at a time —
 * installing again first uninstalls whatever was there.
 */
export function installWorkspaceErrorSink(options: WorkspaceErrorSinkOptions): () => void {
  installedOptions = {
    directoryHandle: options.directoryHandle,
    username: options.username,
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    flushDelayMs: options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS,
    maxPending: options.maxPending ?? DEFAULT_MAX_PENDING,
  };

  registerErrorSink(enqueue);

  const handleHidden = () => {
    if (document.hidden) void flushErrorLogNow();
  };
  const handlePagehide = () => void flushErrorLogNow();

  const hasDocument = typeof document !== "undefined";
  if (hasDocument) {
    document.addEventListener("visibilitychange", handleHidden);
    window.addEventListener("pagehide", handlePagehide);
  }

  return function uninstall() {
    registerErrorSink(null);
    if (hasDocument) {
      document.removeEventListener("visibilitychange", handleHidden);
      window.removeEventListener("pagehide", handlePagehide);
    }
    clearFlushTimer();
    installedOptions = null;
    pending = [];
    droppedSinceLastFlush = 0;
  };
}

/** @internal — test-only. Number of entries queued but not yet flushed. */
export function __getPendingCountForTests(): number {
  return pending.length;
}
