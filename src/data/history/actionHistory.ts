import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeRemoveJson, safeWriteJson } from "../storage/safeWrite";
import { listDirectoryEntries } from "../storage/directoryScan";
import { isNotFoundError } from "../storage/transientFileErrors";
import { logError } from "../storage/errorLogger";
import { errorCodeMeaning, errorCodeOf, logCodedError } from "../storage/errorCodes";
import {
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

/**
 * Rolling pre-change snapshot history (owner requirement, 2026-09-03): before
 * an admin/supervisor mutates a template, a distribution assignment
 * (reassignment/replacement/reopen), or an employee's answer, the state it is
 * about to overwrite is captured here so it can be inspected — or manually
 * put back — later.
 *
 * Distinct from the two existing snapshot mechanisms in this codebase, which
 * this deliberately does NOT replace:
 *   - `safeWrite.ts`'s single `{file}.bak` is a torn-write recovery copy for
 *     EVERY workspace write, not a history — it holds exactly one prior
 *     revision and exists purely so a crash mid-write has something to roll
 *     back to.
 *   - `src/data/backup/` is a deliberate, whole-workspace snapshot (manual,
 *     scheduled, or pre-restore) — expensive by design (it walks and copies
 *     every JSON file in the workspace) and not meant to run on every edit.
 *
 * This module is the middle ground: a per-RECORD trail, automatic on every
 * matching action, cheap enough to run on every one of them (one small file
 * write + a bounded prune), capped at ACTION_HISTORY_RETENTION_COUNT entries
 * per record so it cannot grow without bound.
 *
 * `loadActionHistory` below is not yet wired into any admin-facing UI — this
 * lands the write path and the on-disk record first; a review/restore screen
 * is a natural follow-up, not part of this change.
 */
export const ACTION_HISTORY_RETENTION_COUNT = 10;

export type ActionHistoryFamily = "templates" | "answers" | "distribution";

export type ActionHistorySnapshot<T> = {
  snapshotAt: string;
  actor: string;
  action: string;
  /** State immediately BEFORE this action. `null` when the record did not exist yet — nothing to roll back to. */
  state: T | null;
};

function sanitizeScopePart(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
  return cleaned || "_";
}

async function getHistoryScopeDir(
  directoryHandle: DirectoryHandleLike,
  family: ActionHistoryFamily,
  scopeParts: readonly string[]
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, true);
  let dir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.history, { create: true });
  dir = await dir.getDirectoryHandle(family, { create: true });
  for (const part of scopeParts) {
    dir = await dir.getDirectoryHandle(sanitizeScopePart(part), { create: true });
  }
  return dir;
}

// Per-tab monotonic counter, not a random suffix: two snapshots minted in the
// SAME millisecond (a realistic case — a fast admin loop, or this module's
// own tests) must still sort in the order they were actually taken, or
// pruning can drop the wrong entry and loadActionHistory can report the
// wrong one as "newest". A random suffix cannot guarantee that; an
// ever-increasing counter can, within this tab (the only writer whose
// relative order this module needs to get right — a genuine cross-machine
// tie is an ordering call no local counter could resolve consistently
// anyway, and either order is defensibly "recent").
let snapshotSequence = 0;

function snapshotFileName(now: Date): string {
  // ISO-with-millis prefix sorts lexicographically in chronological order, so
  // pruning can drop "the oldest N" with a plain string sort — no need to
  // parse the name back into a Date.
  const iso = now.toISOString().replace(/[:.]/g, "-");
  snapshotSequence = (snapshotSequence + 1) % 1_000_000;
  const seq = String(snapshotSequence).padStart(6, "0");
  return `${iso}-${seq}.json`;
}

/**
 * Scope PREFIXES (every `scopeParts` entry except the last) already proven
 * unwritable this session because the resulting path is too long for the
 * filesystem (`XQ-IO-034`, see `transientFileErrors.ts`'s `classifyNotFound`).
 *
 * The last scope part is typically a per-record id (an `xrayImageId`, an
 * event key) that differs on every call, so every save an employee makes
 * would otherwise mint a never-before-seen directory and pay the full cost of
 * discovering the SAME verdict again: `writeText`'s retry ladder (~630 ms)
 * plus `classifyNotFound`'s own round-trip probes (over a second more) — pure
 * added latency on a save that was already going to succeed, since this
 * write is best-effort and never gates it. A path-length limit is a property
 * of the shared prefix (how deep the workspace already sits on the share),
 * not of the one differing record id, so once one record under a prefix has
 * proven it unwritable, every sibling is written off too — same reasoning as
 * `bakRecoveryReport.ts`'s "one entry per file per session" cache for a
 * different permanently-repeating condition.
 */
