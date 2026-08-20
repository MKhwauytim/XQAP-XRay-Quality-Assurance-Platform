import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { readOptionalJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { simpleHash } from "../storage/jsonEnvelope";
import { readJsonDirectory } from "../storage/directoryScan";
import { ensureMonthWritable } from "../population/monthLock";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import type {
  DecisionEvent,
  DecisionEventKind,
  DecisionOutcomeEvent,
  SupervisorDecisionFile,
} from "./approvalTypes";
import { getPopulationMonthDir, getSampleApprovalsDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";

/**
 * djb2 hash of one decision event (B5). Serialises the event as stored so the chain
 * is reproducible from the file alone. TAMPER-EVIDENT only — no secret key.
 */
export function hashDecisionEvent(event: DecisionEvent): string {
  return simpleHash(JSON.stringify(event));
}

/**
 * Verify the `previousDecisionHash` chain over a supervisor's `decisionEvents`
 * (B5). Returns the index of the first event whose recorded previous-hash does not
 * match the actual hash of its predecessor, or `null` when the whole chain is
 * intact. Events predating B5 (no `previousDecisionHash`) are skipped, so a legacy
 * file is never reported as broken.
 */
export function verifyDecisionChain(events: DecisionEvent[]): number | null {
  for (let i = 1; i < events.length; i++) {
    const recorded = events[i].previousDecisionHash;
    if (recorded === undefined) continue; // legacy / pre-B5 event — not chained
    if (recorded !== hashDecisionEvent(events[i - 1])) return i;
  }
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

/**
 * A supervisor's decision file, or an empty shell when they have made none yet.
 *
 * **Throws when the file exists but could not be read.** It is the base read of
 * `recordDecision`'s read-modify-write, so an empty shell substituted for an
 * unreadable file replaces the whole decision chain — its B5
 * `previousDecisionHash` links included — and every already-approved request
 * silently reverts to pending and becomes re-approvable, with the write
 * reporting success. Only genuine absence produces the shell.
 */
export async function loadSupervisorDecisions(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string
): Promise<SupervisorDecisionFile> {
  const fileName = decisionFileName(supervisorUsername);
  const read = await readOptionalJson<SupervisorDecisionFile>(
    `approvals:${monthFolderName}/${supervisorUsername}`,
    [
      { directory: () => getApprovalsDir(directoryHandle, monthFolderName), fileName },
      { directory: () => getLegacyApprovalsDir(directoryHandle, monthFolderName), fileName },
    ]
  );
  if (read.kind === "found") return read.value;
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
    const { values } = await readJsonDirectory<SupervisorDecisionFile>(appDir, {
      suffix: ".decisions.json",
      onUnreadable: "skip",
    });
    return values;
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
        const priorEvents = current.decisionEvents ?? [];
        // B5: chain this decision to the immediately-preceding one in the file. The
        // hash is stamped here (from stored state), never trusted from the caller.
        const lastEvent = priorEvents[priorEvents.length - 1];
        const chainedEvent: DecisionEvent = lastEvent
          ? { ...event, previousDecisionHash: hashDecisionEvent(lastEvent) }
          : { ...event };
        const updated: SupervisorDecisionFile = {
          ...current,
          revision: nextRevision,
          _writeToken: writeToken,
          decisionEvents: [...priorEvents, chainedEvent],
          lastUpdatedAt: new Date().toISOString(),
        };
        await safeWriteJson(appDir, fileName, updated);
        const verify = await loadSupervisorDecisions(directoryHandle, monthFolderName, supervisorUsername);
        if (verify.revision === nextRevision && verify._writeToken === writeToken) {
          bumpWorkspaceEpoch(directoryHandle, monthFolderName);
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

/** Key identifying one decision event within the merged history. A revocation
 *  names its target by (reviewer, reviewedAt): a reviewer may only revoke a
 *  decision from their own file, so the pair is unambiguous. */
function decisionKey(event: Pick<DecisionEvent, "reviewedBy" | "reviewedAt">): string {
  return `${event.reviewedBy}|${event.reviewedAt}`;
}

/** The `(reviewer, reviewedAt)` keys revoked by `"reverted"` events in `history`. */
export function revokedDecisionKeys(history: DecisionEvent[]): Set<string> {
  const revoked = new Set<string>();
  for (const event of history) {
    if (event.status !== "reverted" || !event.revokesDecisionAt) continue;
    revoked.add(decisionKey({ reviewedBy: event.reviewedBy, reviewedAt: event.revokesDecisionAt }));
  }
  return revoked;
}

/** The request's effective decision — FIRST-wins among decisions that are still
 *  standing: the EARLIEST non-revoked decision (by reviewedAt) is authoritative,
 *  or undefined if nobody has reviewed it yet (or every decision has been taken
 *  back). Decisions live in per-supervisor files, so two reviewers can each write
 *  a decision before seeing the other's. Latest-wins would make the outcome depend
 *  on clock skew / write ordering; first-wins is deterministic — whoever decided
 *  first owns the request, and a later reviewer's write is surfaced as a conflict
 *  (see approveReferral).
 *
 *  Undo is append-only: a reviewer takes their decision back by appending a
 *  `"reverted"` event naming it, never by deleting it. Skipping revoked decisions
 *  here — rather than dropping them in mergeDecisionHistory — is what keeps the
 *  full trail (decision AND its revocation) visible to the request timeline while
 *  the effective status returns to pending. `history` is pre-sorted oldest→newest
 *  by mergeDecisionHistory. */
export function effectiveDecision(history: DecisionEvent[]): DecisionOutcomeEvent | undefined {
  const revoked = revokedDecisionKeys(history);
  return history.find(
    (event): event is DecisionOutcomeEvent =>
      event.status !== "reverted" && !revoked.has(decisionKey(event))
  );
}
