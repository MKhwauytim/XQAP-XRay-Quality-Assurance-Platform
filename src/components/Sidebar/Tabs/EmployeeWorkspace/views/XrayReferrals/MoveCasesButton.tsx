import { useState } from "react";
import { ConfirmDialog } from "../../../../../ConfirmDialog/ConfirmDialog";
import { recordAction } from "../../../../../../data/audit/actionLog";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { useLabels } from "../../../../../../data/labels/useLabels";
import {
  moveExceptionalCasesToIndex,
  moveIndexCasesToExceptional,
  type MoveResult,
} from "../../../../../../data/monthTransfer/moveCasesBetweenIndexAndExceptional";
import { logError } from "../../../../../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import type { CaseFilter } from "./caseFilter";

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/**
 * Admin «نقل الحالات المعروضة» (see `moveCasesBetweenIndexAndExceptional.ts`):
 * shown only while one case chip is active, it moves every NOT-studied case
 * the queue currently shows — case chip, other chips and column filters
 * included — to the other bucket. `entries` is DataTable's own filtered set.
 */
export function MoveCasesButton({
  directoryHandle,
  month,
  caseFilter,
  entries,
  isStudied,
  username,
  role,
  onDone,
}: {
  directoryHandle: DirectoryHandleLike;
  month: string;
  caseFilter: CaseFilter;
  entries: readonly DistributionEntry[];
  isStudied: (entry: DistributionEntry) => boolean;
  username: string;
  role: string;
  onDone: () => void;
}) {
  const L = useLabels();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (role !== "admin" || !month || caseFilter === "all") return null;

  const toExceptional = caseFilter === "risk-targeted";
  const movable = entries.filter((entry) => !isStudied(entry) && isAdhocEntry(entry) !== toExceptional);
  const label = fill(toExceptional ? L.ew_move_to_exceptional : L.ew_move_to_index, { n: movable.length });

  async function run(): Promise<void> {
    setConfirming(false);
    setBusy(true);
    setNotice("");
    try {
      const result: MoveResult = toExceptional
        ? await moveIndexCasesToExceptional(directoryHandle, month, movable.map((entry) => entry.xrayImageId), username)
        : await moveExceptionalCasesToIndex(
            directoryHandle,
            month,
            movable.filter(isAdhocEntry).map((entry) => ({
              importId: entry.adhocImportId, xrayImageId: entry.xrayImageId, assignedTo: entry.assignedTo,
            })),
            username
          );
      if (!result.ok) {
        setNotice(result.reason === "write-failed" ? fill(L.ew_move_failed, { error: result.error }) : L.merge_month_refused_target_closed);
        return;
      }
      recordAction(directoryHandle, username, role, "month-merged", {
        monthFolderName: month,
        target: toExceptional ? "exceptional" : "index",
        details: { kind: "queue-bulk-move", moved: result.moved, skippedStudied: result.skippedStudied },
      });
      setNotice(fill(L.ew_move_done, { moved: result.moved, skipped: result.skippedStudied }));
      onDone();
    } catch (error) {
      logError("referrals:bulk-move", error);
      setNotice(fill(L.ew_move_failed, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ew-btn-secondary"
        disabled={busy || movable.length === 0}
        onClick={() => setConfirming(true)}
      >
        {label}
      </button>
      {notice && <span role="status" className="ew-move-notice">{notice}</span>}
      <ConfirmDialog
        open={confirming}
        title={label}
        message={<p>{fill(toExceptional ? L.ew_move_confirm_exceptional : L.ew_move_confirm_index, { n: movable.length, month })}</p>}
        confirmLabel={L.ew_move_confirm_button}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
