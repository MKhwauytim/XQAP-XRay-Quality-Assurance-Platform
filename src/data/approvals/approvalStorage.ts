import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import type { DecisionEvent, DecisionEventKind, SupervisorDecisionFile } from "./approvalTypes";
import { getPopulationMonthDir, getSampleApprovalsDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";

type DirectoryEntryLike = { name: string; kind: string };

function getDirectoryEntries(dir: DirectoryHandleLike): AsyncIterable<DirectoryEntryLike> | null {
  const d = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };
  if (typeof d.values === "function") return d.values.call(d);
  if (typeof d.entries === "function") {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const [, entry] of d.entries!.call(d)) yield entry;
      },
    };
  }
  if (typeof d[Symbol.asyncIterator] === "function") return d as AsyncIterable<DirectoryEntryLike>;
  return null;
}

async function getApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  return getSampleApprovalsDir(directoryHandle, monthFolderName, true);
}

async function getLegacyApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DirectoryHandleLike> {
  const monthDir = await getPopulationMonthDir(directoryHandle, monthFolderName, false);
  return monthDir.getDirectoryHandle("approvals", { create: false });
}

function decisionFileName(supervisorUsername: string): string {
  return `${safeWorkspaceFilePart(supervisorUsername)}.decisions.json`;
}

export async function loadSupervisorDecisions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string
): Promise<SupervisorDecisionFile> {
  try {
    const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
    const r = await safeReadJson<SupervisorDecisionFile>(appDir, decisionFileName(supervisorUsername));
    if (r.ok) return r.value;
  } catch { /* file may not exist yet */ }
  try {
    const legacyDir = await getLegacyApprovalsDir(directoryHandle, monthFolderName);
    const r = await safeReadJson<SupervisorDecisionFile>(legacyDir, decisionFileName(supervisorUsername));
    if (r.ok) return r.value;
  } catch { /* legacy file may not exist */ }
  return {
    supervisorUsername,
    monthFolderName,
    referralDecisions: [],
    replacementDecisions: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

/** Read all supervisor decision files for the month (for admin/supervisor aggregation). */
export async function loadAllSupervisorDecisions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<SupervisorDecisionFile[]> {
  try {
    const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
    const results: SupervisorDecisionFile[] = [];
    const iterable = getDirectoryEntries(appDir);
    if (!iterable) return results;
    for await (const entry of iterable) {
      if (entry.kind !== "file" || !entry.name.endsWith(".decisions.json")) continue;
      const r = await safeReadJson<SupervisorDecisionFile>(appDir, entry.name);
      if (r.ok) results.push(r.value);
    }
    return results;
  } catch {
    return [];
  }
}

export async function appendDecisionEvent(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string,
  event: DecisionEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
    const current = await loadSupervisorDecisions(directoryHandle, monthFolderName, supervisorUsername);
    const updated: SupervisorDecisionFile = {
      ...current,
      decisionEvents: [...(current.decisionEvents ?? []), event],
      lastUpdatedAt: new Date().toISOString(),
    };
    await safeWriteJson(appDir, decisionFileName(supervisorUsername), updated);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "خطأ غير معروف." };
  }
}

/** Combine decision events for one request from every supervisor's file, including
 *  legacy (pre-history) decisions read as single-event history. Sorted oldest → newest. */
export function mergeDecisionHistory(
  files: SupervisorDecisionFile[],
  kind: DecisionEventKind,
  requestId: string
): DecisionEvent[] {
  const events: DecisionEvent[] = [];
  for (const file of files) {
    for (const event of file.decisionEvents ?? []) {
      if (event.kind === kind && event.requestId === requestId) events.push(event);
    }
    const legacy = kind === "referral" ? file.referralDecisions : file.replacementDecisions;
    for (const decision of legacy) {
      if (decision.requestId !== requestId) continue;
      events.push({
        requestId: decision.requestId,
        kind,
        status: decision.status,
        reviewedBy: decision.reviewedBy,
        reviewedAt: decision.reviewedAt,
        reviewNotes: decision.reviewNotes,
      });
    }
  }
  return events.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

/** The request's current effective decision — the most recent event, or undefined
 *  if nobody has reviewed it yet. */
export function effectiveDecision(history: DecisionEvent[]): DecisionEvent | undefined {
  return history.length > 0 ? history[history.length - 1] : undefined;
}
