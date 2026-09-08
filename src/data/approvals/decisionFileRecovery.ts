/**
 * Diagnosis and recovery for a supervisor decision file that exists but cannot
 * be read.
 *
 * WHY THIS EXISTS. `appendDecisionEvent` re-reads the supervisor's
 * `{name}.decisions.json` as the base of its read-modify-write on every casLoop
 * attempt, and `loadSupervisorDecisions` throws — deliberately — when the file
 * is there but unreadable. That refusal is correct: substituting an empty shell
 * would replace the whole B5 decision chain, silently reverting every approved
 * request to pending. But it is also terminal. One production workspace sat in
 * exactly that state for over a week (52 identical XQ-IO-029 entries between
 * 2026-08-31 and 2026-09-08, all naming one file), during which that supervisor
 * could not record a single approval decision for the month and had no way out.
 *
 * THE ONE SAFETY PROPERTY. "Could not read" is not one condition, and the two
 * it covers need opposite responses:
 *
 *  - The share ANSWERED and the bytes are not valid content (`corrupt`). The
 *    file is damaged. Recovery is meaningful.
 *  - The share did NOT answer (`unavailable` — `NotReadableError`, a permission
 *    failure, a directory that will not open). The file is very probably
 *    perfect and this machine simply cannot see it right now. In the same
 *    production log that motivated this module, 715 of 1,707 entries are
 *    exactly that condition.
 *
 * Archiving or resetting on the second case would destroy a healthy decision
 * chain on the strength of a transient network fault — the precise inversion of
 * this codebase's own doctrine that a failed access is never proof of a
 * permanent condition. So `unavailable` is refused outright, whatever the
 * caller asked for.
 *
 * ARCHIVES, NEVER DELETES. Every path that displaces the live file first copies
 * its BYTES (never its parsed content — it has none) to
 * `{fileName}.unreadable-{timestamp}` and only then removes the original, so a
 * failure between the two steps leaves both files present. Nothing ever reads
 * that archived name; it is a manual-recovery copy, following the precedent
 * `feedbackStorage.ts`'s `finalizeLegacyMigration` sets with
 * `messages.json.migrated` (see CLAUDE.md's post-launch migration policy).
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { copyFileBytes, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { bumpWorkspaceEpoch } from "../storage/inFlightReads";
import { getSampleApprovalsDir, safeWorkspaceFilePart } from "../workspace/workspacePaths";
import type { SupervisorDecisionFile } from "./approvalTypes";
import { verifyDecisionChain } from "./approvalStorage";

/** What one candidate file (the live name, or its `.bak` / `.tmp` sibling) turned out to be. */
export type DecisionCandidate =
  | { kind: "absent" }
  /** The share answered; the content is not a usable decision file. */
  | { kind: "corrupt" }
  /** The share did not answer. Says nothing about the file's contents. */
  | { kind: "unavailable"; reason: string }
  | {
      kind: "readable";
      decisionEvents: number;
      revision: number;
      lastUpdatedAt: string | null;
    };

export type DecisionFileReport = {
  monthFolderName: string;
  supervisorUsername: string;
  fileName: string;
  live: DecisionCandidate;
  bak: DecisionCandidate;
  tmp: DecisionCandidate;
  /**
   * True while `appendDecisionEvent` cannot succeed for this supervisor — the
   * live name is damaged AND neither sibling could stand in for it.
   */
  blocked: boolean;
  /**
   * True when the live name itself is damaged, INCLUDING the case where
   * `safeReadJson`'s `.bak`/`.tmp` ladder is currently covering for it. Reads
   * still succeed there, so nothing is blocked — but every one of them pays the
   * fallback ladder and fires `data:recovered-from-bak`, and the damaged bytes
   * stay on the share until something clears them.
   */
  needsRepair: boolean;
  /** Which sibling a recovery would restore from, or `null` when none can. */
  recoverableFrom: "bak" | "tmp" | null;
  /**
   * Index of the first decision whose `previousDecisionHash` does not match its
   * predecessor, or `null` for an intact (or unreadable) chain. Reported, never
   * acted on — a broken chain is a finding for a human, not something to repair
   * automatically.
   */
  chainBreakAt: number | null;
};

