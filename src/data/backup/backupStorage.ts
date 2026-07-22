import * as XLSX from "xlsx";

import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { MonthFolderInfo } from "../population/monthFolder";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "../population/monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson, safeWriteJsonText } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { exportLabelsSnapshot } from "../workspace/labelsSnapshot";
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  POPULATION_SUBFOLDERS,
  SYSTEM_FOLDER_NAMES,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = SYSTEM_FOLDER_NAMES.backups;
// Legacy unnumbered system-root name (mirrors LEGACY_ROOTS.system in
// workspacePaths.ts, which is not exported) — used to skip the backups folder
// when walking a legacy-layout workspace during a backup.
const LEGACY_SYSTEM_ROOT = ".system";
const AUTO_STATE_FILE = "auto-backup-state.json";
const AUTO_SETTINGS_FILE = "auto-backup-settings.json";
const EXCEL_MAX_ROWS = 1_048_576;
const XLSX_ROWS_PER_PART = 25_000;
const XLSX_CELLS_PER_PART = 250_000;
export const XLSX_MAX_ROWS_PER_DATASET = 100_000;

/**
 * Backup retention policy (A8). Written policy, enforced in code:
 *   - MANUAL backups are kept indefinitely (operator-initiated, deliberate
 *     restore points) — never auto-pruned.
 *   - PRE-RESTORE rollback snapshots are kept indefinitely (safety net for an
 *     in-progress restore) — never auto-pruned.
 *   - AUTOMATIC backups are pruned to the AUTO_BACKUP_RETENTION_COUNT most
 *     recent (by createdAt); older automatic backups are removed after each new
 *     automatic backup succeeds.
 * See `docs/architecture/data-system-report.md` (retention section) for the authoritative doc.
 */
export const AUTO_BACKUP_RETENTION_COUNT = 30;

type DirectoryEntryLike = {
  name: string;
  kind: string;
};

type BackupMode = "manual" | "automatic" | "pre-restore";
export type AutoBackupFrequency = "daily" | "weekly";

export type BackupDatasetSummary = {
  dataset: string;
  monthFolderName: string | null;
  rowCount: number;
  xlsxFiles: string[];
};

export type BackupManifest = {
  createdAt: string;
  createdBy: string;
  mode: BackupMode;
  monthsFolders: string[];
  jsonFilesBackedUp: string[];
  xlsxFilesBackedUp: string[];
  datasets: BackupDatasetSummary[];
  rowLimitPerWorkbookPart: number;
  excelSheetRowLimit: number;
};

export type BackupHistoryItem = {
  folderName: string;
  createdAt: string;
  createdBy: string;
  mode: BackupMode;
  monthsCount: number;
  jsonFilesCount: number;
  xlsxFilesCount: number;
  totalRows: number;
};

export type AutoBackupSettings = {
  frequency: AutoBackupFrequency;
  updatedAt: string;
  updatedBy: string;
};

export type AutoBackupState = {
  lastBackupPeriodKey: string;
  lastBackupAt: string;
  lastBackupFolderName: string;
  lastBackupBy: string;
  frequency: AutoBackupFrequency;
};

type StoredAutoBackupState = AutoBackupState & {
  lastBackupDate?: string;
};

export type MonthArchiveStatus = {
  folderName: string;
  month: number;
  year: number;
  hasManifest: boolean;
  hasPopulation: boolean;
  hasRawRisk: boolean;
  hasRawBi: boolean;
  hasSample: boolean;
  hasDistribution: boolean;
  hasAnswers: boolean;
  manifestStatus: string | null;
  totalProcessedRows: number;
  sampleRows: number;
  distributionRows: number;
  answerFiles: number;
  answerItems: number;
};

type BackupResult =
  | { ok: true; folderName: string; manifest: BackupManifest; xlsxWarning?: string }
  | { ok: false; error: string };

export type CreateBackupOptions = {
  /**
   * Convenience exports are not part of the restorable snapshot. Keep them
   * opt-in so routine and pre-restore backups do not duplicate the entire
   * workspace through SheetJS in browser memory.
   */
  includeXlsxExports?: boolean;
};

