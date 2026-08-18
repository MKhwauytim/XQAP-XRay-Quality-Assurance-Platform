import { useRef, useState, type ChangeEvent, type RefObject } from "react";

import { getLabels } from "../../../../data/labels/labelsStore";
import { codedMessage, logCodedError } from "../../../../data/storage/errorCodes";
import {
  MAX_BI_UPLOADS,
  type BiUploadEntry,
  type BiWorkbookResult
} from "./biData/biDataTypes";
import { mergeBiWorkbookResults } from "./biData/biDataWorkbook";
import type { RiskWorkbookResult } from "./riskData/riskDataTypes";
import { isSupportedExcelFile } from "./populationWorkflowHelpers";
import type { BiFileResult } from "../../../../workers/workbookWorkerTypes";

export type UploadKey = "riskAgencyData" | "businessIntelligenceData";

export type UploadState = {
  file: File | null;
  source: "file-system-api" | "input-fallback" | null;
};

/**
 * Phase-1 sources. The risk-agency file is a single, required upload exactly as
 * before; the BI side is a list of up to MAX_BI_UPLOADS files. Multiple BI files
 * are different populations that share the same sheet patterns and column
 * mappings, so they are APPENDED into one BI population (see
 * mergeBiWorkbookResults) — never deduplicated, never rejected on overlap.
 * The "N من 10" pill and the accepted-rows total are derived on render.
 */
export type PhaseOneUploads = {
  riskAgencyData: UploadState;
  biUploads: BiUploadEntry[];
};

/** Extensions accepted for a BI source — CSV goes through the SAME parser. */
function isSupportedBiFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

