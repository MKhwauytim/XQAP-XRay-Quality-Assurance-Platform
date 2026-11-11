/**
 * Where the strategic indicator lives in the workspace:
 *
 *   5-system/strategic-indicator/
 *     indicator.template.xlsx    the owner's workbook, exactly as uploaded
 *     indicator.baseline.json    what `scanIndicatorWorkbook` read from it
 *
 * The workbook is the export template, so it is stored whole (it is tens of
 * MB). It is written in slices and read back as a lazy `File`, so neither
 * direction holds it in memory.
 *
 * The two files are written workbook first, summary second, and the summary
 * records the workbook's size. A summary whose size does not match the
 * workbook on disk means an upload was interrupted (or the file was replaced by
 * hand), and the pair is reported as absent rather than trusted.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { getStrategicIndicatorDir } from "../workspace/workspacePaths";
import type { IndicatorBaseline } from "./indicatorTemplate";

export const INDICATOR_TEMPLATE_FILE = "indicator.template.xlsx";
export const INDICATOR_BASELINE_FILE = "indicator.baseline.json";

export type StoredIndicator = { baseline: IndicatorBaseline; template: Blob };

type BinaryWritable = { write: (data: ArrayBuffer) => Promise<void>; close: () => Promise<void> };

const WRITE_SLICE_BYTES = 8 * 1024 * 1024;

export async function saveIndicatorTemplate(
  directoryHandle: DirectoryHandleLike,
  template: Blob,
  baseline: IndicatorBaseline
): Promise<void> {
  await withWorkspaceWriteAccess(directoryHandle, async () => {
    const dir = await getStrategicIndicatorDir(directoryHandle, true);
    const handle = await dir.getFileHandle(INDICATOR_TEMPLATE_FILE, { create: true });
    if (!handle.createWritable) throw new Error("مساحة العمل للقراءة فقط: تعذر حفظ ملف المؤشر.");
    const writable = (await handle.createWritable()) as unknown as BinaryWritable;
    for (let offset = 0; offset < template.size; offset += WRITE_SLICE_BYTES) {
      await writable.write(await template.slice(offset, offset + WRITE_SLICE_BYTES).arrayBuffer());
    }
    await writable.close();
    await safeWriteJson(dir, INDICATOR_BASELINE_FILE, baseline);
  });
}

/** The stored workbook and its summary, or `null` when none is stored (or the pair does not match). */
export async function loadStoredIndicator(directoryHandle: DirectoryHandleLike): Promise<StoredIndicator | null> {
  const dir = await getStrategicIndicatorDir(directoryHandle, false).catch(() => null);
  if (!dir) return null;
  const result = await safeReadJson<IndicatorBaseline>(dir, INDICATOR_BASELINE_FILE);
  if (!result.ok) return null;
  try {
    const template = await (await dir.getFileHandle(INDICATOR_TEMPLATE_FILE)).getFile();
    return template.size === result.value.sizeBytes ? { baseline: result.value, template } : null;
  } catch {
    return null;
  }
}