export type RestoreResult =
  | { ok: true; restoredFiles: string[]; rollbackFolderName: string }
  | { ok: false; error: string };

function backupFolderName(now: Date, mode: BackupMode): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  // Two machines backing up within the same second would otherwise collide on
  // an identical folder name (one silently overwriting the other's snapshot).
  // A short random base36 suffix keeps concurrent backups distinct.
  const suffix = Math.random().toString(36).slice(2, 6).padStart(4, "0");
  return `${y}-${mo}-${d}T${h}-${m}-${s}-${mode}-${suffix}`;
}

function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function weekKey(date = new Date()): string {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((current.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKey(frequency: AutoBackupFrequency, date = new Date()): string {
  return frequency === "weekly" ? weekKey(date) : todayKey(date);
}

function getDirectoryEntries(dir: DirectoryHandleLike): AsyncIterable<DirectoryEntryLike> | null {
  const directory = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };

  if (typeof directory.values === "function") return directory.values.call(directory);
  if (typeof directory.entries === "function") {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const [, entry] of directory.entries!.call(directory)) {
          yield entry;
        }
      },
    };
  }
  if (typeof directory[Symbol.asyncIterator] === "function") {
    return directory as AsyncIterable<DirectoryEntryLike>;
  }
  return null;
}

async function ensureDir(parent: DirectoryHandleLike, name: string): Promise<DirectoryHandleLike> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function getBackupsDir(directoryHandle: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const systemDir = await getSystemRoot(directoryHandle, true);
  return ensureDir(systemDir, BACKUPS_FOLDER);
}

async function getMonthDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getPopulationMonthDir(directoryHandle, monthFolderName, false);
}

async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<boolean> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) return false;
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
  return true;
}

async function writeBinaryFile(dir: DirectoryHandleLike, fileName: string, content: ArrayBuffer): Promise<void> {
  const fh: FileHandleLike = await dir.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable?.();
  if (!writable) return;
  await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(content);
  await writable.close();
}

async function readTextFile(dir: DirectoryHandleLike, fileName: string): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    return file.text();
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function flattenRecord(value: unknown, prefix = ""): Record<string, unknown> {
  if (value === null || value === undefined) return { [prefix || "value"]: "" };
  if (typeof value !== "object") return { [prefix || "value"]: value };
  if (Array.isArray(value)) return { [prefix || "value"]: JSON.stringify(value) };

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      Object.assign(output, flattenRecord(nested, nextKey));
    } else if (Array.isArray(nested)) {
      output[nextKey] = JSON.stringify(nested);
    } else {
      output[nextKey] = nested ?? "";
    }
  }
  return output;
}

function collectHeaders(rows: Array<Record<string, unknown>>): string[] {
  const headers = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) headers.add(key);
  }
  return Array.from(headers);
}

export function assertXlsxDatasetWithinLimit(dataset: string, rowCount: number): void {
  if (rowCount <= XLSX_MAX_ROWS_PER_DATASET) return;
  throw new Error(
    `تعذر إنشاء ملفات XLSX الاختيارية: مجموعة ${dataset} تحتوي ${rowCount.toLocaleString("ar-SA")} صفاً، `
    + `والحد الآمن هو ${XLSX_MAX_ROWS_PER_DATASET.toLocaleString("ar-SA")}. اكتملت نسخة JSON القابلة للاستعادة.`
  );
}

function rowsToWorksheet(
  rows: Array<Record<string, unknown>>,
  header: string[]
): XLSX.WorkSheet {
  return XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}], { header });
}

