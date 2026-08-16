import * as XLSX from "xlsx";

import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { loadAllEmployeeFiles } from "../answers/answerStorage";
import {
  DISTRIBUTION_EVENTS_DIR,
  DISTRIBUTION_EVENT_SEGMENT_SUFFIX,
  mergeDistributionEvents,
} from "../distribution/distributionEventStore";
import { DISTRIBUTION_CHECKPOINT_FILE, loadDistributionLog } from "../distribution/distributionStorage";
import type { DistributionCurrentData, DistributionEvent } from "../distribution/distributionTypes";
import type { MonthFolderInfo } from "../population/monthFolder";
import type { MonthManifestData, MonthRawData, PopulationFinalData } from "../population/monthTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { EMPLOYEE_MIRROR_INDEX_FILE, EMPLOYEE_MIRROR_SUFFIX } from "../samples/sampleMirrorStorage";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import {
  copyFileBytes,
  isCompressedFileText,
  readFileTextWithRetry,
  safeReadJson,
  safeWriteJson,
  safeWriteJsonText,
} from "../storage/safeWrite";
import { mapWithConcurrency } from "../storage/concurrency";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
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
// Sentinel (new — no "write-before, remove-after" precedent exists elsewhere
// in this codebase yet): written directly under 5-system/ (not inside any one
// backup folder) since it marks the WHOLE WORKSPACE as mid-restore, not a
// single backup's own content. See restoreBackupSnapshot for the write/remove
// sequencing and why this is what makes an interrupted restore detectable.
const RESTORE_INPROGRESS_FILE = "restore.inprogress.json";
// Sentinel (new): lives alongside backup.manifest.json inside a single backup
// folder. backup.manifest.json is already, informally, written last today and
// already treated by loadBackupHistory/pruneAutoBackups as "this backup
// doesn't count if missing/unreadable" — this is an explicit, additional,
// purpose-built signal alongside that existing informal one, not a
// replacement for it.
const BACKUP_COMPLETE_FILE = "backup.complete.json";
/** Derived, rebuildable fold cache — never restored, and dropped when its events change under it. */
const DISTRIBUTION_CURRENT_FILE = "distribution.current.json";
// `DISTRIBUTION_CHECKPOINT_FILE` (imported from distributionStorage) is the
// sidecar of the file above (v85): the fold checkpoint that used to be embedded
// in it. Classified identically — derived, never restored, and dropped whenever
// a restore rewrites the segments its byte offsets point into. Getting that
// wrong is silent EVENT LOSS, not a stale-looking screen: a checkpoint left
// behind after a merge grew a segment claims those bytes were already folded,
// so the incremental reader skips straight past the real events in between.
/** Legacy full-event compatibility projection — restored only into a workspace that has none. */
const DISTRIBUTION_LOG_FILE = "distribution.log.json";
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
  /** Pre-aggregated from DistributionCurrentData.totalCompleted (P2-1) — no extra file read. */
  distributionCompleted: number;
  /** Pre-aggregated from DistributionCurrentData.totalPending (P2-1) — no extra file read. */
  distributionPending: number;
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

async function writeBinaryFile(dir: DirectoryHandleLike, fileName: string, content: ArrayBuffer): Promise<boolean> {
  const fh: FileHandleLike = await dir.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable?.();
  if (!writable) return false;
  await (writable as unknown as { write: (data: unknown) => Promise<void> }).write(content);
  await writable.close();
  return true;
}

// Delegates to safeWrite.ts's readFileTextWithRetry so this walk gets the
// same short, bounded NotReadableError retry safeReadJson already has (see
// that function's doc comment for why: a transient "could not be read" is
// expected background noise while the workspace is live, and got materially
// more likely to be hit once the walk below went from 1 concurrent file read
// to 8). A missing file still resolves to null; an exhausted retry (or any
// other error) still throws and must propagate — see isNotFoundError's
// comment below for why a NotReadableError must not be silently swallowed.
async function readTextFile(dir: DirectoryHandleLike, fileName: string): Promise<string | null> {
  return readFileTextWithRetry(dir, fileName);
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
    `تعذر إنشاء ملفات XLSX الاختيارية: مجموعة ${dataset} تحتوي ${rowCount.toLocaleString("ar-SA-u-nu-latn")} صفاً، `
    + `والحد الآمن هو ${XLSX_MAX_ROWS_PER_DATASET.toLocaleString("ar-SA-u-nu-latn")}. اكتملت نسخة JSON القابلة للاستعادة.`
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
    // Only record a chunk as backed up once it actually wrote (writeBinaryFile
    // returns false when the handle has no createWritable, e.g. a read-only
    // FileHandleLike) — otherwise the manifest's xlsxFilesBackedUp/datasets would
    // claim a file exists that was silently skipped.
    const wrote = await writeBinaryFile(xlsxDir, fileName, data);
    if (wrote) files.push(`xlsx/${fileName}`);
  }

  return files;
}

// A backup walks the whole workspace while normal saves run: each safeWriteJson
// creates and then removes a {file}.tmp, mutating a directory mid-enumeration.
// Chromium can then reject a follow-up lookup with NotFoundError. A
// NotReadableError is different: the entry still exists but cannot currently be
// read. readTextFile (above) now retries a transient NotReadableError with the
// same bounded backoff safeReadJson uses (via safeWrite.ts's
// readFileTextWithRetry) before giving up — but once that retry is exhausted,
// it must still propagate rather than silently producing a partial backup.
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

