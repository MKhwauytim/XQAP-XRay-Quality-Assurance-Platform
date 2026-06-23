import { processBiWorkbook } from "../components/Sidebar/Tabs/Population/biData/biDataWorkbook";
import { processRiskWorkbook } from "../components/Sidebar/Tabs/Population/riskData/riskDataWorkbook";
import type { WorkbookWorkerRequest, WorkbookWorkerResponse } from "./workbookWorkerTypes";

// At runtime this module executes inside a DedicatedWorker, not a Window.
// We cast globalThis once to avoid conflicts with the DOM lib's Window types.
const ctx = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<WorkbookWorkerRequest>) => void) | null;
  postMessage: (msg: WorkbookWorkerResponse) => void;
};

const send = (msg: WorkbookWorkerResponse) => ctx.postMessage(msg);

ctx.onmessage = async (ev) => {
  const { riskFile, biFile, riskSheetPatterns, biSheetPatterns, columnMappings, biColumnMappings } = ev.data;

  try {
    const riskResult = await processRiskWorkbook(
      riskFile,
      (stage, percent) => send({ type: "progress", message: `${stage} (${percent}%)` }),
      riskSheetPatterns,
      columnMappings
    );

    let biResult = null;
    let warning: string | undefined;

    if (biFile) {
      try {
        biResult = await processBiWorkbook(
          biFile,
          (stage, percent) => send({ type: "progress", message: `${stage} (${percent}%)` }),
          biSheetPatterns,
          biColumnMappings ?? columnMappings
        );
      } catch {
        // BI file is optional — soft failure, continue with null
        warning = "تمت قراءة بيانات وكالة المخاطر، ولكن تعذر قراءة ملف ذكاء الأعمال. يمكنك المتابعة لأن ملف ذكاء الأعمال داعم وليس شرطاً.";
      }
    }

    send({ type: "done", riskResult, biResult, warning });
  } catch (err) {
    send({ type: "error", error: err instanceof Error ? err.message : "خطأ غير معروف في معالجة الملفات." });
  }
};