async function writeRowsAsChunkedXlsx(params: {
  xlsxDir: DirectoryHandleLike;
  dataset: string;
  monthFolderName: string | null;
  rows: Array<Record<string, unknown>>;
}): Promise<string[]> {
  const { xlsxDir, dataset, monthFolderName, rows } = params;
  if (rows.length === 0) return [];
  assertXlsxDatasetWithinLimit(dataset, rows.length);

  const safeDataset = sanitizeFilePart(dataset);
  const safeMonth = monthFolderName ? sanitizeFilePart(monthFolderName) : "all";
  const files: string[] = [];
  const header = collectHeaders(rows);
  const chunkSize = Math.max(
    1,
    Math.min(
      XLSX_ROWS_PER_PART,
      EXCEL_MAX_ROWS - 1,
      Math.floor(XLSX_CELLS_PER_PART / Math.max(1, header.length))
    )
  );

  for (let start = 0, part = 1; start < rows.length; start += chunkSize, part += 1) {
    const chunk = rows.slice(start, start + chunkSize);
    const workbook = XLSX.utils.book_new();
    const worksheet = rowsToWorksheet(chunk, header);
    XLSX.utils.book_append_sheet(workbook, worksheet, "data");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const fileName = `${safeDataset}-${safeMonth}-part-${String(part).padStart(3, "0")}.xlsx`;
    await writeBinaryFile(xlsxDir, fileName, data);
    files.push(`xlsx/${fileName}`);
  }

  return files;
}

// A backup walks the whole workspace while normal saves run: each safeWriteJson
// creates and then removes a {file}.tmp, mutating a directory mid-enumeration.
// Chromium can then reject a follow-up lookup with NotFoundError. A
// NotReadableError is different: the entry still exists but cannot currently be
// read, so it must propagate rather than silently producing a partial backup.
function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && (error as { name?: string }).name === "NotFoundError"
  );
}

function isMissingWorkspaceLocation(error: unknown): boolean {
  return (
    isNotFoundError(error) ||
    (error instanceof Error && error.message.startsWith("Missing workspace folder:"))
  );
}

async function collectEntries(dir: DirectoryHandleLike): Promise<DirectoryEntryLike[]> {
  const iterable = getDirectoryEntries(dir);
  if (!iterable) return [];
  const entries: DirectoryEntryLike[] = [];
  try {
    for await (const entry of iterable) {
      entries.push({ name: entry.name, kind: entry.kind });
    }
  } catch (error) {
    // Directory changed under us (a concurrent .tmp create/remove). Keep what we
    // gathered rather than failing the backup.
    if (!isNotFoundError(error)) throw error;
  }
  return entries;
}