/**
 * The workspace file families that belong in a restorable snapshot.
 *
 * Both the backup walk and the restore walk gate on this ONE predicate, so the
 * two can never drift into capturing a family that cannot be put back.
 *
 * Why `.ndjson` needs its own clause rather than being caught by a looser
 * "contains .json" test: `"x.ndjson".endsWith(".json")` is FALSE — the char
 * before `json` is `d`, not `.`. That is precisely how every distribution event
 * segment silently escaped both walks. A substring test would have "fixed" it by
 * also sweeping in `.json.bak` / `.json.tmp` / `.ndjson.bak` — safeWrite's
 * rollback and staging siblings, which are deliberately NOT snapshot payload:
 * restoring a stale `.bak` over a good file is exactly the corruption the safe
 * write layer exists to prevent. Suffix equality keeps all three excluded.
 */
function isSnapshotPayloadFile(name: string): boolean {
  return name.endsWith(".json") || isSegmentFile(name);
}

/** An append-only distribution event segment — never rewritten, never deleted. */
function isSegmentFile(name: string): boolean {
  return name.endsWith(DISTRIBUTION_EVENT_SEGMENT_SUFFIX);
}

/** Local NDJSON codec — distributionEventStore's own is module-private. */
function parseSegmentLines(text: string, segmentName: string): DistributionEvent[] {
  const events: DistributionEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as DistributionEvent);
    } catch {
      throw new Error(`Cannot parse distribution event segment: ${segmentName}`);
    }
  }
  return events;
}

