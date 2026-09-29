import { useState, type MutableRefObject } from "react";

import { exportFeedbackWorkbook } from "../../data/feedback/feedbackExport";
import { readAllThreadsForExport } from "../../data/feedback/feedbackExportRead";
import type { FeedbackThread } from "../../data/feedback/feedbackStorage";
import { mergeFeedbackThreads } from "../../data/feedback/feedbackThreadMerge";
import { getLabels } from "../../data/labels/labelsStore";
import { logError } from "../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";

type ExportNotice = { kind: "error" | "empty" | "partial"; text: string };

type Options = {
  directoryHandle: DirectoryHandleLike | null;
  /** Real admin only (role admin AND not the demo session). */
  isRealAdmin: boolean;
  /** The workspace the tab currently shows; a read for another one is dropped. */
  currentHandleRef: MutableRefObject<DirectoryHandleLike | null>;
  /** Threads this tab holds; a fresher local copy wins and recovers a skipped read. */
  threadsByIdRef: MutableRefObject<Record<string, FeedbackThread>>;
};

/**
 * Admin export of every feedback conversation (Workstream B). The full read
 * happens ONLY when `startExport` runs (the button click) -- never on panel open.
 */
export function useFeedbackExport({
  directoryHandle,
  isRealAdmin,
  currentHandleRef,
  threadsByIdRef,
}: Options) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null);

  async function startExport() {
    // Re-checked at the handler, not only at render (a demo session reports
    // role "admin" and must never reach the read).
    if (!isRealAdmin || !directoryHandle || isExporting) return;
    const handle = directoryHandle;
    setExportNotice(null);
    setExportProgress(null);
    setIsExporting(true);
    try {
      const { threads: read, skippedIds } = await readAllThreadsForExport(handle, {
        onProgress: (done, total) => {
          if (currentHandleRef.current === handle) setExportProgress({ done, total });
        },
      });
      // Reading is over: the button now says "exporting" while the workbook builds.
      setExportProgress(null);
      // Another workspace was opened while reading: this data is not its data.
      if (currentHandleRef.current !== handle) return;
      const local = threadsByIdRef.current;
      // A thread this tab wrote or read itself may be fresher than the read.
      const threads = mergeFeedbackThreads(read, local);
      // A thread the read skipped but this tab holds is in the file, so not lost.
      const skipped = skippedIds.filter((id) => !local[id]).length;
      const { threadCount } = await exportFeedbackWorkbook(threads, getLabels());
      // A header-only file is indistinguishable from a broken button -- say so,
      // same reasoning as ErrorLogSection's export.
      if (threadCount === 0) setExportNotice({ kind: "empty", text: getLabels().fb_export_empty });
      else if (skipped > 0) {
        setExportNotice({
          kind: "partial",
          text: getLabels().fb_export_partial.replace("{skipped}", String(skipped)),
        });
      }
    } catch (err) {
      logError("feedback:export", err);
      if (currentHandleRef.current === handle) {
        setExportNotice({ kind: "error", text: getLabels().fb_export_failed });
      }
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  }

  return { isExporting, exportProgress, exportNotice, startExport };
}