async function tryGetDirectory(
  dir: DirectoryHandleLike,
  name: string
): Promise<DirectoryHandleLike | null> {
  try {
    return await dir.getDirectoryHandle(name, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function copyJsonTree(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
  copied: string[];
}): Promise<void> {
  for (const entry of await collectEntries(params.sourceDir)) {
    if (entry.kind === "directory") {
      if (
        entry.name === BACKUPS_FOLDER &&
        (params.sourcePath === WORKSPACE_ROOTS.system || params.sourcePath === LEGACY_SYSTEM_ROOT)
      ) {
        continue;
      }
      const sourceChild = await tryGetDirectory(params.sourceDir, entry.name);
      if (!sourceChild) continue;
      const targetChild = await ensureDir(params.targetDir, entry.name);
      await copyJsonTree({
        sourceDir: sourceChild,
        targetDir: targetChild,
        sourcePath: params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name,
        copied: params.copied,
      });
      continue;
    }

    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const text = await readTextFile(params.sourceDir, entry.name);
    if (text === null) continue;
    const wrote = await writeTextFile(params.targetDir, entry.name, text);
    if (wrote) params.copied.push(params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name);
  }
}

async function copyAllJsonFiles(directoryHandle: DirectoryHandleLike, backupDir: DirectoryHandleLike): Promise<string[]> {
  const jsonDir = await ensureDir(backupDir, "json");
  const copied: string[] = [];

  for (const entry of await collectEntries(directoryHandle)) {
    if (entry.kind === "directory") {
      const sourceChild = await tryGetDirectory(directoryHandle, entry.name);
      if (!sourceChild) continue;
      const targetChild = await ensureDir(jsonDir, entry.name);
      await copyJsonTree({
        sourceDir: sourceChild,
        targetDir: targetChild,
        sourcePath: entry.name,
        copied,
      });
      continue;
    }

    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const text = await readTextFile(directoryHandle, entry.name);
    if (text === null) continue;
    const wrote = await writeTextFile(jsonDir, entry.name, text);
    if (wrote) copied.push(entry.name);
  }

  return copied;
}

async function restoreJsonTree(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
  restored: string[];
}): Promise<void> {
  const iterable = getDirectoryEntries(params.sourceDir);
  if (!iterable) return;

  for await (const entry of iterable) {
    if (entry.kind === "directory") {
      const sourceChild = await params.sourceDir.getDirectoryHandle(entry.name, { create: false });
      const targetChild = await ensureDir(params.targetDir, entry.name);
      await restoreJsonTree({
        sourceDir: sourceChild,
        targetDir: targetChild,
        sourcePath: params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name,
        restored: params.restored,
      });
      continue;
    }

    if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
    const text = await readTextFile(params.sourceDir, entry.name);
    if (text === null) continue;
    await safeWriteJsonText(params.targetDir, entry.name, text);
    params.restored.push(params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name);
  }
}

type LocatedJson<T> =
  | { state: "ok"; value: T }
  | { state: "missing" | "corrupt" };

async function readJsonAt<T>(
  baseDir: DirectoryHandleLike,
  path: readonly string[]
): Promise<LocatedJson<T>> {
  try {
    let dir = baseDir;
    for (let index = 0; index < path.length - 1; index += 1) {
      dir = await dir.getDirectoryHandle(path[index]!, { create: false });
    }
    const result = await safeReadJson<T>(dir, path[path.length - 1]!);
    if (result.ok) return { state: "ok", value: result.value };
    return { state: result.reason };
  } catch (error) {
    if (isNotFoundError(error)) return { state: "missing" };
    throw error;
  }
}

async function loadMonthJson<T>(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  path: readonly string[]
): Promise<T | null> {
  const fileName = path[path.length - 1]!;
  const isSampleMainFile =
    path[0] === "sample" ||
    fileName === "distribution.current.json" ||
    fileName === "distribution.log.json";

  if (isSampleMainFile) {
    let current: LocatedJson<T> = { state: "missing" };
    try {
      const sampleMain = await getSampleMainDir(directoryHandle, monthFolderName, false);
      current = await readJsonAt<T>(sampleMain, [fileName]);
    } catch (error) {
      if (!isMissingWorkspaceLocation(error)) throw error;
    }
    if (current.state === "ok") return current.value;
    if (current.state === "corrupt") return null;

    // Compatibility for workspaces created before samples moved to the
    // numbered 2-samples/{month}/1-main root.
    try {
      const legacyMonth = await getMonthDir(directoryHandle, monthFolderName);
      const legacyPath = path[0] === "sample" ? path : [fileName];
      const legacy = await readJsonAt<T>(legacyMonth, legacyPath);
      return legacy.state === "ok" ? legacy.value : null;
    } catch (error) {
      if (isMissingWorkspaceLocation(error)) return null;
      throw error;
    }
  }

  let monthDir: DirectoryHandleLike;
  try {
    monthDir = await getMonthDir(directoryHandle, monthFolderName);
  } catch (error) {
    if (isMissingWorkspaceLocation(error)) return null;
    throw error;
  }
  const current = await readJsonAt<T>(monthDir, path);
  if (current.state === "ok") return current.value;
  if (current.state === "corrupt") return null;

  // The root already supports Population as a legacy alias. These candidates
  // preserve its unnumbered raw/processed children without making new code
  // depend on those obsolete names.
  const legacyFolder =
    path[0] === POPULATION_SUBFOLDERS.raw
      ? "raw"
      : path[0] === POPULATION_SUBFOLDERS.processed
        ? "processed"
        : null;
  if (!legacyFolder) return null;
  const legacy = await readJsonAt<T>(monthDir, [legacyFolder, ...path.slice(1)]);
  return legacy.state === "ok" ? legacy.value : null;
}

function addMonth(row: Record<string, unknown>, month: MonthFolderInfo): Record<string, unknown> {
  return {
    monthFolderName: month.folderName,
    month: month.month,
    year: month.year,
    ...row,
  };
}

function distributionRows(
  current: DistributionCurrentData | null,
  month: MonthFolderInfo
): Array<Record<string, unknown>> {
  return (current?.entries ?? []).map((entry) => ({
    monthFolderName: month.folderName,
    month: month.month,
    year: month.year,
    xrayImageId: entry.xrayImageId,
    assignedTo: entry.assignedTo,
    status: entry.status,
    lastEventAt: entry.lastEventAt,
    ...flattenRecord(entry.row, "sample"),
  }));
}

function answerItemRows(files: EmployeeAnswerFile[], month: MonthFolderInfo): Array<Record<string, unknown>> {
  return files.flatMap((file) =>
    (file.items ?? []).map((item) => ({
      monthFolderName: month.folderName,
      month: month.month,
      year: month.year,
      username: file.username,
      ...flattenRecord(item),
      answers: JSON.stringify(item.answers ?? []),
    }))
  );
}

function answerFieldRows(files: EmployeeAnswerFile[], month: MonthFolderInfo): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const file of files) {
    for (const item of file.items ?? []) {
      for (const answer of item.answers ?? []) {
        rows.push({
          monthFolderName: month.folderName,
          month: month.month,
          year: month.year,
          username: file.username,
          xrayImageId: item.xrayImageId,
          templateId: item.templateId,
          templateVersion: item.templateVersion,
          answeredBy: item.answeredBy,
          itemStatus: item.status,
          submittedAt: item.submittedAt,
          lastSavedAt: item.lastSavedAt,
          fieldId: answer.fieldId,
          value: answer.value ?? "",
        });
      }
    }
  }
  return rows;
}

