/**
 * Admin «دمج شهر»: moves everything a month folder holds — sample rows, their
 * distribution events, every employee's answers, and the population rows —
 * into another month, then archives and removes the source. An ad-hoc import's
 * synthetic `adhoc-{id}` folder has the same layout (no population), so the
 * same engine moves an ad-hoc sample into a real month; its import record is
 * archived alongside.
 *
 * Order matters and makes a re-run safe after a partial failure:
 *  1. sample rows (target sample must exist) — duplicates skipped;
 *  2. distribution events, by eventId, only for rows this transfer owns;
 *  3. answers through `upsertItemAnswer` (final state, not the raw history);
 *  4. population rows;
 *  5. only when 1–4 all succeeded: archive copy, then delete the source.
 * A row already in the target counts as a DUPLICATE unless one of the source's
 * events for it is already in the target — that is this transfer's own earlier
 * partial run, which is resumed instead.
 *
 * Pending referral/replacement/reopen requests are not moved: they stay in the
 * archived copy and are counted in the plan so the admin sees them first.
 */
import { loadAllEmployeeFiles, loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { loadAdhocRecord, deleteAdhocImportRecord } from "../adhocImport/adhocImportStorage";
import { appendDistributionEvents, loadDistributionLog, refreshDistributionCacheAfterWrite } from "../distribution/distributionStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { deleteMonth } from "../population/deleteMonth";
import { invalidateMonthLockCache, isMonthClosed } from "../population/monthLock";
import { appendPopulationFinalRows, loadMonthPopulationFinal } from "../population/populationStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { appendSampleRows, loadSampleMaster } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { safeWriteJson } from "../storage/safeWrite";
import { getSystemRoot, invalidateWorkspaceDirCache } from "../workspace/workspacePaths";
import { ARCHIVED_MONTHS_DIR, archiveMonthFolders } from "./archiveMonthFolders";

const ADHOC_PREFIX = "adhoc-";
const EVENT_CHUNK = 400;

export type MonthTransferRefusal =
  | "same-month"
  | "source-empty"
  | "target-no-sample"
  | "source-closed"
  | "target-closed";

export type MonthTransferPlan = {
  sourceMonth: string;
  targetMonth: string;
  sourceIsAdhoc: boolean;
  /** Rows that will move (resumed rows included). */
  rows: PreparedPopulationRow[];
  retiredIds: string[];
  /** Ids skipped because the target already holds them. */
  duplicates: string[];
  events: DistributionEvent[];
  answers: Array<{ username: string; items: ItemAnswer[] }>;
  answerCount: number;
  /** Every answer in the source, duplicates included — the count the archive keeps. */
  sourceAnswerCount: number;
  populationRows: Array<Record<string, unknown>>;
  pendingRequestCount: number;
};

export type MonthTransferPlanResult = { ok: true; plan: MonthTransferPlan } | { ok: false; reason: MonthTransferRefusal };

export function isAdhocMonthFolder(monthFolderName: string): boolean {
  return monthFolderName.startsWith(ADHOC_PREFIX);
}

async function closed(directoryHandle: DirectoryHandleLike, month: string): Promise<boolean> {
  if (isAdhocMonthFolder(month)) return false;
  try {
    return await isMonthClosed(directoryHandle, month);
  } catch {
    return false;
  }
}

/** Reads both months and works out exactly what a transfer would move. Writes nothing. */
export async function planMonthTransfer(
  directoryHandle: DirectoryHandleLike,
  sourceMonth: string,
  targetMonth: string
): Promise<MonthTransferPlanResult> {
  if (sourceMonth === targetMonth) return { ok: false, reason: "same-month" };
  invalidateMonthLockCache();
  if (await closed(directoryHandle, sourceMonth)) return { ok: false, reason: "source-closed" };
  if (await closed(directoryHandle, targetMonth)) return { ok: false, reason: "target-closed" };

  const [sourceSample, targetSample] = await Promise.all([
    loadSampleMaster(directoryHandle, sourceMonth),
    loadSampleMaster(directoryHandle, targetMonth),
  ]);
  if (!targetSample) return { ok: false, reason: "target-no-sample" };
  const sourcePopulation = isAdhocMonthFolder(sourceMonth) ? null : await loadMonthPopulationFinal(directoryHandle, sourceMonth);
  if (!sourceSample && !sourcePopulation) return { ok: false, reason: "source-empty" };

  const [sourceLog, targetLog, sourceFiles] = await Promise.all([
    sourceSample ? loadDistributionLog(directoryHandle, sourceMonth) : null,
    loadDistributionLog(directoryHandle, targetMonth),
    sourceSample ? loadAllEmployeeFiles(directoryHandle, sourceMonth, { strict: true }) : Promise.resolve([]),
  ]);
  const sourceEvents = sourceLog?.events ?? [];
  const targetEventIds = new Set(targetLog.events.map((event) => event.eventId));
  const targetIds = new Set(targetSample.rows.map((row) => row.xrayImageId));

  const resumed = new Set<string>();
  for (const event of sourceEvents) {
    if (targetEventIds.has(event.eventId)) resumed.add(event.xrayImageId);
  }
  const rows: PreparedPopulationRow[] = [];
  const duplicates: string[] = [];
  for (const row of sourceSample?.rows ?? []) {
    if (targetIds.has(row.xrayImageId) && !resumed.has(row.xrayImageId)) duplicates.push(row.xrayImageId);
    else rows.push(row);
  }
  const moving = new Set(rows.map((row) => row.xrayImageId));
  const events = sourceEvents.filter((event) => moving.has(event.xrayImageId) && !targetEventIds.has(event.eventId));
  const answers = sourceFiles
    .map((file) => ({ username: file.username, items: file.items.filter((item) => moving.has(item.xrayImageId)) }))
    .filter((entry) => entry.items.length > 0);
  const pendingRequestCount = sourceFiles.reduce(
    (sum, file) =>
      sum +
      (file.referralRequests?.length ?? 0) +
      (file.replacementRequests?.length ?? 0) +
      (file.reopenRequests?.length ?? 0),
    0
  );

  return {
    ok: true,
    plan: {
      sourceMonth,
      targetMonth,
      sourceIsAdhoc: isAdhocMonthFolder(sourceMonth),
      rows,
      retiredIds: (sourceSample?.replacedRowIds ?? []).filter((id) => moving.has(id)),
      duplicates,
      events,
      answers,
      answerCount: answers.reduce((sum, entry) => sum + entry.items.length, 0),
      sourceAnswerCount: sourceFiles.reduce((sum, file) => sum + file.items.length, 0),
      populationRows: sourcePopulation?.rows ?? [],
      pendingRequestCount,
    },
  };
}

export type MonthTransferResult =
  | {
      ok: true;
      movedRows: number;
      movedEvents: number;
      movedAnswers: number;
      movedPopulationRows: number;
      duplicates: string[];
      archiveName: string;
    }
  | { ok: false; reason: MonthTransferRefusal }
  | { ok: false; reason: "write-failed"; error: string; sourceKept: true };

function sameAnswer(a: ItemAnswer, b: ItemAnswer): boolean {
  return a.status === b.status && a.lastSavedAt === b.lastSavedAt && a.submittedAt === b.submittedAt;
}

/** Runs the transfer. Re-plans from disk first, so what is written always matches the current state. */
export async function executeMonthTransfer(
  directoryHandle: DirectoryHandleLike,
  sourceMonth: string,
  targetMonth: string,
  actor: string
): Promise<MonthTransferResult> {
  const planned = await planMonthTransfer(directoryHandle, sourceMonth, targetMonth);
  if (!planned.ok) return planned;
  const { plan } = planned;
  const fail = (error: string): MonthTransferResult => ({ ok: false, reason: "write-failed", error, sourceKept: true });

  // 1. sample rows
  const sample = await appendSampleRows(directoryHandle, targetMonth, plan.rows, plan.retiredIds);
  if (!sample.ok) return fail(sample.error);

  // 2. distribution events
  for (let start = 0; start < plan.events.length; start += EVENT_CHUNK) {
    const appended = await appendDistributionEvents(directoryHandle, targetMonth, plan.events.slice(start, start + EVENT_CHUNK));
    if (!appended.ok) return fail(appended.error);
  }

  // 3. answers — skip an item the target already holds in the same state (a resumed run)
  let movedAnswers = 0;
  for (const entry of plan.answers) {
    const existing = await loadEmployeeAnswers(directoryHandle, targetMonth, entry.username);
    const have = new Map(existing.items.map((item) => [item.xrayImageId, item]));
    for (const item of entry.items) {
      const prior = have.get(item.xrayImageId);
      if (prior && sameAnswer(prior, item)) continue;
      const written = await upsertItemAnswer(directoryHandle, targetMonth, entry.username, item);
      if (!written.ok) return fail(written.error);
      movedAnswers += 1;
    }
  }

  // 4. population
  let movedPopulationRows = 0;
  if (plan.populationRows.length > 0) {
    const population = await appendPopulationFinalRows(directoryHandle, targetMonth, plan.populationRows, actor);
    if (population.status === "appended") movedPopulationRows = population.appended;
  }

  await refreshDistributionCacheAfterWrite(directoryHandle, targetMonth, sample.data.rows);
  bumpWorkspaceEpoch(directoryHandle, targetMonth);

  // 5. archive, then remove the source
  let archiveName: string;
  try {
    archiveName = (await archiveMonthFolders(directoryHandle, sourceMonth)).archiveName;
    if (plan.sourceIsAdhoc) await archiveAdhocRecord(directoryHandle, sourceMonth.slice(ADHOC_PREFIX.length), archiveName);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const removed = await deleteMonth(directoryHandle, sourceMonth, Number.MAX_SAFE_INTEGER);
  if (!removed.ok && removed.reason !== "not-found") return fail(`source removal refused: ${removed.reason}`);
  if (plan.sourceIsAdhoc) await deleteAdhocImportRecord(directoryHandle, sourceMonth.slice(ADHOC_PREFIX.length));
  invalidateWorkspaceDirCache(directoryHandle);

  return {
    ok: true,
    movedRows: sample.appended.length,
    movedEvents: plan.events.length,
    movedAnswers,
    movedPopulationRows,
    duplicates: plan.duplicates,
    archiveName,
  };
}

async function archiveAdhocRecord(directoryHandle: DirectoryHandleLike, importId: string, archiveName: string): Promise<void> {
  const record = await loadAdhocRecord(directoryHandle, importId);
  if (!record) return;
  const system = await getSystemRoot(directoryHandle, true);
  const dir = await (await system.getDirectoryHandle(ARCHIVED_MONTHS_DIR, { create: true }))
    .getDirectoryHandle(archiveName, { create: true });
  await safeWriteJson(dir, "adhoc-import.record.json", record);
}
