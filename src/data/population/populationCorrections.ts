/**
 * Write side of the معلقة (pending) corrections re-import (see
 * `pendingCorrections.ts` for the export side and the full design rationale).
 *
 * A correction is non-destructive by construction: `parseImportRows` drops any
 * cell that is blank (no value supplied = "not correcting this field", never
 * "clear it"), and `computeCorrectionPreview` only records a change when the
 * supplied value actually differs from the CURRENT stored value. `xrayImageId`
 * itself is never treated as a field to change — it is the merge key, matched
 * against the month's known population ids and reported as `unmatchedIds`
 * when it isn't one.
 *
 * A correction touches TWO on-disk copies of the row, not one:
 *  - `population.final.json` (the source of truth / Population Browse / any
 *    future re-export).
 *  - `sample.master.json` — because `foldDistributionEvents`
 *    (`distribution/distributionDerivation.ts`) embeds
 *    `toEmployeeMirrorRowStub(row)` from the sample-master row at FOLD time,
 *    not from `population.final.json`. Without patching `sample.master.json`
 *    too, an already-distributed معلقة item's row would keep showing the
 *    OLD, wrong data in `distribution.current.json` and every employee
 *    mirror even after the "source of truth" file was fixed.
 * Because the distribution cache's own validity fingerprint is id-set based
 * (not content-based — see `invalidateDistributionCacheForFieldEdit`'s
 * docblock), the cache is explicitly invalidated and rebuilt after the
 * sample-master patch so the correction is visible immediately rather than on
 * some future incidental refold.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { logError } from "../storage/errorLogger";
import { ensureMonthWritable, manifestLockKey } from "./monthLock";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import { loadMonthPopulationFinal } from "./populationStorage";
import type { PreparedPopulationRow } from "./populationTypes";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import {
  invalidateDistributionCacheForFieldEdit,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { appendWorkspaceAction } from "../audit/actionLog";
import type { Labels } from "../labels/useLabels";
import type { PendingCorrectionsImportRow } from "../../workers/pendingCorrectionsImportWorkerTypes";
import {
  CORRECTABLE_FIELD_LABEL_KEYS,
  CORRECTABLE_POPULATION_FIELDS,
  XRAY_IMAGE_ID_HEADER,
  type CorrectablePopulationField,
} from "./pendingCorrections";

export type FieldChange = {
  xrayImageId: string;
  field: CorrectablePopulationField;
  oldValue: string;
  newValue: string;
};

export type ParsedCorrectionRow = {
  xrayImageId: string;
  fields: Partial<Record<CorrectablePopulationField, string>>;
};

/**
 * Header text → field, built from the SAME label keys the export used, so an
 * unmodified re-export of `exportPendingCorrectionsXlsx`'s own file always
 * round-trips.
 */
function buildHeaderFieldMap(labels: Labels): Map<string, CorrectablePopulationField> {
  const map = new Map<string, CorrectablePopulationField>();
  for (const field of CORRECTABLE_POPULATION_FIELDS) {
    map.set(labels[CORRECTABLE_FIELD_LABEL_KEYS[field]], field);
  }
  return map;
}

/**
 * Turn worker-parsed sheet rows into `{ xrayImageId, fields }` pairs. The id
 * column is matched by its exact export header first, falling back to
 * whichever column came first in the sheet — a user may have renamed/retyped
 * the header cell while leaving the column itself in place.
 *
 * Blank cells are dropped, not carried as empty-string "corrections" — see
 * the module docblock. A duplicate `xrayImageId` in the sheet is resolved by
 * keeping the LAST row for that id (a hand-edited sheet's most likely intent
 * is "I fixed it again further down"), not by merging or erroring.
 */
export function parseImportRows(
  rows: readonly PendingCorrectionsImportRow[],
  headerRow: readonly string[],
  labels: Labels
): ParsedCorrectionRow[] {
  const fieldByHeader = buildHeaderFieldMap(labels);
  const idHeader = headerRow.includes(XRAY_IMAGE_ID_HEADER) ? XRAY_IMAGE_ID_HEADER : headerRow[0];
  const byId = new Map<string, ParsedCorrectionRow>();
  for (const row of rows) {
    const xrayImageId = (idHeader ? row[idHeader] : "")?.trim() ?? "";
    if (!xrayImageId) continue;
    const fields: Partial<Record<CorrectablePopulationField, string>> = {};
    for (const [header, value] of Object.entries(row)) {
      if (header === idHeader) continue;
      const field = fieldByHeader.get(header);
      if (!field) continue;
      const trimmed = value.trim();
      if (trimmed === "") continue;
      fields[field] = trimmed;
    }
    byId.set(xrayImageId, { xrayImageId, fields });
  }
  return [...byId.values()];
}