async function exportMonthXlsx(params: {
  directoryHandle: DirectoryHandleLike;
  xlsxDir: DirectoryHandleLike;
  month: MonthFolderInfo;
}): Promise<BackupDatasetSummary[]> {
  const { directoryHandle, xlsxDir, month } = params;
  const summaries: BackupDatasetSummary[] = [];

  const manifest = await loadMonthJson<MonthManifestData>(directoryHandle, month.folderName, ["month.manifest.json"]);
  const population = await loadMonthJson<PopulationFinalData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.processed, "population.final.json"]);
  assertXlsxDatasetWithinLimit("population-final", population?.rows.length ?? 0);
  const riskRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "risk.raw.json"]);
  assertXlsxDatasetWithinLimit("risk-raw", riskRaw?.rows.length ?? 0);
  const biRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "bi.raw.json"]);
  assertXlsxDatasetWithinLimit("bi-raw", biRaw?.rows.length ?? 0);
  const sample = await loadMonthJson<SampleMasterData>(directoryHandle, month.folderName, ["sample", "sample.master.json"]);
  assertXlsxDatasetWithinLimit("sample-master", sample?.rows.length ?? 0);
  const distribution = await loadMonthJson<DistributionCurrentData>(directoryHandle, month.folderName, ["distribution.current.json"]);
  assertXlsxDatasetWithinLimit("distribution-current", distribution?.entries.length ?? 0);
  const distributionLog = await loadMonthJson<{ events?: unknown[] }>(directoryHandle, month.folderName, ["distribution.log.json"]);
  assertXlsxDatasetWithinLimit("distribution-log", distributionLog?.events?.length ?? 0);
  const employeeFiles = await loadAllEmployeeFiles(directoryHandle, month.folderName);
  const answerItemCount = employeeFiles.reduce((sum, file) => sum + (file.items?.length ?? 0), 0);
  const answerFieldCount = employeeFiles.reduce(
    (sum, file) => sum + (file.items ?? []).reduce(
      (itemSum, item) => itemSum + (item.answers?.length ?? 0),
      0
    ),
    0
  );
  assertXlsxDatasetWithinLimit("employee-answer-items", answerItemCount);
  assertXlsxDatasetWithinLimit("employee-answer-fields", answerFieldCount);

  const datasets: Array<{ name: string; rows: Array<Record<string, unknown>> }> = [
    { name: "manifest", rows: manifest ? [addMonth(flattenRecord(manifest), month)] : [] },
    { name: "population-final", rows: (population?.rows ?? []).map((row) => addMonth(flattenRecord(row), month)) },
    { name: "risk-raw", rows: (riskRaw?.rows ?? []).map((row) => addMonth(flattenRecord(row), month)) },
    { name: "bi-raw", rows: (biRaw?.rows ?? []).map((row) => addMonth(flattenRecord(row), month)) },
    { name: "sample-master", rows: (sample?.rows ?? []).map((row) => addMonth(flattenRecord(row), month)) },
    { name: "distribution-current", rows: distributionRows(distribution, month) },
    { name: "distribution-log", rows: (distributionLog?.events ?? []).map((event) => addMonth(flattenRecord(event), month)) },
    { name: "employee-answer-items", rows: answerItemRows(employeeFiles, month) },
    { name: "employee-answer-fields", rows: answerFieldRows(employeeFiles, month) },
  ];

  for (const dataset of datasets) {
    const xlsxFiles = await writeRowsAsChunkedXlsx({
      xlsxDir,
      dataset: dataset.name,
      monthFolderName: month.folderName,
      rows: dataset.rows,
    });
    summaries.push({
      dataset: dataset.name,
      monthFolderName: month.folderName,
      rowCount: dataset.rows.length,
      xlsxFiles,
    });
  }

  return summaries;
}