const knownUnwritableScopePrefixes = new Set<string>();

/**
 * The longest RELATIVE path (workspace root → file, including the `.tmp.crswap`
 * suffix Chromium appends while staging) this module will attempt on the share.
 *
 * WHY A NUMBER, AND WHY THIS NUMBER. Windows caps a full path at 260
 * characters. What a workspace has left of that budget depends on how deep its
 * root sits on the share, which this app cannot see — but the 2026-09-09
 * production log measures it for the deployment that failed. Every answer save
 * by two employees, ~50 in three hours, failed on paths like
 * `5-system/history/answers/{month}/{user}/{xrayImageId}/2026-09-09T09-03-07-106Z-000023.json.tmp`
 * — 115 characters relative — while every OTHER file the app writes, all under
 * 94 relative, succeeded in the same session against the same root. 94 is
 * therefore not a guess: it is the longest relative path that deployment is
 * known to accept, taken as the budget.
 *
 * WHY CHECK BEFORE TOUCHING DISK. The path-length limit is a property of the
 * name, so the verdict is knowable without asking the share. Discovering it by
 * trying cost `writeText`'s five-attempt ladder (~630 ms) plus
 * `classifyNotFound`'s own round-trip probes (a second more) — and the trailing
 * scope part is a per-record id, so nearly every save minted a never-before-
 * seen directory and paid it again. `knownUnwritableScopePrefixes` (v134.4)
 * caches the verdict, but only within one tab: it resets on every page load,
 * and it can only cache AFTER paying the full cost once. This check is the same
 * verdict reached for free, every time, and it also stops the `create: true`
 * directory handles that were minting an empty `{xrayImageId}` folder per save
 * on the way to a write that could not succeed.
 *
 * This is a GUARD, not the fix for the layout. The real remedy is for these
 * paths to be short enough that no budget is needed — a reshaping of the
 * history tree that changes what is on disk, and so needs owner sign-off and
 * its own migration. Until then this makes the failure free and honest instead
 * of expensive and repeated, and `historyRelativePath` gives that reshaping a
 * single place to be measured from.
 */
export const HISTORY_MAX_RELATIVE_PATH_CHARS = 94;

/** Chromium stages a write as `{name}.crswap`; the staged name is what must fit. */
const STAGING_SUFFIX = ".tmp.crswap";

/**
 * The workspace-root-relative path `recordActionHistorySnapshot` would write,
 * built from the same parts `getHistoryScopeDir` and `snapshotFileName` use.
 * Exported so a test can assert the budget holds for every family and the
 * longest id the app can mint, rather than for one hand-picked example.
 */
export function historyRelativePath(
  family: ActionHistoryFamily,
  scopeParts: readonly string[],
  fileName: string
): string {
  return [
    WORKSPACE_ROOTS.system,
    SYSTEM_FOLDER_NAMES.history,
    family,
    ...scopeParts.map(sanitizeScopePart),
    fileName,
  ].join("/");
}

/** Families whose over-budget verdict has already been logged this session. */
const budgetSkipsReported = new Set<string>();

/** @internal — test-only. Forget which over-budget skips were reported. */
export function __resetActionHistoryBudgetReportsForTests(): void {
  budgetSkipsReported.clear();
}

/** @internal — test-only. Forget which scope prefixes were given up on. */
export function __resetActionHistoryUnwritableScopesForTests(): void {
  knownUnwritableScopePrefixes.clear();
}

function scopePrefixKey(family: ActionHistoryFamily, scopeParts: readonly string[]): string {
  return `${family}/${scopeParts.slice(0, -1).map(sanitizeScopePart).join("/")}`;
}

/**
 * Record the state a mutation is about to overwrite, then prune this
 * record's history down to the most recent ACTION_HISTORY_RETENTION_COUNT
 * snapshots.
 *
 * Best-effort by design, mirroring `refreshAnswerCacheAfterWrite` /
 * `invalidateDistributionCaches` elsewhere in this codebase: a history write
 * that fails must never fail (or even retry-loop) the real mutation it is
 * documenting. Call this BEFORE the real write, with the state read just
 * before it — a crash between the snapshot and the real write only ever
 * costs the newest history entry, never corrupts the trail or the live data.
 */
