import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { isQuietRecoveryFileName } from "../storage/bakRecoveryReport";
import { logError } from "../storage/errorLogger";
import { listDirectoryEntries } from "../storage/directoryScan";
import { reportBakRecoveryHealed } from "../storage/bakRecoveryReport";
import { appendWorkspaceAction } from "../audit/actionLog";
import {
  archiveOrphanSibling,
  findOrphanSiblings,
} from "../storage/orphanSiblings";
import {
  getAuditActionsDir,
  getAuditActivityDir,
  getAuditRoot,
  getFeedbackThreadsDir,
  getReportsRoot,
  getSystemRoot,
  getTemplatesRoot,
  getUserDataRoot,
} from "../workspace/workspacePaths";
import {
  inspectAllTemplateFiles,
  recoverTemplateFile,
} from "../templates/templateFileRecovery";
import { healFileFromSibling, type SiblingHealResult } from "./siblingHeal";

/**
 * The admin boot self-check: find broken workspace files, repair what can be
 * repaired, and report everything to the admin who signed in.
 *
 * WHY IT EXISTS. Damaged, orphaned and missing files were only ever discovered
 * when something happened to read them, reported only to whoever was looking
 * at the screen at that moment, and repaired only if an admin knew to open a
 * Settings panel nobody had told them about. The 2026-09-08/09 production log
 * is the proof: one template served from an orphaned `.bak` for over eighteen
 * hours, across every user including the admin, with a banner nobody acted on.
 *
 * A REVERSAL, STATED PLAINLY. `templateFileRecovery.ts` and
 * `decisionFileRecovery.ts` both carry the rule "never repair silently on
 * read — a repair nobody asked for, on data nobody has verified, is worse than
 * the outage." That rule is about the READ PATH, and it still holds there:
 * nothing in this module runs from a read.
 *
 * What the owner asked for on 2026-09-09, and what this does, is narrower and
 * deliberate: repair at ONE known moment (an admin's sign-in), for ONE role,
 * and report every single thing it touched. The objection the old rule raises
 * — a silent repair on unverified data — is answered by the report, not
 * ignored. Nothing here is silent, and an admin who disagrees with a repair
 * still has the archived original, because every repair archives and none
 * deletes.
 *
 * NEVER BLOCKS SIGN-IN. Every check is wrapped: a failure becomes a "could not
 * check" row, never an exception into the boot path. That matches
 * `bootProgress.ts`'s existing contract, where a source left in `error`
 * deliberately does not block `allLoaded`.
 */

/** One thing the scan found, and what happened to it. */
export type IntegrityFinding = {
  /** Where it was found, for the admin's benefit — e.g. `6-templates`. */
  location: string;
  /** The file or record the finding is about. */
  subject: string;
  /** What was wrong, in one sentence (Arabic label keys are applied by the UI). */
  problem: IntegrityProblem;
  outcome: IntegrityOutcome;
  /** Extra detail: the archive name, or why a repair could not run. */
  detail?: string;
};

export type IntegrityProblem =
  /** Live file present but unreadable — a torn write. */
  | "damaged"
  /** A `.bak`/`.tmp` with no live file — almost always a deletion orphan. */
  | "orphan-sibling"
  /** A required workspace root was absent. */
  | "missing-root";

export type IntegrityOutcome =
  /** Fixed. `detail` says how. */
  | "repaired"
  /** Found, understood, and NOT fixable automatically. */
  | "needs-attention"
  /** The check itself could not run. Says nothing about the data. */
  | "could-not-check";

export type BootIntegrityReport = {
  findings: IntegrityFinding[];
  /** True when at least one finding is worth showing the admin. */
  hasFindings: boolean;
  repairedCount: number;
  needsAttentionCount: number;
};

/**
 * The roots swept for orphaned siblings. Each is a directory this app writes
 * `safeWriteJson`-managed files directly into, so an orphan there is a real
 * leftover rather than an unrelated file.
 */
const ORPHAN_SWEEP_ROOTS: ReadonlyArray<{
  label: string;
  open: (dir: DirectoryHandleLike) => Promise<DirectoryHandleLike>;
}> = [
  { label: "6-templates", open: (dir) => getTemplatesRoot(dir, false) },
  { label: "3-user-data", open: (dir) => getUserDataRoot(dir, false) },
  { label: "4-reports", open: (dir) => getReportsRoot(dir, false) },
  { label: "5-system", open: (dir) => getSystemRoot(dir, false) },
];

/**
 * Run the whole self-check.
 *
 * `now` is injected rather than read from the clock so archive names are
 * assertable in tests.
 */