async function exportTemplatesXlsx(
  directoryHandle: DirectoryHandleLike,
  xlsxDir: DirectoryHandleLike
): Promise<BackupDatasetSummary[]> {
  try {
    const templatesDir = await getTemplatesRoot(directoryHandle, false);
    const iterable = getDirectoryEntries(templatesDir);
    if (!iterable) return [];
    const rows: Array<Record<string, unknown>> = [];

    for await (const entry of iterable) {
      if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
      const result = await safeReadJson<unknown>(templatesDir, entry.name);
      if (result.ok) {
        rows.push({ fileName: entry.name, ...flattenRecord(result.value) });
      }
    }

    const xlsxFiles = await writeRowsAsChunkedXlsx({
      xlsxDir,
      dataset: "templates",
      monthFolderName: null,
      rows,
    });
    return [{ dataset: "templates", monthFolderName: null, rowCount: rows.length, xlsxFiles }];
  } catch {
    return [];
  }
}

/**
 * Prune automatic backups beyond AUTO_BACKUP_RETENTION_COUNT most recent (A8).
 * Manual and pre-restore backups are never touched. Best-effort: any failure is
 * logged and swallowed so a prune problem never blocks or fails a backup.
 * Returns the folder names removed (empty when nothing was pruned).
 */
export async function pruneAutoBackups(
  directoryHandle: DirectoryHandleLike
): Promise<string[]> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    if (!backupsDir.removeEntry) return [];

    const autos: Array<{ folderName: string; createdAt: number }> = [];
    for (const entry of await collectEntries(backupsDir)) {
      if (entry.kind !== "directory") continue;
      const backupDir = await tryGetDirectory(backupsDir, entry.name);
      if (!backupDir) continue;
      const manifestResult = await safeReadJson<BackupManifest>(backupDir, "backup.manifest.json");
      if (!manifestResult.ok) continue;
      if (manifestResult.value.mode !== "automatic") continue; // keep manual + pre-restore
      autos.push({
        folderName: entry.name,
        createdAt: Date.parse(manifestResult.value.createdAt) || 0,
      });
    }

    if (autos.length <= AUTO_BACKUP_RETENTION_COUNT) return [];

    // Newest first; everything past the retention count is stale.
    autos.sort((a, b) => b.createdAt - a.createdAt);
    const stale = autos.slice(AUTO_BACKUP_RETENTION_COUNT);
    const removed: string[] = [];
    for (const item of stale) {
      try {
        await backupsDir.removeEntry(item.folderName, { recursive: true });
        removed.push(item.folderName);
      } catch (error) {
        logError("backup:prune-remove", error);
      }
    }
    return removed;
  } catch (error) {
    logError("backup:prune", error);
    return [];
  }
}

