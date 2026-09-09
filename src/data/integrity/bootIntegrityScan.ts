import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import {
  archiveOrphanSibling,
  findOrphanSiblings,
} from "../storage/orphanSiblings";
import {
  getReportsRoot,
  getSystemRoot,
  getTemplatesRoot,
  getUserDataRoot,
} from "../workspace/workspacePaths";
import {
  inspectAllTemplateFiles,
  recoverTemplateFile,
} from "../templates/templateFileRecovery";

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
  options: { now?: string } = {}
): Promise<BootIntegrityReport> {
  const timestamp = options.now ?? new Date().toISOString();
  const findings: IntegrityFinding[] = [];

  await repairDamagedTemplates(directoryHandle, findings);
  await archiveOrphanedSiblings(directoryHandle, findings, timestamp);

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
