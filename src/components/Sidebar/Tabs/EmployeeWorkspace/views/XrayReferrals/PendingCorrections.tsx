/**
 * صور الأشعة المحالة — معلقة (pending / no-image) export → correction
 * re-import → bulk reopen. Self-contained: owns its own file-picker/worker/
 * preview state so `XrayReferrals.tsx` only needs to render this component and
 * hand it an `onChanged` refresh callback.
 *
 * See `data/population/pendingCorrections.ts` / `populationCorrections.ts` /
 * `data/answers/pendingBulkReopen.ts` for the data-layer design (why
 * corrections target population fields, why sample.master.json and the
 * distribution cache both need patching, why bulk reopen is a separate,
 * explicit action rather than automatic after import).
 */
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../../../../../ModalShell/ModalShell";
import { ConfirmDialog } from "../../../../../ConfirmDialog/ConfirmDialog";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import type { Labels } from "../../../../../../data/labels/useLabels";
import {
  buildPendingExportRows,
  exportPendingCorrectionsXlsx,
  isPendingReferralEntry,
} from "../../../../../../data/population/pendingCorrections";
import {
  applyPopulationFieldCorrections,
  computeCorrectionPreview,
  loadCorrectionPopulationIndex,
  parseImportRows,
  type CorrectionPreview,
} from "../../../../../../data/population/populationCorrections";
import { bulkReopenPendingItems } from "../../../../../../data/answers/pendingBulkReopen";
import { appendWorkspaceAction } from "../../../../../../data/audit/actionLog";
import { logError } from "../../../../../../data/storage/errorLogger";
import PendingCorrectionsWorker from "../../../../../../workers/pendingCorrectionsImportWorker?worker&inline";
import type { PendingCorrectionsImportResponse } from "../../../../../../workers/pendingCorrectionsImportWorkerTypes";

type ImportState =
  | { phase: "idle" }
  | { phase: "parsing" }
  | { phase: "preview"; preview: CorrectionPreview }
  | { phase: "applying" }
  | { phase: "done"; changedFields: number; ids: number }
  | { phase: "error"; message: string };

type Props = {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  entries: readonly DistributionEntry[];
  answersMap: ReadonlyMap<string, ItemAnswer>;
  template: TemplateSchema | null;
  username: string;
  role: string;
  labels: Labels;
  canManage: boolean;
  onChanged: () => Promise<void>;
};

function ImportPreviewBody({
  state,
  labels,
  onApply,
  onCancel,
}: {
  state: ImportState;
  labels: Labels;
  onApply: (preview: CorrectionPreview) => void;
  onCancel: () => void;
}) {
  if (state.phase === "idle") {
    return <p>{labels.ew_pending_import_pick_file}</p>;
  }
  if (state.phase === "parsing" || state.phase === "applying") {
    return <p role="status">{state.phase === "parsing" ? labels.ew_pending_import_parsing : labels.ew_pending_import_applying}</p>;
  }
  if (state.phase === "error") {
    return <p className="ew-replace-error" role="alert">{state.message}</p>;
  }
  if (state.phase === "done") {
    return (
      <p role="status">
        {labels.ew_pending_import_done
          .replace("{changed}", String(state.changedFields))
          .replace("{ids}", String(state.ids))}
      </p>
    );
  }
  // "preview"
  const { preview } = state;
  const changedIds = new Set(preview.changes.map((c) => c.xrayImageId));
  return (
    <div className="ew-replace-reason">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <li>{labels.ew_pending_import_summary_matched}: {preview.matchedIds.length.toLocaleString("ar-SA-u-nu-latn")}</li>
        <li>{labels.ew_pending_import_summary_changed}: {preview.changes.length.toLocaleString("ar-SA-u-nu-latn")} ({changedIds.size.toLocaleString("ar-SA-u-nu-latn")} حالة)</li>
        <li>{labels.ew_pending_import_summary_unchanged}: {preview.unchangedIds.length.toLocaleString("ar-SA-u-nu-latn")}</li>
        <li>{labels.ew_pending_import_summary_unmatched}: {preview.unmatchedIds.length.toLocaleString("ar-SA-u-nu-latn")}</li>
      </ul>
      {preview.unmatchedIds.length > 0 && (
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          {labels.ew_pending_import_unmatched_list.replace("{ids}", preview.unmatchedIds.join("، "))}
        </p>
      )}
      {preview.changes.length === 0 ? (
        <p>{labels.ew_pending_import_no_changes}</p>
      ) : (
        <div className="ew-replace-reason" style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ew-btn-secondary" onClick={onCancel}>
            {labels.ew_pending_import_cancel_btn}
          </button>
          <button type="button" className="ew-btn-primary" onClick={() => onApply(preview)}>
            {labels.ew_pending_import_apply_btn}
          </button>
        </div>
      )}
    </div>
  );
}

