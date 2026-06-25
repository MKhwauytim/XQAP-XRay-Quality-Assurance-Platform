import * as XLSX from "xlsx";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleEmployeeDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { ItemAnswer } from "./answerTypes";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد المراجعة",
  completed: "تم",
  "replacement-requested": "طلب استبدال",
  replaced: "تم الاستبدال",
};

function xlsxFileName(username: string): string {
  return `${safeWorkspaceFilePart(username)}.xlsx`;
}

/**
 * Write (or overwrite) a per-employee XLSX file in the 2-Employees workspace folder.
 *
 * Call without `answers` on initial distribution to create a blank-answers file.
 * Call with `answers` once the employee has submitted every assigned sample.
 */
export async function writeEmployeeXlsx(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  username: string,
  entries: DistributionEntry[],
  answers?: ItemAnswer[]
): Promise<void> {
  const answerMap = new Map(answers?.map((a) => [a.xrayImageId, a]) ?? []);
  const hasAnswers = answers != null && answers.length > 0;

  // Collect answer field IDs from the first answered item so columns are consistent.
  const fieldIds: string[] = [];
  if (hasAnswers) {
    const first = answers!.find((a) => a.answers.length > 0);
    if (first) fieldIds.push(...first.answers.map((f) => f.fieldId));
  }

  const header: string[] = [
    "رقم الصورة",
    "المنفذ",
    "النوع",
    "تاريخ الدخول",
    "رقم البيان",
    "نتيجة الفحص 1",
    "نتيجة الفحص 2",
    "الحالة",
    ...(hasAnswers ? ["تاريخ الرفع", ...fieldIds] : []),
  ];

  const rows: (string | null)[][] = entries.map((e) => {
    const r = e.row;
    const ans = answerMap.get(e.xrayImageId);
    const base: (string | null)[] = [
      e.xrayImageId,
      r.portName ?? "",
      r.certScanStatus,
      r.xrayEntryDate ?? "",
      r.declarationNumber ?? "",
      r.xrayLevelOneResult,
      r.xrayLevelTwoResult,
      STATUS_LABELS[e.status] ?? e.status,
    ];
    if (hasAnswers) {
      base.push(ans?.submittedAt ?? "");
      for (const fid of fieldIds) {
        const val = ans?.answers.find((f) => f.fieldId === fid)?.value;
        base.push(val == null ? "" : String(val));
      }
    }
    return base;
  });

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  // Sheet name must be ≤ 31 chars.
  XLSX.utils.book_append_sheet(wb, ws, monthFolderName.slice(0, 31));

  const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const dir = await getSampleEmployeeDir(directoryHandle, monthFolderName, true);
  const fh = await dir.getFileHandle(xlsxFileName(username), { create: true });
  if (!fh.createWritable) return;
  const writable = await fh.createWritable();
  await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(buf);
  await writable.close();
}
