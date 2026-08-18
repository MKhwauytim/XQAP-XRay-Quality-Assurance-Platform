import { processBiWorkbook } from "../components/Sidebar/Tabs/Population/biData/biDataWorkbook";
import { processRiskWorkbook } from "../components/Sidebar/Tabs/Population/riskData/riskDataWorkbook";
import type { BiFileResult, WorkbookWorkerRequest, WorkbookWorkerResponse } from "./workbookWorkerTypes";

// At runtime this module executes inside a DedicatedWorker, not a Window.
// We cast globalThis once to avoid conflicts with the DOM lib's Window types.
const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<WorkbookWorkerRequest>) => void) | null;
  postMessage: (msg: WorkbookWorkerResponse) => void;
};

const send = (msg: WorkbookWorkerResponse) => ctx.postMessage(msg);

ctx.onmessage = async (ev) => {
  const { riskFile, biFiles, riskSheetPatterns, biSheetPatterns, columnMappings, biColumnMappings } = ev.data;

  try {
    const riskResult = await processRiskWorkbook(
      riskFile,
      (stage, percent) => send({ type: "progress", message: `${stage} (${percent}%)` }),
      riskSheetPatterns,
      columnMappings
    );

    // Every BI file is processed with the SAME sheet patterns and column
    // mappings — they are different populations of one BI dataset, not
    // differently-shaped sources. The main thread appends the results.
    const biResults: BiFileResult[] = [];
    const failedFileNames: string[] = [];

    for (let i = 0; i < biFiles.length; i++) {
      const biFile = biFiles[i];
      // The main thread's 180 s silence watchdog resets on every `progress`
      // message. processBiWorkbook reports per sheet and per 10k-row chunk, and
      // the `(i+1/n)` prefix below is the only thing added per file, so a
      // ten-file import reports at least as often as a one-file import did.
      const onProgress = (stage: string, percent: number) =>
        send({
          type: "progress",
          message: `(${i + 1}/${biFiles.length}) ${biFile.name} — ${stage} (${percent}%)`
        });

      try {
        const result = await processBiWorkbook(
          biFile,
          onProgress,
          biSheetPatterns,
          biColumnMappings ?? columnMappings
        );
        biResults.push({ fileName: biFile.name, result });
      } catch (biErr) {
        // BI files are optional — a per-file SOFT failure. It yields an error
        // entry (which the UI renders as an error row) and a warning, never a
        // failed import: the risk file is the only required one, and the other
        // BI files still contribute their rows.
        const message = biErr instanceof Error ? biErr.message : "خطأ غير معروف";
        biResults.push({ fileName: biFile.name, result: null, error: message });
        failedFileNames.push(`${biFile.name} (${message})`);
      }
    }

    const warning =
      failedFileNames.length > 0
        ? `تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملفات ذكاء الأعمال التالية: ${failedFileNames.join("، ")}. يمكنك المتابعة لأن ملفات ذكاء الأعمال داعمة وليست شرطاً.`
        : undefined;

    send({ type: "done", riskResult, biResults, warning });
  } catch (err) {
    send({ type: "error", error: err instanceof Error ? err.message : "خطأ غير معروف في معالجة الملفات." });
  }
};