export type DecisionRecoveryOutcome =
  /** The file reads fine, or the supervisor has none yet. Nothing was touched. */
  | { kind: "not-needed"; report: DecisionFileReport }
  /**
   * Restored from a readable sibling; the damaged original was archived.
   *
   * `decisionEvents` is what the sibling actually held, which is NOT necessarily
   * what the damaged file held. `.bak` is the snapshot `safeWriteJson` takes
   * BEFORE each commit, so restoring from it gives back the previous committed
   * state — the most recent decision may not be in it. Report both this count
   * and `from` to whoever authorised the recovery; never present the result as
   * "everything is back".
   */
  | {
      kind: "restored";
      from: "bak" | "tmp";
      decisionEvents: number;
      archivedAs: string;
      report: DecisionFileReport;
    }
  /** Nothing was recoverable and `allowReset` was set: archived, fresh chain started. */
  | { kind: "reset"; archivedAs: string; report: DecisionFileReport }
  /** Damaged, nothing recoverable, and the caller did not authorise a reset. */
  | { kind: "unrecoverable"; report: DecisionFileReport }
  /** The share is not answering. Refused — see this module's safety property. */
  | { kind: "unavailable"; report: DecisionFileReport }
  /** The workspace grant cannot remove entries, so nothing can be archived. */
  | { kind: "unsupported"; reason: string; report: DecisionFileReport }
  | { kind: "failed"; error: string; report: DecisionFileReport };

export function decisionFileNameFor(supervisorUsername: string): string {
  return `${safeWorkspaceFilePart(supervisorUsername)}.decisions.json`;
}

function describeFile(value: SupervisorDecisionFile): DecisionCandidate {
  return {
    kind: "readable",
    decisionEvents: value.decisionEvents?.length ?? 0,
    revision: value.revision ?? 0,
    lastUpdatedAt: value.lastUpdatedAt ?? null,
  };
}

function isDecisionFile(value: unknown): value is SupervisorDecisionFile {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SupervisorDecisionFile).referralDecisions)
  );
}

/**
 * Classify the LIVE name, telling "this file is fine" apart from "a sibling is
 * covering for it".
 *
 * `safeReadJson` has its own `.bak` → `.tmp` ladder, so a plain `ok` says
 * nothing about the live name on its own. Its `recoveredFromBak` flag is
 * exactly the missing bit: `ok` with the flag SET means the live name failed
 * and a sibling answered instead — reads keep working, but the live file is
 * damaged. That distinction is the difference between "nothing to do here" and
 * "this workspace is one lost `.bak` away from a blocked supervisor".
 */