function encodeSegmentLines(events: DistributionEvent[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

async function fileExists(dir: DirectoryHandleLike, fileName: string): Promise<boolean> {
  try {
    await dir.getFileHandle(fileName, { create: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
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

type PendingJsonCopy = {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  fileName: string;
  relativePath: string;
};

// Recursively walks sourceDir and returns a FLAT list of every .json file to
// copy (creating the mirrored target directory structure as it goes) instead
// of copying eagerly as it walks. Each directory's listing is already fully
// materialized by collectEntries before this function descends into it (see
// collectEntries above), so — unlike Task 4's restore walk — this has no
// live-async-iterator hazard; it is safe to let the whole tree walk finish
// before any file is actually copied.
//
// That's deliberate: it lets copyAllJsonFiles hand the ENTIRE tree to ONE
// mapWithConcurrency(..., 8, ...) call below, rather than one call per
// directory level. The plan explicitly flagged per-directory semaphores as a
// hazard — concurrent recursive calls would each open their own pool of up
// to 8 workers, so two sibling directories walked "at once" could drive real
// concurrency to 8 x 8 = 64 in-flight file operations instead of 8. This
// function itself does no I/O concurrently (ensureDir/collectEntries calls
// are cheap relative to a full read+write round trip), so flattening first
// keeps the budget honest regardless of how deep or wide the tree is.
async function collectJsonFileEntries(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
}): Promise<PendingJsonCopy[]> {
  const pending: PendingJsonCopy[] = [];

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
      const nested = await collectJsonFileEntries({
        sourceDir: sourceChild,
        targetDir: targetChild,
        sourcePath: params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name,
      });
      pending.push(...nested);
      continue;
    }

    if (entry.kind !== "file" || !isSnapshotPayloadFile(entry.name)) continue;
    pending.push({
      sourceDir: params.sourceDir,
      targetDir: params.targetDir,
      fileName: entry.name,
      relativePath: params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name,
    });
  }

  return pending;
}

async function copyAllJsonFiles(directoryHandle: DirectoryHandleLike, backupDir: DirectoryHandleLike): Promise<string[]> {
  const jsonDir = await ensureDir(backupDir, "json");
  const pending = await collectJsonFileEntries({
    sourceDir: directoryHandle,
    targetDir: jsonDir,
    sourcePath: "",
  });

  // Index-addressed via mapWithConcurrency (budget 8; no locks involved on
  // this path) so jsonFilesBackedUp keeps the walk's listing order — and
  // therefore a deterministic manifest — even though the 8 workers below
  // finish their individual read+write round trips in whatever order the
  // underlying I/O actually completes. A null result marks an entry that was
  // listed but turned out not to be copyable (source disappeared mid-walk,
  // or the target handle had no createWritable) and is filtered out below,
  // exactly as the old .push()-only-on-success code did.
  const results = await mapWithConcurrency(pending, 8, async (entry) => {
    const text = await readTextFile(entry.sourceDir, entry.fileName);
    // A compressed workspace file is copied as BYTES. Its name is identical to a
    // plain one's (the format lives in the file's first line, not its
    // extension), so this is where the two are told apart on the backup walk —
    // reading a gzip member as text and writing it back would silently corrupt
    // the snapshot. Recognized from the text ALREADY read (the head line decodes
    // losslessly even when the body does not), so this costs no extra I/O and
    // still goes through readTextFile's transient-error retry.
    if (isCompressedFileText(text)) {
      await copyFileBytes(entry.sourceDir, entry.fileName, entry.targetDir, entry.fileName);
      return entry.relativePath;
    }
    if (text === null) {
      // A last-write-wins JSON file that vanishes between the listing and the
      // read is expected churn on a live workspace (safeWriteJson's .tmp
      // appears and disappears constantly), and dropping it is recoverable —
      // the next backup catches it. An event SEGMENT is different: it is
      // append-only and never deleted, so it cannot legitimately disappear
      // mid-walk, and silently omitting one drops events that exist nowhere
      // else in the snapshot while the manifest still reports a clean backup.
      // Fail the whole backup instead; assertBackupComplete then refuses the
      // partial folder at restore time rather than folding a truncated history
      // into the live log.
      if (isSegmentFile(entry.fileName)) {
        throw new Error(`تعذّرت قراءة سجل أحداث التوزيع أثناء النسخ الاحتياطي: ${entry.relativePath}`);
      }
      return null;
    }
    const wrote = await writeTextFile(entry.targetDir, entry.fileName, text);
    if (!wrote && isSegmentFile(entry.fileName)) {
      throw new Error(`تعذّرت كتابة سجل أحداث التوزيع أثناء النسخ الاحتياطي: ${entry.relativePath}`);
    }
    return wrote ? entry.relativePath : null;
  });

  return results.filter((path): path is string => path !== null);
}

/**
 * How one backed-up file is put back. A backup snapshot is NOT uniformly
 * last-write-wins: the distribution log is event-sourced, and three of its file
 * families need semantics that a blind overwrite would get wrong.
 *
 *  - `replace` — the long-standing behavior, and still correct for every
 *    last-write-wins file (population, samples, templates, answers, users…).
 *  - `merge-events` — `*.ndjson` event segments. Segments are append-only and
 *    immutable per writer session, so the backup's copy and the live copy are
 *    both prefixes of the same truth, and either may hold events the other
 *    lacks: the backup carries events deleted/truncated since it was taken, the
 *    live file carries everything appended after. Overwriting would destroy the
 *    newer events; skipping would fail to repair the older ones. Only a union
 *    can lose neither, so the two sides are merged by `eventId`.
 *  - `restore-if-absent` — `distribution.log.json`, the legacy full-event
 *    compatibility projection. It is CAS-protected and monotonically revisioned,
 *    so writing the backup's older revision over a newer live one both rolls the
 *    revision backwards and drops events. Every event it holds is also durable in
 *    the event segments / per-event files, which ARE restored, so leaving a live
 *    projection alone loses nothing — while restoring it into a workspace that
 *    has none still covers full disaster recovery.
 *  - `skip-derived` — `distribution.current.json` and its v85 sidecar
 *    `distribution.checkpoint.json`, both documented as rebuildable cache.
 *    Restoring either is never necessary and is actively dangerous: the
 *    checkpoint is a map of per-segment BYTE OFFSETS meaning "already folded up
 *    to here", and a merge above may have rewritten those very segments. See
 *    invalidateDistributionCaches.
 *
 *    Also `skip-derived` (P6, 2026-08): every per-employee sample mirror
 *    (`{username}.samples.json`, `EMPLOYEE_MIRROR_SUFFIX`) and its side-index
 *    (`_index.json`, `EMPLOYEE_MIRROR_INDEX_FILE`) — both under
 *    `2-samples/{month}/2-employees/`. These are the same kind of rewritten-
 *    whole projection as `distribution.current.json`, derived from the event
 *    log by `syncSampleMirrors`, and carry their own revision guard
 *    (`sourceLogRevision`) that a raw file-copy restore does not respect: a
 *    restore could put back a mirror that is now OLDER than the live event
 *    log (which restores via `merge-events` above and can therefore end up
 *    newer than any mirror snapshot taken before it), silently serving stale
 *    per-employee assignment data until the next `saveDistributionCurrent`
 *    regenerates it. Leaving them alone costs nothing recoverable — every
 *    mirror is a pure projection of `distribution.current.json`, itself
 *    always rebuilt from the (correctly merged) event log.
 */
type RestoreAction = "replace" | "merge-events" | "restore-if-absent" | "skip-derived";

function restoreActionFor(fileName: string): RestoreAction {
  if (fileName.endsWith(DISTRIBUTION_EVENT_SEGMENT_SUFFIX)) return "merge-events";
  if (fileName === DISTRIBUTION_CURRENT_FILE || fileName === DISTRIBUTION_CHECKPOINT_FILE) return "skip-derived";
  // Suffix/exact match, not substring: EMPLOYEE_MIRROR_SUFFIX (".samples.json")
  // only ever appears as a filename's own tail (the per-user prefix is
  // dynamic), and EMPLOYEE_MIRROR_INDEX_FILE ("_index.json") is compared for
  // exact equality — deliberately narrow so this can never accidentally sweep
  // in an unrelated "*index*.json" file elsewhere in the tree.
  if (fileName.endsWith(EMPLOYEE_MIRROR_SUFFIX) || fileName === EMPLOYEE_MIRROR_INDEX_FILE) return "skip-derived";
  if (fileName === DISTRIBUTION_LOG_FILE) return "restore-if-absent";
  return "replace";
}

type PendingJsonRestore = {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  fileName: string;
  relativePath: string;
  action: RestoreAction;
  /**
   * For `merge-events` entries only: the target directory holding the
   * `distribution.current.json` derived from these segments — i.e. the PARENT of
   * `distribution.events/`, not the segment's own directory. Carried down from
   * the walk because the flat pending list has no other way back up the tree.
   */
  cacheDir: DirectoryHandleLike | null;
};

// Mirrors collectJsonFileEntries's two-phase shape above (see its comment):
// a non-concurrent flattening pass that walks the WHOLE source tree into one
// ordered list (creating the mirrored target directory structure as it goes),
// so restoreJsonTree below never has to hold a live async iterator open across
// a concurrent await. Each directory's listing is materialized via
// collectEntries (inheriting its NotFoundError tolerance for a directory that
// changes mid-enumeration), and — like the copy side — this deliberately
// stays a single flat list rather than one mapWithConcurrency pool per
// directory level, so nested recursion here can never multiply the caller's
// concurrency budget.
//
// Unlike the backup-side collectJsonFileEntries, a missing subdirectory here
// is NOT silently tolerated the same way (F1): the backup side walks a live,
// mutating workspace where a directory disappearing mid-enumeration is
// expected, but the restore side walks an already-completed, immutable
// backup snapshot — a missing subdirectory there means something is
// genuinely wrong (e.g. a concurrent pruneAutoBackups/sync client touched the
// backup folder mid-restore). tryGetDirectory returning null is therefore
// recorded as a skipped path (surfaced up to the caller) instead of just
// `continue`d past, so the caller can detect and report a partial restore
// rather than silently reporting full success.
async function collectJsonRestoreEntries(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
  /** Inherited from the parent of a `distribution.events/` directory; null everywhere else. */
  cacheDir: DirectoryHandleLike | null;
}): Promise<{ pending: PendingJsonRestore[]; skippedPaths: string[] }> {
  const pending: PendingJsonRestore[] = [];
  const skippedPaths: string[] = [];

  for (const entry of await collectEntries(params.sourceDir)) {
    if (entry.kind === "directory") {
      const relativePath = params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name;
      const sourceChild = await tryGetDirectory(params.sourceDir, entry.name);
      if (!sourceChild) {
        skippedPaths.push(relativePath);
        continue;
      }
      const targetChild = await ensureDir(params.targetDir, entry.name);
      const nested = await collectJsonRestoreEntries({
        sourceDir: sourceChild,
        targetDir: targetChild,
        sourcePath: relativePath,
        // Descending INTO distribution.events/ is the moment the current
        // directory becomes "the place the fold cache for these segments
        // lives" — capture it here, since the flat pending list below cannot
        // walk back up to it later.
        cacheDir: entry.name === DISTRIBUTION_EVENTS_DIR ? params.targetDir : params.cacheDir,
      });
      pending.push(...nested.pending);
      skippedPaths.push(...nested.skippedPaths);
      continue;
    }

    if (entry.kind !== "file" || !isSnapshotPayloadFile(entry.name)) continue;
    const action = restoreActionFor(entry.name);
    // Dropped at collection time rather than in the executor: a derived cache is
    // not a restore that "failed", so it must not reach the pending list at all
    // and must never be reported as either restored or skipped.
    if (action === "skip-derived") continue;
    pending.push({
      sourceDir: params.sourceDir,
      targetDir: params.targetDir,
      fileName: entry.name,
      relativePath: params.sourcePath ? `${params.sourcePath}/${entry.name}` : entry.name,
      action,
      cacheDir: params.cacheDir,
    });
  }

  return { pending, skippedPaths };
}

/**
 * Union the backup's copy of one event segment with the live one, keyed by
 * `eventId`. Returns whether the live file actually changed.
 *
 * `mergeDistributionEvents` is the codebase's existing dedupe/merge primitive —
 * deliberately reused rather than reimplemented. Passing the LIVE side first
 * keeps the live file's own line order as the base and appends only ids the live
 * file lacks. It throws when one id carries conflicting content on the two
 * sides, which is a genuine integrity contradiction (two different events minted
 * under one id) and must surface as a failed restore rather than a silent pick.
 */
async function mergeEventSegment(
  targetDir: DirectoryHandleLike,
  fileName: string,
  backupText: string
): Promise<boolean> {
  const backupEvents = parseSegmentLines(backupText, fileName);
  const liveText = await readTextFile(targetDir, fileName);
  const liveEvents = liveText === null ? [] : parseSegmentLines(liveText, fileName);

  const merged = mergeDistributionEvents(liveEvents, backupEvents);
  // The backup added nothing this segment did not already hold — leave the bytes
  // (and therefore any fold checkpoint keyed on this segment's size) untouched.
  if (liveText !== null && merged.length === liveEvents.length) return false;

  const text = encodeSegmentLines(merged);
  if (!(await writeTextFile(targetDir, fileName, text))) return false;
  // Same reasoning as the append path's post-close size check: on a UNC/SMB
  // share a close() that returned can still have landed short, and a truncated
  // segment is silent event loss.
  const readBack = await readTextFile(targetDir, fileName);
  if (readBack !== text) {
    throw new Error(`Distribution event segment restore verification failed: ${fileName}`);
  }
  return true;
}

/**
 * Drop the fold cache for every directory whose segments the restore rewrote.
 *
 * `distribution.checkpoint.json` is a `segmentOffsets` map of per-segment BYTE
 * offsets meaning "already folded up to here" (before v85 it was embedded in
 * `distribution.current.json`, and legacy cache files still carry it inline —
 * which is why BOTH names are deleted here, not just the new one). A merge above
 * can grow a segment and shift where its lines sit, which would leave those
 * offsets pointing into the middle of a line — the incremental reader would then
 * either mis-parse or skip real events, with a cache that claims to be current.
 * Deleting both costs one full re-derive on the next load and is the only state
 * in which the cache cannot be newer than the events behind it.
 *
 * Best-effort per file, mirroring pruneAutoBackups: a cache that cannot be
 * removed must not fail an otherwise-complete restore, and its absence is
 * always recoverable.
 */
async function invalidateDistributionCaches(dirs: Iterable<DirectoryHandleLike>): Promise<void> {
  for (const dir of dirs) {
    if (!dir.removeEntry) continue;
    for (const name of [
      DISTRIBUTION_CURRENT_FILE,
      `${DISTRIBUTION_CURRENT_FILE}.bak`,
      `${DISTRIBUTION_CURRENT_FILE}.tmp`,
      DISTRIBUTION_CHECKPOINT_FILE,
      `${DISTRIBUTION_CHECKPOINT_FILE}.bak`,
      `${DISTRIBUTION_CHECKPOINT_FILE}.tmp`,
    ]) {
      try {
        await dir.removeEntry(name);
      } catch (error) {
        if (!isNotFoundError(error)) logError("backup:restore-cache-invalidate", error);
      }
    }
  }
}

// Was previously a live `for await (const entry of iterable)` walk directly
// over getDirectoryEntries(sourceDir), restoring each file inline as the walk
// visited it (including recursing into subdirectories mid-loop). Holding a
// live async iterator open across concurrent awaits is unsafe, so this now
// materializes the whole tree first via collectJsonRestoreEntries (no
// concurrency, see its comment), THEN fans the flat, ordered list out with a
// SINGLE top-level mapWithConcurrency call.
//
// Budget 4: each write takes a Web Lock via safeWriteJsonText, keyed per
// `${targetDir.name}/${fileName}` — restoring distinct filenames into
// distinct directories means these locks essentially never contend with each
// other. The budget caps concurrent Web Lock acquisitions/handles, it is not
// there to prevent lock contention.
async function restoreJsonTree(params: {
  sourceDir: DirectoryHandleLike;
  targetDir: DirectoryHandleLike;
  sourcePath: string;
  restored: string[];
  /** Mirrors `restored`'s out-param calling convention: the caller passes an
   *  array in, this function pushes into it. Populated from
   *  collectJsonRestoreEntries' skippedPaths (F1) — a subdirectory that could
   *  not be reached during the restore walk. */
  skipped: string[];
}): Promise<void> {
  const { pending, skippedPaths } = await collectJsonRestoreEntries({
    sourceDir: params.sourceDir,
    targetDir: params.targetDir,
    sourcePath: params.sourcePath,
    cacheDir: null,
  });
  params.skipped.push(...skippedPaths);

  // Index-addressed via mapWithConcurrency so params.restored keeps the walk's
  // listing order — and therefore a deterministic restoredFiles list — even
  // though the workers below finish their individual read+write round trips in
  // whatever order the underlying I/O actually completes. A null result marks
  // an entry that was listed but whose source text disappeared before it could
  // be read (source changed mid-walk), or one this restore deliberately left
  // alone, and is filtered out below.
  const results = await mapWithConcurrency(pending, 4, async (entry) => {
    const text = await readTextFile(entry.sourceDir, entry.fileName);
    // Mirror of the backup side: a compressed snapshot file goes back as bytes.
    // The restored file keeps the same NAME as the plain one it replaces, so a
    // compressed and a plain copy of one logical file can never coexist — the
    // byte copy overwrites the target whole, whichever format it held.
    if (isCompressedFileText(text)) {
      if (entry.action === "restore-if-absent" && (await fileExists(entry.targetDir, entry.fileName))) {
        return null;
      }
      // `merge-events` never reaches here: event segments are `.ndjson`,
      // append-only, and never written through the compressing path.
      await copyFileBytes(entry.sourceDir, entry.fileName, entry.targetDir, entry.fileName);
      return { path: entry.relativePath, cacheDir: null };
    }
    if (text === null) {
      // Mirror of the backup side: the restore source is an already-completed,
      // immutable snapshot, so a segment listed there but unreadable is a real
      // fault, not churn — and skipping it would silently under-restore the
      // event history while still reporting success.
      if (isSegmentFile(entry.fileName)) {
        throw new Error(`تعذّرت قراءة سجل أحداث التوزيع من النسخة الاحتياطية: ${entry.relativePath}`);
      }
      return null;
    }

    if (entry.action === "merge-events") {
      const changed = await mergeEventSegment(entry.targetDir, entry.fileName, text);
      // Only a segment that actually gained lines invalidates the fold cache —
      // a no-op restore must not cost every month a full re-derive.
      return changed ? { path: entry.relativePath, cacheDir: entry.cacheDir } : null;
    }

    if (entry.action === "restore-if-absent" && (await fileExists(entry.targetDir, entry.fileName))) {
      return null;
    }

    await safeWriteJsonText(entry.targetDir, entry.fileName, text);
    return { path: entry.relativePath, cacheDir: null };
  });

  const applied = results.filter((result): result is { path: string; cacheDir: DirectoryHandleLike | null } => result !== null);
  params.restored.push(...applied.map((result) => result.path));

  // Handle identity is stable per directory across one walk (collectJsonRestoreEntries
  // hands every entry in a directory the same handle object), so a Set dedupes
  // to one invalidation per month rather than one per segment.
  const cacheDirs = new Set<DirectoryHandleLike>();
  for (const result of applied) {
    if (result.cacheDir) cacheDirs.add(result.cacheDir);
  }
  await invalidateDistributionCaches(cacheDirs);
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
  // B3 perf: population.final.json can hold the entire month's population (tens
  // of thousands of rows, potentially tens of MB). Reject an oversized dataset
  // using the manifest's cheap totalProcessedRows BEFORE paying to load+parse
  // the full file. The assert below still re-checks the ACTUAL loaded row count,
  // so a stale/hand-edited manifest can never let an oversized workbook through —
  // this is purely a fast pre-check, not a replacement for the real guard.
  if (manifest) {
    assertXlsxDatasetWithinLimit("population-final", manifest.totalProcessedRows);
  }
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
  // Read through the distribution loader rather than off `distribution.log.json`
  // directly: since v85 that file is a CAS stamp whose event body is normally
  // EMPTY (the events live in the immutable `distribution.events/` segments), so
  // reading the raw file would silently export zero rows for every modern
  // workspace. The loader merges projection + segments + legacy per-event files,
  // which is what this dataset always meant to say.
  const distributionLogEvents = (await loadDistributionLog(directoryHandle, month.folderName)).events;
  assertXlsxDatasetWithinLimit("distribution-log", distributionLogEvents.length);
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
    { name: "distribution-log", rows: distributionLogEvents.map((event) => addMonth(flattenRecord(event), month)) },
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
    // A remembered workspace (PR #36) opens with read permission only — request
    // write access here, before the backup folder is created, instead of letting
    // a raw NotAllowedError surface from deep inside ensureDir/writeBinaryFile.
    return await withWorkspaceWriteAccess(directoryHandle, async () => {
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

      // Sentinel: written LAST among this backup folder's own content writes
      // (after the json copy walk, the optional xlsx export, and the manifest
      // itself), so its presence means backupDir was fully, successfully
      // written. Deliberately precedes the automatic-mode bookkeeping below
      // (AUTO_STATE_FILE, pruneAutoBackups) — those touch the PARENT backups
      // directory and a best-effort "which backup ran last" pointer, not this
      // backup folder's own content, so a failure there must not retroactively
      // make an otherwise-complete backup look unfinished.
      await safeWriteJson(backupDir, BACKUP_COMPLETE_FILE, {
        completedAt: now.toISOString(),
      });

      if (mode === "automatic") {
        const settings = await loadAutoBackupSettings(directoryHandle);
        // casLoop EXEMPTION (documented, not routed): AUTO_STATE_FILE is a
        // derived "which backup ran last" pointer, not authoritative data — the
        // real record is the immutable backup folder + backup.manifest.json this
        // function just wrote above, which is never overwritten. Two machines
        // racing an automatic backup at the same moment can only clobber which
        // of their (both already-persisted) backups this pointer references;
        // no backup is ever lost, mirroring how distribution.current.json is
        // documented as a rebuildable cache rather than a CAS-protected source
        // of truth. Not worth a revision/_writeToken schema addition for a
        // last-write-wins status cache.
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
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function createDailyAdminBackupIfDue(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[],
  username: string
): Promise<BackupResult | { ok: true; skipped: true; reason: string; state: AutoBackupState | null }> {
  try {
    const backupsDir = await getBackupsDir(directoryHandle);
    const settings = await loadAutoBackupSettings(directoryHandle);
    const stateResult = await safeReadJson<StoredAutoBackupState>(backupsDir, AUTO_STATE_FILE);
    const state = stateResult.ok ? normalizeAutoBackupState(stateResult.value) : null;
    if (state?.frequency === settings.frequency && state.lastBackupPeriodKey === periodKey(settings.frequency)) {
      return { ok: true, skipped: true, reason: "already-backed-up-today", state };
    }
  } catch (error) {
    // A freshly-restored remembered workspace (PR #36) may still be read-only
    // at this point — resolve with a clean failure instead of rejecting just to
    // answer "is a backup due"; createBackup below is the operation that
    // actually needs (and correctly requests) write access.
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
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

// casLoop EXEMPTION (documented, not routed): this is a whole-object overwrite
// of a single admin-chosen scalar (frequency), not a read-modify-write merge of
// independent fields — there is no partial update a concurrent writer could
// clobber. A race between two admins just means the later save wins outright,
// which is normal last-admin-wins settings semantics, not a lost update. Adding
// a revision/_writeToken pair (schema change) buys nothing here.
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

/**
 * Refuse to restore from a backup folder that was never finished.
 *
 * Both signals are written only after the whole copy walk has succeeded —
 * `backup.manifest.json` last among the content writes, `backup.complete.json`
 * immediately after it — so either one missing means the backup stopped partway
 * and its `json/` tree is a partial view of the workspace.
 *
 * This is deliberately a hard refusal rather than a warning. Backups created
 * before the completion sentinel existed (pre-2026-08-04) are therefore no
 * longer restorable through this path; their `json/` tree can still be copied
 * back by hand. That trade is taken knowingly: the alternative is accepting a
 * snapshot that cannot be distinguished from a complete one, which under
 * merge-events semantics would fold a truncated event history into the live log.
 */
async function assertBackupComplete(
  backupDir: DirectoryHandleLike,
  folderName: string
): Promise<void> {
  const manifest = await safeReadJson<BackupManifest>(backupDir, "backup.manifest.json");
  if (!manifest.ok) {
    throw new Error(
      `النسخة الاحتياطية "${folderName}" غير مكتملة: ملف backup.manifest.json مفقود أو تالف، `
      + `ما يعني أن عملية النسخ توقفت قبل نهايتها. تعذّرت الاستعادة منها.`
    );
  }
  if (!(await fileExists(backupDir, BACKUP_COMPLETE_FILE))) {
    throw new Error(
      `النسخة الاحتياطية "${folderName}" غير مكتملة: علامة الاكتمال backup.complete.json مفقودة. `
      + `تعذّرت الاستعادة منها.`
    );
  }
}

export async function restoreBackupSnapshot(params: {
  directoryHandle: DirectoryHandleLike;
  months: MonthFolderInfo[];
  backupFolderName: string;
  username: string;
}): Promise<RestoreResult> {
  try {
    // Restoring is the highest-stakes write in the app (it overwrites the live
    // workspace) — re-check write access up front rather than discovering the
    // gap partway through the pre-restore rollback backup or the tree restore.
    return await withWorkspaceWriteAccess(params.directoryHandle, async () => {
      const backupsDir = await getBackupsDir(params.directoryHandle);
      const sourceBackupDir = await backupsDir.getDirectoryHandle(params.backupFolderName, { create: false });
      // Before ANY mutation — no rollback backup, no sentinel, no walk. An
      // interrupted backup restores a tree that merely looks whole, and with
      // merge-events semantics a truncated segment set would be quietly merged
      // in as if it were the full history.
      await assertBackupComplete(sourceBackupDir, params.backupFolderName);
      const jsonDir = await sourceBackupDir.getDirectoryHandle("json", { create: false });
      const rollback = await createBackup(params.directoryHandle, params.months, params.username, "pre-restore");
      if (!rollback.ok) {
        return { ok: false, error: `تعذر إنشاء نسخة الرجوع قبل الاستعادة: ${rollback.error}` };
      }

      // Sentinel (new, no prior precedent elsewhere in this codebase): written
      // BEFORE the destructive restore walk starts, removed only once that
      // walk has completed successfully. If restoreJsonTree throws partway
      // through, this file is deliberately left behind — do NOT wrap the
      // removal in a `finally`. Its continued presence is what makes an
      // interrupted restore detectable on a later check, since the walk
      // itself has no other way to report "I stopped halfway" once its
      // rejection has already unwound past this function.
      const systemDir = await getSystemRoot(params.directoryHandle, true);
      await safeWriteJson(systemDir, RESTORE_INPROGRESS_FILE, {
        startedAt: new Date().toISOString(),
        startedBy: params.username,
      });

      const restored: string[] = [];
      const skipped: string[] = [];
      await restoreJsonTree({
        sourceDir: jsonDir,
        targetDir: params.directoryHandle,
        sourcePath: "",
        restored,
        skipped,
      });

      // F1: a subdirectory that collectJsonRestoreEntries could not reach
      // while walking an already-completed, immutable backup snapshot means
      // that subtree was silently dropped from the restore — this is a
      // partial restore, not a success. Leave RESTORE_INPROGRESS_FILE in
      // place (same "deliberately left behind on failure" contract as the
      // comment above its write documents) instead of removing it, and
      // report failure instead of `{ ok: true, ... }`.
      if (skipped.length > 0) {
        return {
          ok: false,
          error: `اكتملت الاستعادة جزئياً فقط: تعذر الوصول إلى ${skipped.length} مجلد فرعي داخل نسخة النسخ الاحتياطي أثناء الاستعادة.`,
        };
      }

      // F2: guard/wrap the sentinel removal the same way pruneAutoBackups
      // guards its own removeEntry calls above — removeEntry is optional on
      // DirectoryHandleLike, and a throw here must not turn an otherwise
      // successful restore into a reported failure (it would be caught by
      // this function's own outer catch below). Only reachable once
      // skipped.length === 0.
      if (systemDir.removeEntry) {
        try {
          await systemDir.removeEntry(RESTORE_INPROGRESS_FILE);
        } catch (error) {
          logError("backup:restore-sentinel-remove", error);
        }
      }

      return { ok: true, restoredFiles: restored, rollbackFolderName: rollback.folderName };
    });
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

// B3 perf: true once population processing has definitely completed — i.e. the
// manifest's status (or, for a closed month, its statusBeforeClose) is past
// "raw-saved". population.final.json is written in the SAME synchronous save as
// this manifest (populationStorage.saveMonthRun writes the file, then the
// manifest, in one un-interrupted flow whose errors propagate), so once that
// stage is reached the manifest's own totalProcessedRows is a trustworthy count
// — unlike manifestStatus's "sampled"/"distributed" advances, which go through
// the separately-scheduled, best-effort updateMonthStatus() and so can legitimately
// lag behind the real sample/distribution files. Defaults to "not reached" for any
// manifest shape we can't confidently read (missing statusBeforeClose on a closed
// month, etc.) so the caller falls back to the real file read instead of guessing.
function populationStageReached(manifest: MonthManifestData | null): boolean {
  if (!manifest) return false;
  const effectiveStatus =
    manifest.status === "closed" ? manifest.statusBeforeClose ?? "raw-saved" : manifest.status;
  return effectiveStatus !== "raw-saved";
}

/**
 * Whether the month holds any distribution EVENT files at all — `*.ndjson`
 * segments or the legacy per-event `*.json` files.
 *
 * `distribution.current.json` alone is not an honest answer to "does this month
 * have a distribution": it is a rebuildable cache, so it can be absent while a
 * complete event history exists — after a restore invalidates it, on a machine
 * that has never folded the month, or if it was cleared by hand. Reporting
 * "no distribution" there would tell an operator their assignments are gone at
 * exactly the moment they are checking whether a restore worked.
 *
 * Only a directory LISTING, and only reached when the cache is already absent,
 * so the common path pays nothing. Row counts above stay cache-derived (they
 * would need a full fold) and read 0 until the month is next loaded.
 */
async function hasDistributionEventFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<boolean> {
  try {
    const mainDir = await getSampleMainDir(directoryHandle, monthFolderName, false);
    const eventsDir = await tryGetDirectory(mainDir, DISTRIBUTION_EVENTS_DIR);
    if (!eventsDir) return false;
    return (await collectEntries(eventsDir)).some(
      (entry) => entry.kind === "file" && isSnapshotPayloadFile(entry.name)
    );
  } catch (error) {
    if (isMissingWorkspaceLocation(error)) return false;
    throw error;
  }
}

export async function loadArchiveStatus(
  directoryHandle: DirectoryHandleLike,
  months: MonthFolderInfo[]
): Promise<MonthArchiveStatus[]> {
  // F4 (documentation only, no behavior change): each of these 4 concurrent
  // month-workers calls loadAllEmployeeFiles below, which itself goes through
  // readJsonDirectory -> readNamedJsonFiles (src/data/storage/directoryScan.ts),
  // whose own internal pool defaults to DIRECTORY_READ_CONCURRENCY = 8. So the
  // effective peak concurrent file reads this function can drive is 4 x 8 = 32,
  // not the 4 a reader would assume from this call alone. Read-only, so no
  // integrity risk — the plan's scope did not budget for capping nested pools,
  // so the values are left as-is; this is just making the multiplication explicit.
  return mapWithConcurrency(months, 4, async (month) => {
    const manifest = await loadMonthJson<MonthManifestData>(directoryHandle, month.folderName, ["month.manifest.json"]);

    // Prefer the manifest's own totalProcessedRows/status for the population
    // tile instead of loading and parsing the full population.final.json (by far
    // the largest per-month file — see populationStageReached above for why the
    // manifest can be trusted here). Any manifest we can't confidently read this
    // way falls back to the original full read, so accuracy never regresses.
    let hasPopulation: boolean;
    let totalProcessedRows: number;
    if (populationStageReached(manifest) && typeof manifest?.totalProcessedRows === "number") {
      hasPopulation = true;
      totalProcessedRows = manifest.totalProcessedRows;
    } else {
      const population = await loadMonthJson<PopulationFinalData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.processed, "population.final.json"]);
      hasPopulation = Boolean(population);
      totalProcessedRows = population?.totalRows ?? manifest?.totalProcessedRows ?? 0;
    }

    const riskRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "risk.raw.json"]);
    const biRaw = await loadMonthJson<MonthRawData>(directoryHandle, month.folderName, [POPULATION_SUBFOLDERS.raw, "bi.raw.json"]);
    // NOTE (scope): sample.master.json / distribution.current.json are NOT given
    // the same manifest-only shortcut. Their manifestStatus advance ("sampled" /
    // "distributed") runs through updateMonthStatus(), which is explicitly
    // best-effort and can silently fail to persist even though the underlying
    // file write already succeeded (see its doc comment in populationStorage.ts) —
    // trusting status here could make the archive tiles LESS truthful, not more,
    // for the one class of drift this bucket exists to fix. They also have no
    // manifest-cached row count to shortcut to, unlike totalProcessedRows above.
    const sample = await loadMonthJson<SampleMasterData>(directoryHandle, month.folderName, ["sample", "sample.master.json"]);
    const distribution = await loadMonthJson<DistributionCurrentData>(directoryHandle, month.folderName, ["distribution.current.json"]);
    const answerFiles = await loadAllEmployeeFiles(directoryHandle, month.folderName);
    const answerItems = answerFiles.reduce((sum, file) => sum + (file.items?.length ?? 0), 0);

    return {
      folderName: month.folderName,
      month: month.month,
      year: month.year,
      hasManifest: Boolean(manifest),
      hasPopulation,
      hasRawRisk: Boolean(riskRaw),
      hasRawBi: Boolean(biRaw),
      hasSample: Boolean(sample),
      // Short-circuits: the listing is only paid for when the derived cache is
      // absent, which is the only case where the cache alone would lie.
      hasDistribution:
        Boolean(distribution) || (await hasDistributionEventFiles(directoryHandle, month.folderName)),
      hasAnswers: answerFiles.length > 0,
      manifestStatus: manifest?.status ?? null,
      totalProcessedRows,
      sampleRows: sample?.rows?.length ?? 0,
      distributionRows: distribution?.entries?.length ?? 0,
      // Already-loaded distribution above carries its own pre-aggregated totals
      // (deriveCurrentDistribution computes them once per fold) — no new file
      // read needed to surface them here (P2-1).
      distributionCompleted: distribution?.totalCompleted ?? 0,
      distributionPending: distribution?.totalPending ?? 0,
      answerFiles: answerFiles.length,
      answerItems,
    };
  });
}