export async function createBackup(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[],
  username: string,
  mode: BackupMode = "manual",
  options: CreateBackupOptions = {}
): Promise<BackupResult> {
  try {
    const now = new Date();
    const folderName = backupFolderName(now, mode);
    const backupsDir = await getBackupsDir(directoryHandle);
    const backupDir = await ensureDir(backupsDir, folderName);

    // Best-effort: capture a fresh labels-override snapshot before walking
    // the tree, so it is included by copyAllJsonFiles below (Tier-1 Item F).
    await exportLabelsSnapshot(directoryHandle);

    const jsonFilesBackedUp = await copyAllJsonFiles(directoryHandle, backupDir);
    const datasets: BackupDatasetSummary[] = [];
    let xlsxWarning: string | undefined;

    if (options.includeXlsxExports) {
      try {
        const xlsxDir = await ensureDir(backupDir, "xlsx");
        for (const month of months) {
          datasets.push(...await exportMonthXlsx({ directoryHandle, xlsxDir, month }));
        }
        datasets.push(...await exportTemplatesXlsx(directoryHandle, xlsxDir));
      } catch (error) {
        xlsxWarning = error instanceof Error
          ? error.message
          : "تعذر إنشاء ملفات XLSX الاختيارية. اكتملت نسخة JSON القابلة للاستعادة.";
      }
    }

    const xlsxFilesBackedUp = datasets.flatMap((dataset) => dataset.xlsxFiles);
    const manifest: BackupManifest = {
      createdAt: now.toISOString(),
      createdBy: username,
      mode,
      monthsFolders: months.map((month) => month.folderName),
      jsonFilesBackedUp,
      xlsxFilesBackedUp,
      datasets,
      rowLimitPerWorkbookPart: XLSX_ROWS_PER_PART,
      excelSheetRowLimit: EXCEL_MAX_ROWS,
    };

    await safeWriteJson(backupDir, "backup.manifest.json", manifest);
    if (mode === "automatic") {
      const settings = await loadAutoBackupSettings(directoryHandle);
      await safeWriteJson<AutoBackupState>(backupsDir, AUTO_STATE_FILE, {
        lastBackupPeriodKey: periodKey(settings.frequency, now),
        lastBackupAt: now.toISOString(),
        lastBackupFolderName: folderName,
        lastBackupBy: username,
        frequency: settings.frequency,
      });
      // A8 retention: prune automatic backups beyond the retention count. Runs
      // only after a fresh automatic backup so manual restores never trigger it.
      await pruneAutoBackups(directoryHandle);
    }

    return { ok: true, folderName, manifest, xlsxWarning };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function createDailyAdminBackupIfDue(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[],
  username: string
): Promise<BackupResult | { ok: true; skipped: true; reason: string; state: AutoBackupState | null }> {
  const backupsDir = await getBackupsDir(directoryHandle);
  const settings = await loadAutoBackupSettings(directoryHandle);
  const stateResult = await safeReadJson<StoredAutoBackupState>(backupsDir, AUTO_STATE_FILE);
  const state = stateResult.ok ? normalizeAutoBackupState(stateResult.value) : null;
  if (state?.frequency === settings.frequency && state.lastBackupPeriodKey === periodKey(settings.frequency)) {
    return { ok: true, skipped: true, reason: "already-backed-up-today", state };
  }
  return createBackup(directoryHandle, months, username, "automatic");
}

export async function loadAutoBackupSettings(
  directoryHandle: DirectoryHandleLike
): Promise<AutoBackupSettings> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    const result = await safeReadJson<AutoBackupSettings>(backupsDir, AUTO_SETTINGS_FILE);
    if (result.ok && (result.value.frequency === "daily" || result.value.frequency === "weekly")) {
      return result.value;
    }
  } catch {
    // fall through to default
  }
  return {
    frequency: "daily",
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system",
  };
}