export async function recordActionHistorySnapshot<T>(params: {
  directoryHandle: DirectoryHandleLike;
  family: ActionHistoryFamily;
  scopeParts: readonly string[];
  actor: string;
  action: string;
  previousState: T | null;
}): Promise<void> {
  const prefixKey = scopePrefixKey(params.family, params.scopeParts);
  if (knownUnwritableScopePrefixes.has(prefixKey)) return;

  // Budget check BEFORE any handle is opened — see
  // HISTORY_MAX_RELATIVE_PATH_CHARS. A path that cannot fit is skipped without
  // a single call to the share: no `create: true` directory minted, no retry
  // ladder, no cause probes, and one log row per family per session instead of
  // two per save.
  // Minted ONCE and reused for the real write below: snapshotFileName advances
  // the per-tab sequence counter that keeps same-millisecond snapshots in
  // order, so calling it twice per save would burn a number for nothing.
  const now = new Date();
  const plannedName = snapshotFileName(now);
  const plannedPath = historyRelativePath(params.family, params.scopeParts, plannedName);
  if (plannedPath.length + STAGING_SUFFIX.length > HISTORY_MAX_RELATIVE_PATH_CHARS) {
    if (!budgetSkipsReported.has(params.family)) {
      budgetSkipsReported.add(params.family);
      logCodedError(
        "actionHistory:path-budget",
        "XQ-IO-037",
        // Numbers and path FIRST: the durable log truncates long messages, and
        // the actionable part is the measurement, not the catalog prose.
        new Error(
          `${plannedPath.length + STAGING_SUFFIX.length} chars vs a ` +
            `${HISTORY_MAX_RELATIVE_PATH_CHARS} budget for "${plannedPath}" — ` +
            errorCodeMeaning("XQ-IO-037")
        )
      );
    }
    return;
  }

  try {
    const dir = await getHistoryScopeDir(params.directoryHandle, params.family, params.scopeParts);
    const snapshot: ActionHistorySnapshot<T> = {
      snapshotAt: now.toISOString(),
      actor: params.actor.trim() || "unknown",
      action: params.action,
      state: params.previousState,
    };
    await safeWriteJson(dir, plannedName, snapshot);
    await pruneActionHistory(dir);
  } catch (error) {
    if (isNotFoundError(error) && errorCodeOf(error) === "XQ-IO-034") {
      // Permanent for this prefix — see the cache's doc above. Logged once
      // (below, this call) rather than never again: an admin exporting the
      // error log still needs to see it happened at least once.
      knownUnwritableScopePrefixes.add(prefixKey);
    }
    logError("actionHistory:record", error instanceof Error ? error : new Error(String(error)), {
      action: `${params.family}:${params.action}`,
    });
  }
}

async function pruneActionHistory(dir: DirectoryHandleLike): Promise<void> {
  if (!dir.removeEntry) return;
  const entries = await listDirectoryEntries(dir);
  const names = entries
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const excess = names.length - ACTION_HISTORY_RETENTION_COUNT;
  if (excess <= 0) return;
  for (const name of names.slice(0, excess)) {
    try {
      // Pruned snapshots are safeWriteJson-managed, so their `.bak` siblings
      // must go with them — otherwise loadActionHistory keeps recovering a
      // snapshot the retention cap already dropped.
      await safeRemoveJson(dir, name);
    } catch (error) {
      if (!isNotFoundError(error)) {
        logError("actionHistory:prune", error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

/** Read back this record's history, newest first — for an admin-facing history/restore view. */
export async function loadActionHistory<T>(
  directoryHandle: DirectoryHandleLike,
  family: ActionHistoryFamily,
  scopeParts: readonly string[]
): Promise<ActionHistorySnapshot<T>[]> {
  const dir = await getHistoryScopeDir(directoryHandle, family, scopeParts);
  const entries = await listDirectoryEntries(dir);
  const names = entries
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const snapshots: ActionHistorySnapshot<T>[] = [];
  for (const name of names) {
    const result = await safeReadJson<ActionHistorySnapshot<T>>(dir, name);
    if (result.ok) snapshots.push(result.value);
  }
  return snapshots;
}