export type CorrectionPreview = {
  matchedIds: string[];
  unmatchedIds: string[];
  /** Matched ids whose sheet row supplied no value that actually differs from
   *  the current one — reported so "0 changes" reads as "nothing to do" and
   *  not as a silent failure. */
  unchangedIds: string[];
  changes: FieldChange[];
};

/** Current correctable-field values for one population row, string-normalized
 *  (`null`/`undefined` → ""), for diffing against imported cells. */
function currentFieldValues(
  row: Record<string, unknown> | undefined
): Record<CorrectablePopulationField, string> {
  const values = {} as Record<CorrectablePopulationField, string>;
  for (const field of CORRECTABLE_POPULATION_FIELDS) {
    const raw = row?.[field];
    values[field] = raw === null || raw === undefined ? "" : String(raw);
  }
  return values;
}

/** Pure diff: which of `parsedRows` match a known population id, and which
 *  fields on each would actually change. No disk access — reusable by a
 *  preview UI and by `applyPopulationFieldCorrections` alike. */
export function computeCorrectionPreview(
  parsedRows: readonly ParsedCorrectionRow[],
  populationRowsById: ReadonlyMap<string, Record<string, unknown>>
): CorrectionPreview {
  const matchedIds: string[] = [];
  const unmatchedIds: string[] = [];
  const unchangedIds: string[] = [];
  const changes: FieldChange[] = [];
  for (const row of parsedRows) {
    const populationRow = populationRowsById.get(row.xrayImageId);
    if (!populationRow) {
      unmatchedIds.push(row.xrayImageId);
      continue;
    }
    matchedIds.push(row.xrayImageId);
    const current = currentFieldValues(populationRow);
    let changedAny = false;
    for (const [field, newValue] of Object.entries(row.fields) as [CorrectablePopulationField, string][]) {
      const oldValue = current[field];
      if (newValue === oldValue) continue;
      changedAny = true;
      changes.push({ xrayImageId: row.xrayImageId, field, oldValue, newValue });
    }
    if (!changedAny) unchangedIds.push(row.xrayImageId);
  }
  return { matchedIds, unmatchedIds, unchangedIds, changes };
}

export type PendingCorrectionsApplyResult =
  | { ok: true; preview: CorrectionPreview }
  | { ok: false; error: string };

/**
 * Load the month's known population rows keyed by `xrayImageId`, for
 * validating/diffing an import BEFORE committing anything.
 */
