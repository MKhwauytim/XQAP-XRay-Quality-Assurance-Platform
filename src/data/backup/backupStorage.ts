import * as XLSX from "xlsx";

import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { MonthFolderInfo } from "../population/monthFolder";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "../population/monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import {
  getPopulationMonthDir,
  getSampleMainDir,
  getSystemRoot,
  getTemplatesRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

const BACKUPS_FOLDER = "3-Backups";
const AUTO_STATE_FILE = "auto-backup-state.json";
const AUTO_SETTINGS_FILE = "auto-backup-settings.json";
const EXCEL_MAX_ROWS = 1_048_576;
const XLSX_ROWS_PER_PART = 250_000;

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
  | { ok: true; folderName: string; manifest: BackupManifest }
  | { ok: false; error: string };

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
  return `${y}-${mo}-${d}T${h}-${m}-${s}-${mode}`;
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

async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) return;
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
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
  } catch {
    return null;
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

function rowsToWorksheet(rows: Array<Record<string, unknown>>): XLSX.WorkSheet {
  const header = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
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

  const safeDataset = sanitizeFilePart(dataset);
  const safeMonth = monthFolderName ? sanitizeFilePart(monthFolderName) : "all";
  const files: string[] = [];
  const chunkSize = Math.min(XLSX_ROWS_PER_PART, EXCEL_MAX_ROWS - 1);

  for (let start = 0, part = 1; start < rows.length; start += chunkSize, part += 1) {
    const chunk = rows.slice(start, start + chunkSize);
    const workbook = XLSX.utils.book_new();
    const worksheet = rowsToWorksheet(chunk);
    XLSX.utils.book_append_sheet(workbook, worksheet, "data");
    const data = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const fileName = `${safeDataset}-${safeMonth}-part-${String(part).padStart(3, "0")}.xlsx`;
    await writeBinaryFile(xlsxDir, fileName, data);
    files.push(`xlsx/${fileName}`);
  }

  return files;
}

async function copyJsonTree(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
  copied: string[];
}): Promise<void> {
  const iterable = getDirectoryEntries(params.sourceDir);
  if (!iterable) return;

  for await (const entry of iterable) {
    if (entry.kind === "directory") {
      if (params.sourcePath === WORKSPACE_ROOTS.system && entry.name === BACKUPS_FOLDER) {
        continue;
      }
      const sourceChild = await params.sourceDir.getDirectoryHandle(entry.name, { create: false });
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
    await writeTextFile(params.targetDir, entry.name, text);
    params.copied.push(params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name);
  }
}

async function copyAllJsonFiles(directoryHandle: DirectoryHandleLike, backupDir: DirectoryHandleLike): Promise<string[]> {
  const jsonDir = await ensureDir(backupDir, "json");
  const copied: string[] = [];
  const iterable = getDirectoryEntries(directoryHandle);
  if (!iterable) return copied;

  for await (const entry of iterable) {
    if (entry.kind === "directory") {
      const sourceChild = await directoryHandle.getDirectoryHandle(entry.name, { create: false });
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
    await writeTextFile(jsonDir, entry.name, text);
    copied.push(entry.name);
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
    await writeTextFile(params.targetDir, entry.name, text);
    params.restored.push(params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name);
  }
}

async function loadMonthJson<T>(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  path: string[]
): Promise<T | null> {
  try {
    const fileName = path[path.length - 1]!;
    const isSampleMainFile =
      path[0] === "sample" ||
      fileName === "distribution.current.json" ||
      fileName === "distribution.log.json";

    let dir = isSampleMainFile
      ? await getSampleMainDir(directoryHandle, monthFolderName, false)
      : await getMonthDir(directoryHandle, monthFolderName);
    const pathStart = isSampleMainFile && path[0] === "sample" ? 1 : 0;
    for (let index = pathStart; index < path.length - 1; index += 1) {
      dir = await dir.getDirectoryHandle(path[index]!, { create: false });
    }
    const result = await safeReadJson<T>(dir, fileName);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
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
  const population = await loadMonthJson<PopulationFinalData>(directoryHandle, month.folderName, ["processed", "population.final.json"]);
  const riskRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, ["raw", "risk.raw.json"]);
  const biRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, ["raw", "bi.raw.json"]);
  const sample = await loadMonthJson<SampleMasterData>(directoryHandle, month.folderName, ["sample", "sample.master.json"]);
  const distribution = await loadMonthJson<DistributionCurrentData>(directoryHandle, month.folderName, ["distribution.current.json"]);
  const distributionLog = await loadMonthJson<{ events?: unknown[] }>(directoryHandle, month.folderName, ["distribution.log.json"]);
  const employeeFiles = await loadAllEmployeeFiles(directoryHandle, month.folderName);

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

export async function createBackup(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[],
  username: string,
  mode: BackupMode = "manual"
): Promise<BackupResult> {
  try {
    const now = new Date();
    const folderName = backupFolderName(now, mode);
    const backupsDir = await getBackupsDir(directoryHandle);
    const backupDir = await ensureDir(backupsDir, folderName);
    const xlsxDir = await ensureDir(backupDir, "xlsx");

    const jsonFilesBackedUp = await copyAllJsonFiles(directoryHandle, backupDir);
    const datasets: BackupDatasetSummary[] = [];

    for (const month of months) {
      datasets.push(...await exportMonthXlsx({ directoryHandle, xlsxDir, month }));
    }
    datasets.push(...await exportTemplatesXlsx(directoryHandle, xlsxDir));

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
    }

    return { ok: true, folderName, manifest };
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
    const population = await loadMonthJson<PopulationFinalData>(directoryHandle, month.folderName, ["processed", "population.final.json"]);
    const riskRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, ["raw", "risk.raw.json"]);
    const biRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, ["raw", "bi.raw.json"]);
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