async function classifyLive(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<{ candidate: DecisionCandidate; healedBySibling: boolean }> {
  let read;
  try {
    read = await safeReadJson<SupervisorDecisionFile>(dir, fileName);
  } catch (error) {
    return {
      candidate: {
        kind: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      },
      healedBySibling: false,
    };
  }
  if (!read.ok) {
    return {
      candidate: read.reason === "missing" ? { kind: "absent" } : { kind: "corrupt" },
      healedBySibling: false,
    };
  }
  // Parsed, but not as a decision file: treat as damaged rather than serve it.
  if (!isDecisionFile(read.value)) return { candidate: { kind: "corrupt" }, healedBySibling: false };
  if (read.recoveredFromBak) return { candidate: { kind: "corrupt" }, healedBySibling: true };
  return { candidate: describeFile(read.value), healedBySibling: false };
}

/**
 * Read a sibling by its exact name. `safeReadJson` would probe
 * `{name}.bak.bak` / `{name}.bak.tmp` on a miss — harmless (both absent) but
 * pointless round trips on a share, so the existence check comes first.
 */
async function classifySibling(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<DecisionCandidate> {
  try {
    await dir.getFileHandle(fileName, { create: false });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFoundError") return { kind: "absent" };
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  let read;
  try {
    read = await safeReadJson<SupervisorDecisionFile>(dir, fileName);
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!read.ok) return read.reason === "missing" ? { kind: "absent" } : { kind: "corrupt" };
  if (!isDecisionFile(read.value)) return { kind: "corrupt" };
  return describeFile(read.value);
}

async function openApprovalsDir(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<{ ok: true; dir: DirectoryHandleLike } | { ok: false; reason: string }> {
  try {
    return { ok: true, dir: await getSampleApprovalsDir(directoryHandle, monthFolderName, true) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function unreadableReport(
  monthFolderName: string,
  supervisorUsername: string,
  fileName: string,
  candidate: DecisionCandidate
): DecisionFileReport {
  return {
    monthFolderName,
    supervisorUsername,
    fileName,
    live: candidate,
    bak: candidate,
    tmp: candidate,
    blocked: true,
    needsRepair: false,
    recoverableFrom: null,
    chainBreakAt: null,
  };
}

/**
 * What is actually at `{supervisor}.decisions.json` and its two siblings.
 * Pure diagnosis — never writes, never removes, never repairs.
 */
export async function inspectDecisionFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string
): Promise<DecisionFileReport> {
  const fileName = decisionFileNameFor(supervisorUsername);
  const opened = await openApprovalsDir(directoryHandle, monthFolderName);
  if (!opened.ok) {
    return unreadableReport(monthFolderName, supervisorUsername, fileName, {
      kind: "unavailable",
      reason: opened.reason,
    });
  }
  const dir = opened.dir;

  const { candidate: live, healedBySibling } = await classifyLive(dir, fileName);
  const [bak, tmp] = await Promise.all([
    classifySibling(dir, `${fileName}.bak`),
    classifySibling(dir, `${fileName}.tmp`),
  ]);

  // `absent` is a fact about the data, not a failure: a supervisor who has made
  // no decisions this month has no file, and `loadSupervisorDecisions` already
  // returns an empty shell for that.
  const needsRepair = live.kind === "corrupt";
  // Damaged AND unaided is what actually stops a supervisor working. A damaged
  // live file that a sibling is still answering for is a repair job, not an
  // outage.
  const blocked = (live.kind === "corrupt" && !healedBySibling) || live.kind === "unavailable";

  let recoverableFrom: "bak" | "tmp" | null = null;
  if (live.kind === "corrupt") {
    // Prefer whichever sibling carries more decision history; `.bak` wins a tie
    // because it is the previous COMMITTED content, while `.tmp` is a staged
    // copy that may never have been committed.
    const bakEvents = bak.kind === "readable" ? bak.decisionEvents : -1;
    const tmpEvents = tmp.kind === "readable" ? tmp.decisionEvents : -1;
    if (bakEvents >= 0 || tmpEvents >= 0) recoverableFrom = bakEvents >= tmpEvents ? "bak" : "tmp";
  }

  let chainBreakAt: number | null = null;
  if (live.kind === "readable") {
    const read = await safeReadJson<SupervisorDecisionFile>(dir, fileName).catch(() => null);
    if (read?.ok) chainBreakAt = verifyDecisionChain(read.value.decisionEvents ?? []);
  }

  return {
    monthFolderName,
    supervisorUsername,
    fileName,
    live,
    bak,
    tmp,
    blocked,
    needsRepair,
    recoverableFrom,
    chainBreakAt,
  };
}

/**
 * Copy the live file's BYTES aside under a timestamped `.unreadable-` name and
 * then remove the original. Bytes, not parsed content — the file has none that
 * parses, which is the entire problem. Written before the removal, so an
 * interruption leaves both copies rather than none.
 */
async function archiveLiveFile(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<{ ok: true; archivedAs: string } | { ok: false; reason: string }> {
  if (typeof dir.removeEntry !== "function") {
    return { ok: false, reason: "this workspace grant cannot remove entries" };
  }
  const archivedAs = `${fileName}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await copyFileBytes(dir, fileName, dir, archivedAs);
    await dir.removeEntry(fileName);
    return { ok: true, archivedAs };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Unblock a supervisor whose decision file cannot be read.
 *
 * Never resets on its own initiative: `allowReset` is the caller's explicit
 * authorisation to start an empty chain when — and only when — the damaged file
 * and both siblings are all unrecoverable. A share that is merely not answering
 * is refused regardless of that flag.
 */
export async function recoverDecisionFile(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  supervisorUsername: string,
  options: { allowReset: boolean }
): Promise<DecisionRecoveryOutcome> {
  const report = await inspectDecisionFile(directoryHandle, monthFolderName, supervisorUsername);
  if (report.live.kind === "unavailable") return { kind: "unavailable", report };
  // Repairs a damaged live file even while a sibling is covering for it: reads
  // work today, but only because one fallback copy happens to have survived.
  if (!report.needsRepair) return { kind: "not-needed", report };

  const opened = await openApprovalsDir(directoryHandle, monthFolderName);
  if (!opened.ok) return { kind: "unavailable", report };
  const dir = opened.dir;
  const fileName = report.fileName;

  // Read the replacement BEFORE displacing anything, so a sibling that turns
  // out to be unreadable after all leaves the damaged original in place.
  let replacement: SupervisorDecisionFile | null = null;
  if (report.recoverableFrom) {
    const source = `${fileName}.${report.recoverableFrom}`;
    const read = await safeReadJson<SupervisorDecisionFile>(dir, source).catch(() => null);
    if (read?.ok) replacement = read.value;
  }
  if (replacement === null && !options.allowReset) return { kind: "unrecoverable", report };

  if (typeof dir.removeEntry !== "function") {
    return { kind: "unsupported", reason: "this workspace grant cannot remove entries", report };
  }
  const archived = await archiveLiveFile(dir, fileName);
  if (!archived.ok) {
    logError("approvals:recover-archive", new Error(archived.reason));
    return { kind: "failed", error: archived.reason, report };
  }

  // A fresh shell carries NO decision events and, deliberately, no revision
  // continuity: the previous revision counter was in the file that could not be
  // read, so inventing one would be a claim about history nobody can check.
  const payload: SupervisorDecisionFile = replacement ?? {
    supervisorUsername,
    monthFolderName,
    revision: 0,
    referralDecisions: [],
    replacementDecisions: [],
    decisionEvents: [],
    lastUpdatedAt: new Date().toISOString(),
  };

  try {
    await safeWriteJson(dir, fileName, payload);
  } catch (error) {
    // The archive still holds the original bytes — say so, loudly, rather than
    // leaving an admin to guess where their file went.
    const message = error instanceof Error ? error.message : String(error);
    logError(
      "approvals:recover-write",
      new Error(`${monthFolderName}/${supervisorUsername}: ${message} — original bytes kept as ${archived.archivedAs}`)
    );
    return { kind: "failed", error: message, report };
  }
  bumpWorkspaceEpoch(directoryHandle, monthFolderName);

  if (replacement !== null && report.recoverableFrom) {
    logError(
      "approvals:recovered",
      new Error(
        `${monthFolderName}/${supervisorUsername}: restored ${replacement.decisionEvents?.length ?? 0} decision event(s) from .${report.recoverableFrom}; damaged original archived as ${archived.archivedAs}`
      )
    );
    return {
      kind: "restored",
      from: report.recoverableFrom,
      decisionEvents: replacement.decisionEvents?.length ?? 0,
      archivedAs: archived.archivedAs,
      report,
    };
  }
  logError(
    "approvals:recover-reset",
    new Error(
      `${monthFolderName}/${supervisorUsername}: no readable copy of ${fileName} anywhere; started a fresh decision chain and archived the unreadable original as ${archived.archivedAs}`
    )
  );
  return { kind: "reset", archivedAs: archived.archivedAs, report };
}


const DECISIONS_SUFFIX = ".decisions.json";

/**
 * Inspect every supervisor decision file in the month.
 *
 * The point of scanning rather than asking for a name: an admin looking at a
 * blocked approval surface does not know WHICH supervisor's file is damaged —
 * the error log names it, but the app never did. This answers that directly.
 *
 * Sorted by severity (blocked first, then merely damaged, then healthy) so the
 * thing that needs doing is at the top.
 */
export async function inspectMonthDecisionFiles(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<DecisionFileReport[]> {
  const opened = await openApprovalsDir(directoryHandle, monthFolderName);
  if (!opened.ok) {
    throw new Error(
      `approvals:${monthFolderName}: the approvals folder could not be opened — ${opened.reason}`
    );
  }
  const supervisors = (await listDirectoryEntries(opened.dir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(DECISIONS_SUFFIX))
    .map((entry) => entry.name.slice(0, -DECISIONS_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b));

  const reports: DecisionFileReport[] = [];
  for (const supervisor of supervisors) {
    reports.push(await inspectDecisionFile(directoryHandle, monthFolderName, supervisor));
  }
  const severity = (report: DecisionFileReport): number =>
    report.blocked ? 0 : report.needsRepair ? 1 : report.chainBreakAt !== null ? 2 : 3;
  return reports.sort(
    (a, b) => severity(a) - severity(b) || a.supervisorUsername.localeCompare(b.supervisorUsername)
  );
}