export async function loadCorrectionPopulationIndex(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<Map<string, Record<string, unknown>>> {
  const final = await loadMonthPopulationFinal(directoryHandle, monthFolderName);
  const index = new Map<string, Record<string, unknown>>();
  for (const row of final?.rows ?? []) {
    const id = row["xrayImageId"];
    if (typeof id === "string" && id) index.set(id, row);
  }
  return index;
}

function applyChangesToRow(
  row: Record<string, unknown>,
  changesForId: FieldChange[]
): Record<string, unknown> {
  const next = { ...row };
  for (const change of changesForId) next[change.field] = change.newValue;
  return next;
}

/**
 * Commit a set of already-computed field changes to disk: patches
 * `population.final.json` and `sample.master.json`, rebuilds the distribution
 * cache/mirrors, and writes one `pending-correction-applied` audit entry per
 * (xrayImageId, field) — never a single blob for the whole re-import, per the
 * owner's requirement that every field change be individually traceable.
 *
 * `preview` is expected to come from `computeCorrectionPreview` run against a
 * FRESH `loadCorrectionPopulationIndex` read (the caller does the read →
 * preview → user-confirms → apply sequence); this function does not re-read
 * to re-diff, so a change is applied even if the row moved again between
 * preview and confirm — the same "confirm what you saw" contract the rest of
 * this app's confirm-then-write flows (e.g. reassignment) already use.
 */
export async function applyPopulationFieldCorrections(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  changes: readonly FieldChange[];
  actorUsername: string;
  actorRole: string;
}): Promise<PendingCorrectionsApplyResult> {
  const { directoryHandle, monthFolderName, changes, actorUsername, actorRole } = params;
  if (changes.length === 0) {
    return { ok: true, preview: { matchedIds: [], unmatchedIds: [], unchangedIds: [], changes: [] } };
  }

  await ensureMonthWritable(directoryHandle, monthFolderName);

  const changesById = new Map<string, FieldChange[]>();
  for (const change of changes) {
    const list = changesById.get(change.xrayImageId) ?? [];
    list.push(change);
    changesById.set(change.xrayImageId, list);
  }

  try {
    // 1. population.final.json — read-modify-write under the SAME manifest
    //    lock saveMonthRun uses, so this can never race a reprocess of the
    //    same month. No revision/_writeToken on this file type (see
    //    monthTypes.ts) — saveMonthRun itself uses the identical plain
    //    read-modify-write-under-lock pattern for it.
    //
    //    `finalPatched` is flipped only after the write itself completes —
    //    `loadMonthPopulationFinal` collapses "month never processed" and
    //    "file present but unreadable" into the same `null` (see its own
    //    docblock), so a callback that merely returned on `!final` used to
    //    let steps 2-4 (sample-master patch, distribution refold, audit
    //    trail) run and report success even though the source of truth was
    //    never touched. The flag is checked right after the lock releases,
    //    before anything else runs.
    let finalPatched = false;
    await withResourceLock(manifestLockKey(monthFolderName), async () => {
      const final = await loadMonthPopulationFinal(directoryHandle, monthFolderName);
      if (!final) return;
      const patchedRows = final.rows.map((row) => {
        const id = row["xrayImageId"];
        const changesForId = typeof id === "string" ? changesById.get(id) : undefined;
        return changesForId ? applyChangesToRow(row, changesForId) : row;
      });
      const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, true);
      const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
      await safeWriteJson(processedDir, "population.final.json", { ...final, rows: patchedRows });
      finalPatched = true;
    });
    if (!finalPatched) {
      return {
        ok: false,
        error: "تعذّر تحميل بيانات المجتمع لهذا الشهر — لم يتم تطبيق أي تصحيح.",
      };
    }

    // 2. sample.master.json — CAS loop, same idiom as appendSampleRow /
    //    approveSampleMaster in sampleStorage.ts, so a concurrent
    //    replacement/approval append cannot be silently clobbered.
    //
    //    The rows only travel back to the caller INSIDE the casLoop success
    //    result (`rows`), never assigned from within the attempt callback
    //    itself — an attempt can compute patchedRows and still lose the CAS
    //    race (or exhaust retries), and reading rows off the last, unwritten
    //    attempt used to let step 3 refold the distribution cache with data
    //    that was never actually committed to sample.master.json. `rows` is
    //    `null` for the legitimate "no sample drawn yet for this month" case
    //    (nothing to patch, still a success), distinct from `rows: [...]`
    //    which means the write was verified.
    const sampleResult = await casLoop<{ ok: true; rows: PreparedPopulationRow[] | null }>(
      async (writeToken) => {
        const current = await loadSampleMaster(directoryHandle, monthFolderName);
        if (!current) return { done: true, result: { ok: true as const, rows: null } };
        const patchedRows = current.rows.map((row) => {
          const changesForId = changesById.get(row.xrayImageId);
          return changesForId
            ? { ...row, ...Object.fromEntries(changesForId.map((c) => [c.field, c.newValue])) }
            : row;
        });
        const nextRevision = (current.revision ?? 0) + 1;
        const writeResult = await saveSampleMaster(directoryHandle, monthFolderName, {
          ...current,
          rows: patchedRows,
          revision: nextRevision,
          _writeToken: writeToken,
        });
        if (!writeResult.ok) return { done: false };
        const verify = await loadSampleMaster(directoryHandle, monthFolderName);
        if (verify?.revision === nextRevision && verify._writeToken === writeToken) {
          return { done: true, result: { ok: true as const, rows: patchedRows } };
        }
        return { done: false };
      },
      { context: "population:pending-corrections-sample-patch", conflictError: "تعارض في الكتابة أثناء تحديث بيانات العينة." }
    );
    if (!sampleResult.ok) {
      // population.final.json WAS already patched (finalPatched above) but
      // sample.master.json never committed — the two on-disk copies are now
      // inconsistent. Report failure instead of falling through to the
      // distribution refold and "success" audit entries: those must never
      // fire for a correction that didn't fully commit.
      logError("population:pending-corrections-sample-patch", new Error(sampleResult.error));
      return {
        ok: false,
        error: "تم تحديث بيانات المجتمع، لكن تعذّر تحديث بيانات العينة — التصحيح غير مكتمل.",
      };
    }
    const updatedSampleRows = sampleResult.rows;

    // 3. Force a fresh refold so distribution.current.json / every employee
    //    mirror stop serving the pre-correction row stub — see this module's
    //    docblock and invalidateDistributionCacheForFieldEdit's own docblock.
    if (updatedSampleRows) {
      await invalidateDistributionCacheForFieldEdit(directoryHandle, monthFolderName);
      await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, updatedSampleRows);
    }

    // 4. Audit trail — one entry per (id, field), best-effort/non-throwing by
    //    appendWorkspaceAction's own contract.
    await Promise.all(
      changes.map((change) =>
        appendWorkspaceAction(directoryHandle, {
          actor: actorUsername,
          actorRole,
          action: "pending-correction-applied",
          monthFolderName,
          target: change.xrayImageId,
          details: { field: change.field, oldValue: change.oldValue, newValue: change.newValue },
        })
      )
    );

    return {
      ok: true,
      preview: {
        matchedIds: [...changesById.keys()],
        unmatchedIds: [],
        unchangedIds: [],
        changes: [...changes],
      },
    };
  } catch (error) {
    logError("population:apply-pending-corrections", error);
    return { ok: false, error: "تعذّر تطبيق التصحيحات — حاول مرة أخرى." };
  }
}
