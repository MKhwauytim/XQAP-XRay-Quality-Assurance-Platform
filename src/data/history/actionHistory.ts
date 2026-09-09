import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { logError } from "../storage/errorLogger";
import { errorCodeMeaning, logCodedError } from "../storage/errorCodes";
import {
  getSystemRoot,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

/**
 * Pre-change snapshot history for TEMPLATES (owner requirement, 2026-09-03):
 * before an admin overwrites a template, the state it is about to replace is
 * captured so it can be inspected — or manually put back — later.
 *
 * WHY ONLY TEMPLATES. The requirement originally covered answers and
 * distribution assignments too, and this module wrote a file for each. It
 * should never have: for those two families the pre-change state is ALREADY on
 * disk, immutably and permanently, in the logs the app keeps forever —
 * `answers.events/*.ndjson` (append-only, never pruned) and
 * `distribution.events/{eventId}.json` (immutable by contract). Folding those
 * to the point before event N reproduces exactly what a snapshot stored. The
 * writer was duplicating state the app already had, which is the failure mode
 * CLAUDE.md's one-place rule exists to prevent.
 *
 * It also cost the requirement its own delivery. Duplicating per-record meant a
 * per-record DIRECTORY, and the resulting path
 * (`…/history/answers/{month}/{user}/{xrayImageId}/{36-char timestamp}.json`,
 * ~115 characters relative) crosses Windows' 260-character cap on a workspace
 * that already sits deep on the UNC share. On the deployment in the 2026-09-08/09
 * error log it failed on EVERY answer save, ~50 times in three hours, twice per
 * save. So the feature the owner asked for was not merely expensive there — it
 * had never once worked.
 *
 * `actionHistoryReaders.ts` now serves those two families by folding the event
 * logs, which is the same information with no second copy and no deep path.
 * A template save is the one genuine whole-file overwrite with no event log
 * behind it, so it keeps a real file — and, being one file per record rather
 * than a directory per record, a short one.
 *
 * Distinct from the two other snapshot mechanisms here, which this does NOT
 * replace: `safeWrite.ts`'s single `{file}.bak` is a torn-write recovery copy
 * holding exactly one prior revision, and `src/data/backup/` is a deliberate
 * whole-workspace snapshot.
 */
export const ACTION_HISTORY_RETENTION_COUNT = 10;

/**
 * Which families the app can show a pre-change history for. Only `templates`
 * is FILE-backed; the other two are derived by `actionHistoryReaders.ts`. The
 * union is kept whole because it still names what a caller can ask to see.
 */
export type ActionHistoryFamily = "templates" | "answers" | "distribution";

export type ActionHistorySnapshot<T> = {
  snapshotAt: string;
  actor: string;
  action: string;
  /** State immediately BEFORE this action. `null` when the record did not exist yet. */
  state: T | null;
};

/**
 * The stored document. An OBJECT, not a bare `ActionHistorySnapshot[]`,
 * specifically so `revision` and `_writeToken` have somewhere to live: two
 * admins on two machines can save the same template inside the CAS verify
 * window, and without a token to verify on read-back the loser's snapshot is
 * silently lost — the exact false-positive-revision case `casLoop.ts` exists to
 * catch. Same shape as `audit/actionLog.ts`'s document for the same reason.
 */
export type ActionHistoryDocument<T> = {
  recordId: string;
  revision: number;
  _writeToken: string;
  /** Newest first, capped at ACTION_HISTORY_RETENTION_COUNT. */
  snapshots: ActionHistorySnapshot<T>[];
};

function sanitizeRecordId(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
  return cleaned || "_";
}

/** `5-system/history/{family}/` — one flat directory per family, no nesting. */
async function getHistoryFamilyDir(
  directoryHandle: DirectoryHandleLike,
  family: ActionHistoryFamily
): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, true);
  const historyDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.history, {
    create: true,
  });
  return historyDir.getDirectoryHandle(family, { create: true });
}

/**
 * The longest RELATIVE path (workspace root → file, including the
 * `.tmp.crswap` suffix Chromium appends while staging) this module will
 * attempt on the share.
 *
 * 94 is measured, not guessed. The 2026-09-09 production log shows paths of
 * 115 relative characters failing on every answer save, while every other file
 * the app wrote in the same sessions against the same workspace root — all
 * under 94 — succeeded. 94 is therefore the longest relative path that
 * deployment is known to accept.
 *
 * With the flat one-file-per-record layout the worst case this module can
 * produce is `5-system/history/templates/{120-char sanitized id}.json.tmp.crswap`,
 * and for a real minted template id
 * (`tmpl-1787457917309-ngm1iq`) it is 68 — comfortably inside the budget. The
 * check is kept anyway, and kept BEFORE any handle is opened, because it is
 * the tripwire that makes a future deepening of this tree fail in the test
 * suite instead of silently on a customer's share.
 */
export const HISTORY_MAX_RELATIVE_PATH_CHARS = 94;

/** Chromium stages a write as `{name}.crswap`; the staged name is what must fit. */
const STAGING_SUFFIX = ".tmp.crswap";