export async function saveAutoBackupSettings(
  directoryHandle: DirectoryHandleLike,
  frequency: AutoBackupFrequency,
  username: string
): Promise<{ ok: true; settings: AutoBackupSettings } | { ok: false; error: string }> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    const settings: AutoBackupSettings = {
      frequency,
      updatedAt: new Date().toISOString(),
      updatedBy: username,
    };
    await safeWriteJson(backupsDir, AUTO_SETTINGS_FILE, settings);
    return { ok: true, settings };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function restoreBackupSnapshot(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
}): Promise<RestoreResult> {
  try {
    const backupsDir = await getBackupsDir(params.directoryHandle);
    const sourceBackupDir = await backupsDir.getDirectoryHandle(params.backupFolderName, { create: false });
    const jsonDir = await sourceBackupDir.getDirectoryHandle("json", { create: false });
    const rollback = await createBackup(params.directoryHandle, params.months, params.username, "pre-restore");
    if (!rollback.ok) {
      return { ok: false, error: `تعذر إنشاء نسخة الرجوع قبل الاستعادة: ${rollback.error}` };
    }

    const restored: string[] = [];
    await restoreJsonTree({
      sourceDir: jsonDir,
      targetDir: params.directoryHandle,
      sourcePath: "",
      restored,
    });

    return { ok: true, restoredFiles: restored, rollbackFolderName: rollback.folderName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function loadAutoBackupState(
  directoryHandle: DirectoryHandleLike
): Promise<AutoBackupState | null> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    const result = await safeReadJson<StoredAutoBackupState>(backupsDir, AUTO_STATE_FILE);
    return result.ok ? normalizeAutoBackupState(result.value) : null;
  } catch {
    return null;
  }
}

function normalizeAutoBackupState(state: StoredAutoBackupState): AutoBackupState {
  const frequency = state.frequency === "weekly" ? "weekly" : "daily";
  return {
    lastBackupPeriodKey: state.lastBackupPeriodKey ?? state.lastBackupDate ?? "",
    lastBackupAt: state.lastBackupAt,
    lastBackupFolderName: state.lastBackupFolderName,
    lastBackupBy: state.lastBackupBy,
    frequency,
  };
}

export async function loadBackupHistory(
  directoryHandle: DirectoryHandleLike
): Promise<BackupHistoryItem[]> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    const iterable = getDirectoryEntries(backupsDir);
    if (!iterable) return [];
    const history: BackupHistoryItem[] = [];

    for await (const entry of iterable) {
      if (entry.kind !== "directory") continue;
      const backupDir = await backupsDir.getDirectoryHandle(entry.name, { create: false });
      const manifestResult = await safeReadJson<BackupManifest>(backupDir, "backup.manifest.json");
      if (!manifestResult.ok) continue;
      const manifest = manifestResult.value;
      history.push({
        folderName: entry.name,
        createdAt: manifest.createdAt,
        createdBy: manifest.createdBy,
        mode: manifest.mode ?? "manual",
        monthsCount: manifest.monthsFolders?.length ?? 0,
        jsonFilesCount: manifest.jsonFilesBackedUp?.length ?? 0,
        xlsxFilesCount: manifest.xlsxFilesBackedUp?.length ?? 0,
        totalRows: (manifest.datasets ?? []).reduce((sum, dataset) => sum + dataset.rowCount, 0),
      });
    }

    return history.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export async function loadArchiveStatus(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[]
): Promise<MonthArchiveStatus[]> {
  const statuses: MonthArchiveStatus[] = [];

  for (const month of months) {
    const manifest = await loadMonthJson<MonthManifestData>(directoryHandle, month.folderName, ["month.manifest.json"]);
    const population = await loadMonthJson<PopulationFinalData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.processed, "population.final.json"]);
    const riskRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "risk.raw.json"]);
    const biRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "bi.raw.json"]);
    const sample = await loadMonthJson<SampleMasterData>(directoryHandle, month.folderName, ["sample", "sample.master.json"]);
    const distribution = await loadMonthJson<DistributionCurrentData>(directoryHandle, month.folderName, ["distribution.current.json"]);
    const answerFiles = await loadAllEmployeeFiles(directoryHandle, month.folderName);
    const answerItems = answerFiles.reduce((sum, file) => sum + (file.items?.length ?? 0), 0);

    statuses.push({
      folderName: month.folderName,
      month: month.month,
      year: month.year,
      hasManifest: Boolean(manifest),
      hasPopulation: Boolean(population),
      hasRawRisk: Boolean(riskRaw),
      hasRawBi: Boolean(biRaw),
      hasSample: Boolean(sample),
      hasDistribution: Boolean(distribution),
      hasAnswers: answerFiles.length > 0,
      manifestStatus: manifest?.status ?? null,
      totalProcessedRows: population?.totalRows ?? manifest?.totalProcessedRows ?? 0,
      sampleRows: sample?.rows?.length ?? 0,
      distributionRows: distribution?.entries?.length ?? 0,
      answerFiles: answerFiles.length,
      answerItems,
    });
  }

  return statuses;
}