export async function runBootIntegrityScan(
  directoryHandle: DirectoryHandleLike,
  options: { now?: string; siblingHeal?: SiblingHealScanOptions } = {}
): Promise<BootIntegrityReport> {
  const timestamp = options.now ?? new Date().toISOString();
  const findings: IntegrityFinding[] = [];

  await repairDamagedTemplates(directoryHandle, findings);
  await archiveOrphanedSiblings(directoryHandle, findings, timestamp);
  // Opt-in: only the admin sign-in path passes `siblingHeal`.
  if (options.siblingHeal) {
    await healDamagedFromSiblings(directoryHandle, findings, options.siblingHeal);
  }

  const repairedCount = findings.filter((item) => item.outcome === "repaired").length;
  const needsAttentionCount = findings.filter(
    (item) => item.outcome !== "repaired"
  ).length;

  return {
    findings,
    hasFindings: findings.length > 0,
    repairedCount,
    needsAttentionCount,
  };
}

async function repairDamagedTemplates(
  directoryHandle: DirectoryHandleLike,
  findings: IntegrityFinding[]
): Promise<void> {
  let reports;
  try {
    reports = await inspectAllTemplateFiles(directoryHandle);
  } catch (error) {
    findings.push({
      location: "6-templates",
      subject: "6-templates",
      problem: "missing-root",
      outcome: "could-not-check",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const report of reports) {
    if (!report.needsRepair) continue;
    try {
      const outcome = await recoverTemplateFile(directoryHandle, report.templateId);
      if (outcome.kind === "restored") {
        findings.push({
          location: "6-templates",
          subject: report.fileName,
          problem: "damaged",
          outcome: "repaired",
          // `.bak` is the snapshot taken BEFORE the last commit, so the most
          // recent edit may not be in it. `templateFileRecovery.ts` is explicit
          // that this must never be reported as "everything is back", so the
          // source and the archive name both reach the admin verbatim.
          detail: `restored from .${outcome.from}; original archived as ${outcome.archivedAs}`,
        });
      } else {
        // "unrecoverable" (no readable sibling) and "unavailable" (the share
        // did not answer) are different conditions, and neither is a repair —
        // both go to the admin rather than being counted as fixed.
        findings.push({
          location: "6-templates",
          subject: report.fileName,
          problem: "damaged",
          outcome: outcome.kind === "unavailable" ? "could-not-check" : "needs-attention",
          detail: outcome.kind,
        });
      }
    } catch (error) {
      logError(
        "integrity:template-repair",
        error instanceof Error ? error : new Error(String(error)),
        { action: report.templateId }
      );
      findings.push({
        location: "6-templates",
        subject: report.fileName,
        problem: "damaged",
        outcome: "could-not-check",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * The single gate for running the boot scan at all. Admin only, never demo (an
 * in-memory workspace has nothing real to repair), and only with a mounted,
 * ready workspace. `App.tsx` calls this; it exists as a function so the "a
 * non-admin never triggers a repair" rule has a test that does not need to
 * render the whole app.
 */
export function shouldRunBootIntegrityScan(input: {
  role: string;
  mode: string | undefined;
  hasWorkspace: boolean;
  workspaceReady: boolean;
}): boolean {
  return (
    input.role === "admin" &&
    input.mode !== "demo" &&
    input.hasWorkspace &&
    input.workspaceReady
  );
}

/** Who the sibling heal is acting for, so the action log can attribute it. */
export type SiblingHealScanOptions = {
  actor: string;
  /** Injected clock (epoch ms) for the `.tmp` freshness window; tests only. */
  nowMs?: number;
};

/**
 * Workspace JSON families the sibling heal examines. Resolved through
 * `workspacePaths.ts`, non-recursive, one directory each.
 *
 * INCLUDED: feedback threads (the reported case), 3-user-data, the top level of
 * 5-system (notifications, presets and other shared state), and the three audit
 * directories.
 *
 * EXCLUDED, on purpose: templates, decisions and population (each has its own
 * recovery module with domain checks); `threads.index.json` and
 * `distribution.current.json` (rebuildable caches — healing them from an old
 * sibling would be worse than rebuilding); `5-system/system-errors` (the
 * durable error log is appended to by this very scan's `logError` calls, so
 * rewriting it mid-scan would race our own writer); the legacy
 * `feedback/messages.json` (read-only by contract).
 */
const SIBLING_HEAL_FAMILIES: ReadonlyArray<{
  label: string;
  open: (dir: DirectoryHandleLike) => Promise<DirectoryHandleLike>;
}> = [
  { label: "5-system/feedback/threads", open: (dir) => getFeedbackThreadsDir(dir, false) },
  { label: "3-user-data", open: (dir) => getUserDataRoot(dir, false) },
  { label: "5-system", open: (dir) => getSystemRoot(dir, false) },
  { label: "5-system/audit", open: (dir) => getAuditRoot(dir, false) },
  { label: "5-system/audit/actions", open: (dir) => getAuditActionsDir(dir, false) },
  { label: "5-system/audit/activity", open: (dir) => getAuditActivityDir(dir, false) },
];

/** Rebuildable caches that must never be healed from a sibling. */
const SIBLING_HEAL_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  "threads.index.json",
  "distribution.current.json",
]);

/**
 * SMB cost bound: per directory, at most this many files are opened. Only live
 * `.json` names that have a `.tmp` or `.bak` beside them are candidates, `.tmp`
 * holders first (a leftover `.tmp` is the strongest sign of a failed commit).
 */
export const SIBLING_HEAL_MAX_FILES_PER_DIR = 400;

/** Candidate live names in one directory listing: have a sibling, are not excluded. */
export function pickSiblingHealCandidates(entryNames: readonly string[]): string[] {
  const names = new Set(entryNames);
  const withTmp: string[] = [];
  const withBakOnly: string[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith(".json") || SIBLING_HEAL_EXCLUDED_NAMES.has(name) || isQuietRecoveryFileName(name)) continue;
    if (names.has(`${name}.tmp`)) withTmp.push(name);
    else if (names.has(`${name}.bak`)) withBakOnly.push(name);
  }
  return [...withTmp, ...withBakOnly].slice(0, SIBLING_HEAL_MAX_FILES_PER_DIR);
}

async function healDamagedFromSiblings(
  directoryHandle: DirectoryHandleLike,
  findings: IntegrityFinding[],
  options: SiblingHealScanOptions
): Promise<void> {
  const healed: Array<{ location: string; result: Extract<SiblingHealResult, { status: "healed" }> }> = [];

  for (const family of SIBLING_HEAL_FAMILIES) {
    let dir: DirectoryHandleLike;
    try {
      dir = await family.open(directoryHandle);
    } catch {
      continue; // a folder this workspace never created is not a fault
    }
    let names: string[];
    try {
      const entries = await listDirectoryEntries(dir);
      names = pickSiblingHealCandidates(
        entries.filter((entry) => entry.kind === "file").map((entry) => entry.name)
      );
    } catch (error) {
      findings.push({
        location: family.label,
        subject: family.label,
        problem: "damaged",
        outcome: "could-not-check",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const fileName of names) {
      const result = await healFileFromSibling(dir, fileName, {
        location: family.label,
        nowMs: options.nowMs,
      });
      if (result.status === "healed") {
        healed.push({ location: family.label, result });
        findings.push({
          location: family.label,
          subject: fileName,
          problem: "damaged",
          outcome: "repaired",
          detail: `restored from ${fileName}${result.source}; original archived as ${result.archivedAs}`,
        });
        // The yellow "served from a copy" banner is now stale for this file.
        reportBakRecoveryHealed(fileName);
      } else if (result.status === "failed") {
        findings.push({
          location: family.label,
          subject: fileName,
          problem: "damaged",
          outcome: "needs-attention",
          detail: result.error,
        });
      } else if (result.reason === "no-valid-sibling" || result.reason === "sibling-older") {
        findings.push({
          location: family.label,
          subject: fileName,
          problem: "damaged",
          outcome: "needs-attention",
          detail: result.reason,
        });
      }
      // Every other skip (fresh .tmp, share not answering, read-only, ...) is
      // already in the durable error log and is not a to-do for the admin.
    }
  }

  // Action-log entries last, so the audit directories are not being rewritten
  // while the scan above is still walking them.
  for (const { location, result } of healed) {
    await appendWorkspaceAction(directoryHandle, {
      actor: options.actor,
      actorRole: "admin",
      action: "file-auto-healed",
      target: result.fileName,
      details: {
        location,
        source: result.source,
        archivedAs: result.archivedAs,
        revision: result.revision,
      },
    });
  }
}

async function archiveOrphanedSiblings(
  directoryHandle: DirectoryHandleLike,
  findings: IntegrityFinding[],
  timestamp: string
): Promise<void> {
  for (const root of ORPHAN_SWEEP_ROOTS) {
    let dir: DirectoryHandleLike;
    try {
      dir = await root.open(directoryHandle);
    } catch {
      // A root this workspace has never created is not a fault — a workspace
      // with no report designs has no 4-reports. Silence is correct here.
      continue;
    }

    let orphans;
    try {
      orphans = await findOrphanSiblings(dir);
    } catch (error) {
      findings.push({
        location: root.label,
        subject: root.label,
        problem: "orphan-sibling",
        outcome: "could-not-check",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const orphan of orphans) {
      const result = await archiveOrphanSibling(dir, orphan, timestamp);
      findings.push({
        location: root.label,
        subject: orphan.siblingName,
        problem: "orphan-sibling",
        outcome: result.ok ? "repaired" : "needs-attention",
        detail: result.ok ? `archived as ${result.archivedAs}` : result.reason,
      });
    }
  }
}
