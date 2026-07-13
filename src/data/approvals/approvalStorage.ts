import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { ensureMonthWritable } from "../population/monthLock";
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
  // Month lock gate — throws MonthClosedError when the month is closed; callers
  // that need a user-facing message should catch it explicitly. Kept outside the
  // CAS loop so a closed month rejects loudly instead of being retried.
  await ensureMonthWritable(directoryHandle, monthFolderName);

  const fileName = decisionFileName(supervisorUsername);
  // `:rmw` suffix keeps this outer read-modify-write lock distinct from
  // safeWriteJson's internal `${dir.name}/${fileName}` lock (withResourceLock is
  // not reentrant — a colliding key self-deadlocks). The outer lock serializes
  // same-tab appends; the casLoop token guards cross-machine races on a shared folder.
  return withResourceLock(`approvals/${fileName}:rmw`, () =>
    casLoop<{ ok: true }>(
      async (writeToken) => {
        const appDir = await getApprovalsDir(directoryHandle, monthFolderName);
        const current = await loadSupervisorDecisions(directoryHandle, monthFolderName, supervisorUsername);
        const nextRevision = (current.revision ?? 0) + 1;
        const updated: SupervisorDecisionFile = {
          ...current,
          revision: nextRevision,
          _writeToken: writeToken,
          decisionEvents: [...(current.decisionEvents ?? []), event],
          lastUpdatedAt: new Date().toISOString(),
        };
        await safeWriteJson(appDir, fileName, updated);
        const verify = await loadSupervisorDecisions(directoryHandle, monthFolderName, supervisorUsername);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          return {
            done: true,
            result: { ok: true as const },
            verify: async () => {
              const recheck = await loadSupervisorDecisions(
                directoryHandle,
                monthFolderName,
                supervisorUsername
              );
              return recheck.revision === nextRevision && recheck._writeToken === writeToken;
            },
          };
        }
        return { done: false };
      },
      { conflictError: "تعارض في الكتابة: لم يتمكن النظام من حفظ قرار الاعتماد بعد عدة محاولات." }
    )
  );
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
    // "reopen" is a newer kind with no legacy per-kind array — only decisionEvents.
    const legacy =
      kind === "referral" ? file.referralDecisions : kind === "replacement" ? file.replacementDecisions : [];
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

/** The request's effective decision — FIRST-wins: the EARLIEST decision (by
 *  reviewedAt) is authoritative, or undefined if nobody has reviewed it yet.
 *  Decisions live in per-supervisor files, so two reviewers can each write a
 *  decision before seeing the other's. Latest-wins would make the outcome depend
 *  on clock skew / write ordering; first-wins is deterministic — whoever decided
 *  first owns the request, and a later reviewer's write is surfaced as a conflict
 *  (see approveReferral). `history` is pre-sorted oldest→newest by mergeDecisionHistory. */
export function effectiveDecision(history: DecisionEvent[]): DecisionEvent | undefined {
  return history.length > 0 ? history[0] : undefined;
}