export default function PendingCorrections({
  directoryHandle, monthFolderName, entries, answersMap, template,
  username, role, labels: L, canManage, onChanged,
}: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenMsg, setReopenMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // Bumped on every new file selection; a worker response is only applied if it
  // still matches the LATEST generation when it arrives. Guards against the
  // worker's async `onmessage` (it yields at `await file.arrayBuffer()`) resolving
  // two picked-in-a-row files out of order and letting a stale response overwrite
  // a newer one.
  const importGenerationRef = useRef(0);
  // Synchronous re-entrancy guard for bulk-reopen: `ConfirmDialog` has no
  // disabled/busy prop, so its confirm button stays clickable through the whole
  // sequential reopen loop. `reopenBusy` state alone can't stop a same-tick double
  // click (React state updates aren't visible until the next render), so this ref
  // is checked first and set synchronously before any await.
  const reopenInFlightRef = useRef(false);

  const pendingCount = entries.filter((entry) => isPendingReferralEntry(entry, answersMap, template)).length;

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  if (!canManage || !monthFolderName) return null;

  function handleExportClick(): void {
    const rows = buildPendingExportRows(entries, answersMap, template);
    if (rows.length === 0) {
      setImportState({ phase: "error", message: L.ew_pending_export_empty });
      setImportOpen(true);
      return;
    }
    exportPendingCorrectionsXlsx(rows, L, monthFolderName);
    void appendWorkspaceAction(directoryHandle, {
      actor: username,
      actorRole: role,
      action: "pending-export-generated",
      monthFolderName,
      details: { count: rows.length },
    });
  }

  function handleFileSelected(file: File): void {
    if (importState.phase === "parsing") return; // a parse is already in flight
    const generation = ++importGenerationRef.current;
    setImportState({ phase: "parsing" });
    setImportOpen(true);
    if (!workerRef.current) workerRef.current = new PendingCorrectionsWorker();
    const worker = workerRef.current;
    worker.onmessage = (ev: MessageEvent<PendingCorrectionsImportResponse>) => {
      // Discard a response for a request that's no longer the latest one — the
      // user picked another file before this one's async parse landed.
      if (generation !== importGenerationRef.current) return;
      const msg = ev.data;
      if (msg.type === "progress") return;
      if (msg.type === "error") {
        setImportState({ phase: "error", message: msg.error });
        return;
      }
      void (async () => {
        try {
          const parsed = parseImportRows(msg.rows, msg.headerRow, L);
          const populationIndex = await loadCorrectionPopulationIndex(directoryHandle, monthFolderName);
          // Re-check: an even newer selection could have landed during the await above.
          if (generation !== importGenerationRef.current) return;
          setImportState({ phase: "preview", preview: computeCorrectionPreview(parsed, populationIndex) });
        } catch (error) {
          if (generation !== importGenerationRef.current) return;
          logError("pendingCorrections:preview", error);
          setImportState({ phase: "error", message: L.ew_pending_import_error });
        }
      })();
    };
    worker.postMessage({ file });
  }

  async function handleApply(preview: CorrectionPreview): Promise<void> {
    setImportState({ phase: "applying" });
    const result = await applyPopulationFieldCorrections({
      directoryHandle,
      monthFolderName,
      changes: preview.changes,
      actorUsername: username,
      actorRole: role,
    });
    if (!result.ok) {
      setImportState({ phase: "error", message: result.error });
      return;
    }
    setImportState({
      phase: "done",
      changedFields: preview.changes.length,
      ids: new Set(preview.changes.map((c) => c.xrayImageId)).size,
    });
    await onChanged();
  }

  async function handleBulkReopen(): Promise<void> {
    if (reopenInFlightRef.current) return;
    reopenInFlightRef.current = true;
    setReopenBusy(true);
    try {
      const result = await bulkReopenPendingItems({
        directoryHandle,
        monthFolderName,
        entries,
        answersMap,
        template,
        reopenedBy: username,
        reopenedByRole: role,
        reason: "إعادة فتح جماعي للحالات المعلقة بعد تصحيح البيانات",
      });
      setReopenMsg(
        result.failed.length === 0
          ? L.ew_pending_bulk_reopen_done
              .replace("{ok}", String(result.succeeded))
              .replace("{total}", String(result.attempted))
          : L.ew_pending_bulk_reopen_partial
              .replace("{failed}", String(result.failed.length))
              .replace("{total}", String(result.attempted))
      );
      setReopenConfirmOpen(false);
      await onChanged();
    } finally {
      reopenInFlightRef.current = false;
      setReopenBusy(false);
    }
  }

  return (
    <>
      <div className="ew-pending-corrections-bar">
        <strong>{L.ew_pending_bar_title} ({pendingCount.toLocaleString("ar-SA-u-nu-latn")})</strong>
        <button type="button" className="ew-btn-secondary ew-btn-sm" onClick={handleExportClick}>
          {L.ew_pending_export_btn}
        </button>
        <button
          type="button"
          className="ew-btn-secondary ew-btn-sm"
          disabled={importState.phase === "parsing"}
          onClick={() => { setImportState({ phase: "idle" }); fileInputRef.current?.click(); }}
        >
          {L.ew_pending_import_btn}
        </button>
        <button
          type="button"
          className="ew-btn-secondary ew-btn-sm"
          disabled={pendingCount === 0}
          onClick={() => setReopenConfirmOpen(true)}
        >
          {L.ew_pending_bulk_reopen_btn}
        </button>
        {reopenMsg && <span role="status">{reopenMsg}</span>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) handleFileSelected(file);
        }}
      />

      {importOpen && (
        <ModalShell variant="ew" title={L.ew_pending_import_modal_title} onClose={() => setImportOpen(false)}>
          <ImportPreviewBody
            state={importState}
            labels={L}
            onCancel={() => setImportOpen(false)}
            onApply={(preview) => { void handleApply(preview); }}
          />
        </ModalShell>
      )}

      <ConfirmDialog
        open={reopenConfirmOpen}
        title={L.ew_pending_bulk_reopen_confirm_title}
        message={
          pendingCount === 0
            ? L.ew_pending_bulk_reopen_none
            : L.ew_pending_bulk_reopen_confirm_message.replace("{count}", String(pendingCount))
        }
        confirmLabel={reopenBusy ? "..." : L.ew_pending_bulk_reopen_confirm_ok}
        onConfirm={() => { if (pendingCount > 0) void handleBulkReopen(); else setReopenConfirmOpen(false); }}
        onCancel={() => setReopenConfirmOpen(false)}
      />
    </>
  );
}