/**
 * The workspace-root-relative path this module would write for `recordId`.
 * Exported so a test can assert the budget for every family and the longest id
 * the app can mint, rather than for one hand-picked example.
 */
export function historyRelativePath(family: ActionHistoryFamily, recordId: string): string {
  return [
    WORKSPACE_ROOTS.system,
    SYSTEM_FOLDER_NAMES.history,
    family,
    `${sanitizeRecordId(recordId)}.json`,
  ].join("/");
}

/** Families whose over-budget verdict has already been logged this session. */
const budgetSkipsReported = new Set<string>();

/** @internal — test-only. Forget which over-budget skips were reported. */
export function __resetActionHistoryBudgetReportsForTests(): void {
  budgetSkipsReported.clear();
}

/**
 * Record the state a template save is about to overwrite, keeping the most
 * recent ACTION_HISTORY_RETENTION_COUNT snapshots.
 *
 * Best-effort by design: a history write that fails must never fail — or even
 * retry-loop — the real save it is documenting. Call this BEFORE the real
 * write, with the state read just before it; a crash in between costs only the
 * newest history entry, never the trail or the live data.
 */
export async function recordActionHistorySnapshot<T>(params: {
  directoryHandle: DirectoryHandleLike;
  /** Only `templates` is file-backed — see this module's header. */
  family: "templates";
  recordId: string;
  actor: string;
  action: string;
  previousState: T | null;
}): Promise<void> {
  const relativePath = historyRelativePath(params.family, params.recordId);
  if (relativePath.length + STAGING_SUFFIX.length > HISTORY_MAX_RELATIVE_PATH_CHARS) {
    // Decided in memory, before a single call reaches the share: no directory
    // minted, no retry ladder, no cause probes, and one log row per family per
    // session rather than two per save. Numbers first — the durable log
    // truncates, and the measurement is the actionable part.
    if (!budgetSkipsReported.has(params.family)) {
      budgetSkipsReported.add(params.family);
      logCodedError(
        "actionHistory:path-budget",
        "XQ-IO-037",
        new Error(
          `${relativePath.length + STAGING_SUFFIX.length} chars vs a ` +
            `${HISTORY_MAX_RELATIVE_PATH_CHARS} budget for "${relativePath}" — ` +
            errorCodeMeaning("XQ-IO-037")
        )
      );
    }
    return;
  }

  const fileName = `${sanitizeRecordId(params.recordId)}.json`;

  try {
    const dir = await getHistoryFamilyDir(params.directoryHandle, params.family);
    const snapshot: ActionHistorySnapshot<T> = {
      // Stamped here rather than passed in: the caller has no reason to know
      // the clock, and every snapshot in one document must be comparable.
      snapshotAt: new Date().toISOString(),
      actor: params.actor.trim() || "unknown",
      action: params.action,
      state: params.previousState,
    };

    await casLoop<{ ok: true }>(
      async (writeToken) => {
        const existing = await safeReadJson<ActionHistoryDocument<T>>(dir, fileName);
        const current = existing.ok ? existing.value : null;
        const next: ActionHistoryDocument<T> = {
          recordId: params.recordId,
          revision: (current?.revision ?? 0) + 1,
          _writeToken: writeToken,
          // Newest first, then truncate — pruning is an array slice, so there
          // is no directory listing and no per-file removal pass.
          snapshots: [snapshot, ...(current?.snapshots ?? [])].slice(
            0,
            ACTION_HISTORY_RETENTION_COUNT
          ),
        };
        await safeWriteJson(dir, fileName, next);
        const readBack = await safeReadJson<ActionHistoryDocument<T>>(dir, fileName);
        if (!readBack.ok || readBack.value._writeToken !== writeToken) {
          return { done: false };
        }
        return { done: true, result: { ok: true } };
      },
      // Deliberately short. This is best-effort documentation of a save that
      // has its OWN casLoop; a long ladder here would hammer a share that is
      // already contended for something that never gates the save.
      { maxRetries: 2, baseDelayMs: 60 }
    );
  } catch (error) {
    logError("actionHistory:record", error instanceof Error ? error : new Error(String(error)), {
      action: `${params.family}:${params.action}`,
    });
  }
}

/**
 * The template snapshot trail, newest first. Empty when the template has no
 * history yet, or when the file cannot be read — this is a review surface, not
 * a correctness input, so an unreadable trail degrades to "nothing to show"
 * rather than throwing into a save path.
 */
export async function loadActionHistory<T>(
  directoryHandle: DirectoryHandleLike,
  family: "templates",
  recordId: string
): Promise<ActionHistorySnapshot<T>[]> {
  try {
    const dir = await getHistoryFamilyDir(directoryHandle, family);
    const result = await safeReadJson<ActionHistoryDocument<T>>(
      dir,
      `${sanitizeRecordId(recordId)}.json`
    );
    return result.ok ? result.value.snapshots : [];
  } catch (error) {
    logError("actionHistory:load", error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}