function newBiUploadId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `bi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Sub-line shown under a file name before it has been parsed. */
function biDisplayNameForFile(file: File): string {
  const base = file.name.split(/[\\/]/).pop() ?? file.name;
  return base.replace(/\.[^.]+$/, "").trim() || base;
}

/** Fill `{name}` placeholders in a label value. */
export function fillLabel(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
}

type PhaseOneUploadDeps = {
  /**
   * The combined permission + closed-month + month-loading gate. Every entry
   * point into an upload mutation re-checks it, not just the render-time one:
   * the picker, the fallback <input> change handler and the per-row remove are
   * three separate doors into the same state.
   */
  canUploadNow: boolean;
  setUploadError: (message: string) => void;
  setProcessingMessage: (message: string) => void;
  setBiWorkbookResult: (result: BiWorkbookResult | null) => void;
  setRiskWorkbookResult: (result: RiskWorkbookResult | null) => void;
  /** Any change to the attached set invalidates an already-processed population. */
  onAttachedSetChanged: () => void;
};

export type PhaseOneUploadController = {
  uploads: PhaseOneUploads;
  setUploads: React.Dispatch<React.SetStateAction<PhaseOneUploads>>;
  riskAgencyInputRef: RefObject<HTMLInputElement | null>;
  businessIntelligenceInputRef: RefObject<HTMLInputElement | null>;
  pickExcelFile: (uploadKey: UploadKey) => Promise<void>;
  handleFallbackFileChange: (uploadKey: UploadKey, event: ChangeEvent<HTMLInputElement>) => void;
  removeBiUpload: (id: string) => void;
  clearSelectedFile: (uploadKey: UploadKey) => void;
  /**
   * Owner request (2026-08-18): drag-and-drop onto the Phase 1 cards. Same
   * semantics as the picker/fallback input — BI appends (multi-file, capped),
   * the risk side takes the first dropped file only.
   */
  handleDroppedFiles: (uploadKey: UploadKey, files: File[]) => void;
  applyBiFileResults: (requested: BiUploadEntry[], outcomes: BiFileResult[]) => void;
};

/**
 * Phase 1's file-attachment state and every door into it.
 *
 * Extracted from `PopulationTab` when multi-file BI (2026-08 handoff §3) pushed
 * that component past the repo's `max-lines-per-function` budget. This is a
 * straight move — the handlers, their guards and their comments are unchanged;
 * what used to be closure access is now an explicit `deps` argument.
 */
export function usePhaseOneUploads(deps: PhaseOneUploadDeps): PhaseOneUploadController {
  const {
    canUploadNow,
    setUploadError,
    setProcessingMessage,
    setBiWorkbookResult,
    setRiskWorkbookResult,
    onAttachedSetChanged
  } = deps;

  const [uploads, setUploads] = useState<PhaseOneUploads>({
    riskAgencyData: { file: null, source: null },
    biUploads: []
  });

  /**
   * Fix (population, 2026-08-18): a stray id set kept in lockstep with
   * `uploads.biUploads`, written synchronously wherever the list changes (not
   * derived via an effect, which would lag a render behind). `applyBiFileResults`
   * consults it to drop a file's outcome from the merge if the user removed that
   * row WHILE its parse was still in flight — without this, a removed file's
   * rows could still land in the merged BiWorkbookResult (and therefore the
   * saved population) even though its row had already disappeared from the UI
   * and its raw file was correctly excluded from the disk archive.
   */
  const biUploadIdsRef = useRef<Set<string>>(new Set());

  const riskAgencyInputRef = useRef<HTMLInputElement | null>(null);
  const businessIntelligenceInputRef = useRef<HTMLInputElement | null>(null);

  async function pickExcelFile(uploadKey: UploadKey): Promise<void> {
    // Audit finding 12: this used to check only canUploadData, so a keyboard
    // user (whose Tab/Enter bypasses the wrapper's now-removed pointer-events
    // CSS trick) or any caller could still open the file picker during a
    // closed month or while month data was still loading -- exactly the
    // window canUploadNow (canUploadData && !selectedMonthClosed &&
    // !isLoadingMonthData) exists to block.
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      return;
    }
    setUploadError("");
    setProcessingMessage("");

    const browserWindow = window as Window & { showOpenFilePicker?: (...args: unknown[]) => Promise<FileSystemFileHandle[]> };

    if (!browserWindow.showOpenFilePicker) {
      openFallbackInput(uploadKey);
      return;
    }

    // BI is multi-file (up to MAX_BI_UPLOADS) and additionally accepts .csv;
    // the risk-agency source stays single-file and Excel-only.
    const isBi = uploadKey === "businessIntelligenceData";

    try {
      const handles = await browserWindow.showOpenFilePicker({
        multiple: isBi,
        types: [
          {
            description: "Excel Files",
            accept: isBi
              ? {
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
                    ".xlsx"
                  ],
                  "application/vnd.ms-excel": [".xls"],
                  "text/csv": [".csv"]
                }
              : {
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
                    ".xlsx"
                  ],
                  "application/vnd.ms-excel": [".xls"]
                }
          }
        ],
        excludeAcceptAllOption: true
      });

      if (isBi) {
        const files: File[] = [];
        for (const handle of handles) {
          const file = await handle.getFile();
          if (file) files.push(file);
        }
        if (files.length === 0) return;
        appendBiFiles(files);
        return;
      }

      const selectedFile = await handles[0]?.getFile();

      if (!selectedFile) {
        return;
      }

      applySelectedFile(selectedFile, "file-system-api");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      logCodedError("population:file-picker", "XQ-POP-001", error);
      setUploadError(codedMessage("XQ-POP-001"));
      openFallbackInput(uploadKey);
    }
  }

  function openFallbackInput(uploadKey: UploadKey): void {
    if (uploadKey === "riskAgencyData") {
      riskAgencyInputRef.current?.click();
      return;
    }
    businessIntelligenceInputRef.current?.click();
  }

  function handleFallbackFileChange(
    uploadKey: UploadKey,
    event: ChangeEvent<HTMLInputElement>
  ): void {
    const selectedFiles = Array.from(event.target.files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    // Audit finding 12: same canUploadNow re-check as pickExcelFile above --
    // this is the fallback <input type=file> change handler, a second entry
    // point into the same mutation that must not skip the closed-month/
    // loading gate.
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      event.target.value = "";
      return;
    }

    if (uploadKey === "businessIntelligenceData") {
      appendBiFiles(selectedFiles);
      event.target.value = "";
      return;
    }

    applySelectedFile(selectedFiles[0], "input-fallback");
    event.target.value = "";
  }

  /**
   * APPEND the picked BI files to the list — never replace. Files beyond
   * MAX_BI_UPLOADS are dropped with an explicit message rather than silently
   * ignored. Unsupported extensions are rejected the same way; nothing is
   * parsed here (parsing happens on "قراءة الملفات").
   */
  function appendBiFiles(files: File[]): void {
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      return;
    }

    const supported = files.filter(isSupportedBiFile);
    // The cap decision is made here, not inside the setUploads updater: a state
    // updater must stay pure (StrictMode invokes it twice), so it cannot be the
    // place that raises the user-facing message.
    const room = Math.max(0, MAX_BI_UPLOADS - uploads.biUploads.length);
    const accepted = supported.slice(0, room);

    if (supported.length !== files.length) {
      setUploadError(getLabels().phase_one_unsupported_file);
    } else if (accepted.length < supported.length) {
      setUploadError(fillLabel(getLabels().phase_one_bi_cap_error, { max: MAX_BI_UPLOADS }));
    } else {
      setUploadError("");
    }

    if (accepted.length === 0) return;

    const newEntries = accepted.map((file): BiUploadEntry => ({
      id: newBiUploadId(),
      file,
      sheetName: biDisplayNameForFile(file),
      sizeBytes: file.size,
      acceptedRows: null,
      state: "ready"
    }));

    setUploads((currentUploads) => {
      // APPEND, never replace.
      const biUploads = [...currentUploads.biUploads, ...newEntries].slice(0, MAX_BI_UPLOADS);
      // Deterministic function of the arguments -- safe to write here even
      // under StrictMode's double-invoke, since a second call just writes the
      // same set again.
      biUploadIdsRef.current = new Set(biUploads.map((entry) => entry.id));
      return { ...currentUploads, biUploads };
    });

    // The attached set changed, so any previously parsed BI result is stale.
    setBiWorkbookResult(null);
    onAttachedSetChanged();
  }

  /** Per-row removal. The accepted-rows total is derived, so it recomputes itself. */
  function removeBiUpload(id: string): void {
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      return;
    }

    setUploads((currentUploads) => {
      const biUploads = currentUploads.biUploads.filter((entry) => entry.id !== id);
      biUploadIdsRef.current = new Set(biUploads.map((entry) => entry.id));
      return { ...currentUploads, biUploads };
    });

    setBiWorkbookResult(null);
    onAttachedSetChanged();
  }

  /** Risk-agency only — the BI side appends through appendBiFiles instead. */
  function applySelectedFile(
    file: File,
    source: UploadState["source"]
  ): void {
    if (!isSupportedExcelFile(file)) {
      setUploadError(
        "صيغة الملف غير مدعومة. الرجاء اختيار ملف Excel بصيغة XLSX أو XLS."
      );
      return;
    }

    setUploads((currentUploads) => ({
      ...currentUploads,
      riskAgencyData: { file, source }
    }));

    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    setUploadError("");
    onAttachedSetChanged();
  }

  function clearSelectedFile(uploadKey: UploadKey): void {
    // Audit finding 12: this checked nothing at all -- a keyboard user could
    // wipe their own already-parsed in-memory workbook result during a window
    // the UI means to block (closed month, no upload permission, or month
    // data still loading), losing work with no way to recover it short of
    // re-uploading and re-parsing.
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      return;
    }
    setUploads((currentUploads) => {
      if (uploadKey !== "businessIntelligenceData") {
        return { ...currentUploads, riskAgencyData: { file: null, source: null } };
      }
      biUploadIdsRef.current = new Set();
      return { ...currentUploads, biUploads: [] };
    });

    setRiskWorkbookResult(null);
    setBiWorkbookResult(null);
    onAttachedSetChanged();
  }

  /**
   * Write the worker's per-file BI outcomes back onto the upload rows, then
   * APPEND the successful ones into the single BiWorkbookResult everything
   * downstream consumes.
   *
   * `outcomes` is index-aligned with `requested`, which is the snapshot of
   * uploads.biUploads taken when the parse started — rows are matched by id so
   * a row removed mid-parse simply drops out of the per-row state update below
   * (it maps over the CURRENT `uploads.biUploads`, not `requested`).
   *
   * The merge into `biWorkbookResult` needed the same guarantee and did not
   * have it (Fix, 2026-08-18): it built `successes` straight from `outcomes`,
   * so a file removed while its parse was still in flight would still have its
   * rows folded into the merged result and, from there, into the saved
   * population — even though its row had already vanished from the list and
   * its raw file was correctly excluded from the disk archive. `biUploadIdsRef`
   * (kept in lockstep with `uploads.biUploads` by every mutator) is the fix:
   * an outcome only counts if its id is still attached at merge time.
   */
  function applyBiFileResults(
    requested: BiUploadEntry[],
    outcomes: BiFileResult[]
  ): void {
    const byId = new Map<string, BiFileResult | undefined>(
      requested.map((entry, index) => [entry.id, outcomes[index]])
    );
    const stillAttached = biUploadIdsRef.current;

    setUploads((current) => ({
      ...current,
      biUploads: current.biUploads.map((entry) => {
        const outcome = byId.get(entry.id);
        if (!outcome) return entry.state === "parsing" ? { ...entry, state: "ready" } : entry;

        if (!outcome.result) {
          return {
            ...entry,
            state: "error",
            acceptedRows: null,
            error: outcome.error ?? getLabels().phase_one_bi_no_value
          };
        }

        const result = outcome.result;
        // Zero accepted rows AND nothing classifiable = the silent-zero-import
        // failure (a CSV whose derived name matched no configured pattern is the
        // common case). Surface it as an explicit error row, not a quiet 0.
        if (result.totalNormalizedRows === 0 && result.unknownSheetNames.length > 0) {
          return {
            ...entry,
            state: "error",
            acceptedRows: 0,
            error: fillLabel(getLabels().phase_one_bi_unclassified, {
              sheets: result.unknownSheetNames.join("، ")
            })
          };
        }

        const sheetNames = result.sheetSummaries.map((sheet) => sheet.sheetName);
        return {
          ...entry,
          state: "ready",
          acceptedRows: result.totalNormalizedRows,
          sheetName: sheetNames.length > 0 ? sheetNames.join("، ") : entry.sheetName,
          error: undefined
        };
      })
    }));

    const successes = requested
      .filter((entry) => stillAttached.has(entry.id))
      .map((entry) => byId.get(entry.id))
      .filter(
        (outcome): outcome is BiFileResult & { result: BiWorkbookResult } =>
          outcome !== undefined && outcome.result !== null
      );

    setBiWorkbookResult(
      successes.length === 0
        ? null
        : mergeBiWorkbookResults(
            successes.map((outcome) => outcome.result),
            successes.map((outcome) => outcome.fileName)
          )
    );
  }
  function handleDroppedFiles(uploadKey: UploadKey, files: File[]): void {
    if (files.length === 0) return;
    // Same gate as every other door into the upload state (the appenders
    // re-check it too; the early check gives the user the message instead of
    // a silent no-op drop).
    if (!canUploadNow) {
      setUploadError("لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل.");
      return;
    }
    if (uploadKey === "businessIntelligenceData") {
      appendBiFiles(files);
      return;
    }
    applySelectedFile(files[0]!, "input-fallback");
  }

  return {
    uploads,
    setUploads,
    clearSelectedFile,
    handleDroppedFiles,
    riskAgencyInputRef,
    businessIntelligenceInputRef,
    pickExcelFile,
    handleFallbackFileChange,
    removeBiUpload,
    applyBiFileResults
  };
}
