/**
 * Diagnosis and recovery for a template file that exists but its live copy
 * cannot be read.
 *
 * WHY THIS EXISTS. `safeReadJson`'s `.bak` → `.tmp` fallback ladder keeps
 * `loadTemplate` working when the live `{templateId}.json` is damaged, but it
 * never rewrites the live file — every subsequent read repeats the exact same
 * fallback and re-fires the `data:recovered-from-bak` banner. There was no
 * admin-facing way to actually clear the condition short of an admin opening
 * the template in Template Builder and re-saving it (which nobody was ever
 * told to do), so the warning recurred indefinitely — reported for
 * `tmpl-1787457917309-ngm1iq.json`, but true of any damaged template file.
 *
 * Follows the precedent `approvals/decisionFileRecovery.ts` set for the exact
 * same class of bug: never repair silently on read (this codebase's own
 * doctrine — see that module's docblock — is that a repair nobody asked for,
 * on data nobody has verified, is worse than the outage), always archive the
 * damaged bytes rather than delete them, and let an admin trigger the repair
 * explicitly from Settings.
 *
 * SCOPE OF THAT RULE, since 2026-09-09. "Never repair silently on read" is
 * about the READ PATH, and it still holds there without exception — nothing in
 * this module runs from a read, and `safeReadJson` still never rewrites
 * anything.
 *
 * What changed is that `integrity/bootIntegrityScan.ts` now calls
 * `recoverTemplateFile` automatically at an ADMIN's sign-in (owner decision,
 * 2026-09-09), rather than waiting for that admin to find the Settings panel.
 * That is a real narrowing of the rule and is recorded here so the code and the
 * doctrine do not disagree: one role, one known moment, and every repair
 * reported to the admin in a dialog. The objection the rule raises — an
 * unasked-for repair on unverified data — is answered by that report and by
 * the archive this module already keeps, not waved away. The production case
 * that forced it: one damaged template served from its sibling for eighteen
 * hours, across every user including the admin, with a banner nobody acted on.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries } from "../storage/directoryScan";
import { copyFileBytes, safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { logError } from "../storage/errorLogger";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import type { TemplateSchema } from "./templateTypes";

/** What one candidate file (the live name, or its `.bak` / `.tmp` sibling) turned out to be. */
export type TemplateCandidate =
  | { kind: "absent" }
  /** The share answered; the content is not a usable template file. */
  | { kind: "corrupt" }
  /** The share did not answer. Says nothing about the file's contents. */
  | { kind: "unavailable"; reason: string }
  | { kind: "readable"; templateName: string; fieldCount: number };

export type TemplateFileReport = {
  templateId: string;
  fileName: string;
  live: TemplateCandidate;
  bak: TemplateCandidate;
  tmp: TemplateCandidate;
  /**
   * True when the live name itself is damaged, INCLUDING the case where
   * `safeReadJson`'s `.bak`/`.tmp` ladder is currently covering for it. Reads
   * still succeed there, so nothing is blocked for an admin editing the
   * template — but every read pays the fallback ladder and re-fires the
   * banner until something rewrites the live file.
   */
  needsRepair: boolean;
  /** Which sibling a recovery would restore from, or `null` when none can. */
  recoverableFrom: "bak" | "tmp" | null;
};

export type TemplateRecoveryOutcome =
  /** The file reads fine, or the templateId has no file. Nothing was touched. */
  | { kind: "not-needed"; report: TemplateFileReport }
  /**
   * Restored from a readable sibling; the damaged original was archived.
   *
   * `.bak` is the snapshot `safeWriteJson` takes BEFORE each commit, so
   * restoring from it gives back the previous committed state — the most
   * recent edit may not be in it. Report `from` to whoever authorised the
   * recovery; never present the result as "everything is back".
   */
  | { kind: "restored"; from: "bak" | "tmp"; archivedAs: string; report: TemplateFileReport }
  /** Nothing was recoverable. */
  | { kind: "unrecoverable"; report: TemplateFileReport }
  /** The share is not answering. Refused — see this module's safety property. */
  | { kind: "unavailable"; report: TemplateFileReport }
  /** The workspace grant cannot remove entries, so nothing can be archived. */
  | { kind: "unsupported"; reason: string; report: TemplateFileReport }
  | { kind: "failed"; error: string; report: TemplateFileReport };

function describeFile(value: TemplateSchema): TemplateCandidate {
  return {
    kind: "readable",
    templateName: value.templateName ?? "",
    fieldCount: value.fields?.length ?? 0,
  };
}

function isTemplateFile(value: unknown): value is TemplateSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TemplateSchema).templateId === "string" &&
    Array.isArray((value as TemplateSchema).fields)
  );
}

/**
 * Classify the LIVE name, telling "this file is fine" apart from "a sibling is
 * covering for it" — same distinction and reasoning as
 * `decisionFileRecovery.ts`'s `classifyLive`.
 */
async function classifyLive(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<{ candidate: TemplateCandidate; healedBySibling: boolean }> {
  let read;
  try {
    read = await safeReadJson<TemplateSchema>(dir, fileName);
  } catch (error) {
    return {
      candidate: { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) },
      healedBySibling: false,
    };
  }
  if (!read.ok) {
    return {
      candidate: read.reason === "missing" ? { kind: "absent" } : { kind: "corrupt" },
      healedBySibling: false,
    };
  }
  if (!isTemplateFile(read.value)) return { candidate: { kind: "corrupt" }, healedBySibling: false };
  if (read.recoveredFromBak) return { candidate: { kind: "corrupt" }, healedBySibling: true };
  return { candidate: describeFile(read.value), healedBySibling: false };
}

/**
 * Read a sibling by its exact name. `safeReadJson` would probe
 * `{name}.bak.bak` / `{name}.bak.tmp` on a miss — harmless (both absent) but
 * pointless round trips on a share, so the existence check comes first.
 */
async function classifySibling(dir: DirectoryHandleLike, fileName: string): Promise<TemplateCandidate> {
  try {
    await dir.getFileHandle(fileName, { create: false });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NotFoundError") return { kind: "absent" };
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  let read;
  try {
    read = await safeReadJson<TemplateSchema>(dir, fileName);
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!read.ok) return read.reason === "missing" ? { kind: "absent" } : { kind: "corrupt" };
  if (!isTemplateFile(read.value)) return { kind: "corrupt" };
  return describeFile(read.value);
}

function unreadableReport(
  templateId: string,
  fileName: string,
  candidate: TemplateCandidate
): TemplateFileReport {
  return {
    templateId,
    fileName,
    live: candidate,
    bak: candidate,
    tmp: candidate,
    needsRepair: false,
    recoverableFrom: null,
  };
}

/**
 * What is actually at `{templateId}.json` and its two siblings.
 * Pure diagnosis — never writes, never removes, never repairs.
 */
export async function inspectTemplateFile(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<TemplateFileReport> {
  const fileName = `${templateId}.json`;
  let dir: DirectoryHandleLike;
  try {
    dir = await getTemplatesRoot(directoryHandle, true);
  } catch (error) {
    return unreadableReport(templateId, fileName, {
      kind: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // `classifyLive` also reports whether a sibling is currently covering for a
  // damaged live file, which matters for `decisionFileRecovery.ts`'s separate
  // "blocked" state (writes can be permanently stuck there). Templates have no
  // such failure mode — `saveTemplate`'s casLoop reads through the very same
  // `.bak`/`.tmp` ladder, so a covered file is a repair job, never an outage.
  const { candidate: live } = await classifyLive(dir, fileName);
  const [bak, tmp] = await Promise.all([
    classifySibling(dir, `${fileName}.bak`),
    classifySibling(dir, `${fileName}.tmp`),
  ]);

  const needsRepair = live.kind === "corrupt";

  let recoverableFrom: "bak" | "tmp" | null = null;
  if (live.kind === "corrupt") {
    if (bak.kind === "readable") recoverableFrom = "bak";
    else if (tmp.kind === "readable") recoverableFrom = "tmp";
  }

  return { templateId, fileName, live, bak, tmp, needsRepair, recoverableFrom };
}

/**
 * Copy the live file's BYTES aside under a timestamped `.unreadable-` name and
 * then remove the original. Bytes, not parsed content — the file has none
 * that parses, which is the entire problem. Written before the removal, so an
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
 * Rewrite a template file whose live copy is damaged, from whichever sibling
 * still holds a readable snapshot.
 *
 * Never resets to a blank template: unlike a decision chain, a template has
 * no meaningful "empty" state to fall back to, so if neither `.bak` nor
 * `.tmp` is readable this returns `unrecoverable` rather than inventing one.
 */
export async function recoverTemplateFile(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<TemplateRecoveryOutcome> {
  const report = await inspectTemplateFile(directoryHandle, templateId);
  if (report.live.kind === "unavailable") return { kind: "unavailable", report };
  if (!report.needsRepair) return { kind: "not-needed", report };
  if (report.recoverableFrom === null) return { kind: "unrecoverable", report };

  let dir: DirectoryHandleLike;
  try {
    dir = await getTemplatesRoot(directoryHandle, true);
  } catch {
    return { kind: "unavailable", report };
  }
  const fileName = report.fileName;

  // Read the replacement BEFORE displacing anything, so a sibling that turns
  // out to be unreadable after all leaves the damaged original in place.
  const source = `${fileName}.${report.recoverableFrom}`;
  const read = await safeReadJson<TemplateSchema>(dir, source).catch(() => null);
  if (!read?.ok || !isTemplateFile(read.value)) return { kind: "unrecoverable", report };
  const replacement = read.value;

  if (typeof dir.removeEntry !== "function") {
    return { kind: "unsupported", reason: "this workspace grant cannot remove entries", report };
  }
  const archived = await archiveLiveFile(dir, fileName);
  if (!archived.ok) {
    logError("templates:recover-archive", new Error(archived.reason));
    return { kind: "failed", error: archived.reason, report };
  }

  try {
    await safeWriteJson(dir, fileName, replacement);
  } catch (error) {
    // The archive still holds the original bytes — say so, loudly, rather
    // than leaving an admin to guess where their file went.
    const message = error instanceof Error ? error.message : String(error);
    logError(
      "templates:recover-write",
      new Error(`${templateId}: ${message} — original bytes kept as ${archived.archivedAs}`)
    );
    return { kind: "failed", error: message, report };
  }

  logError(
    "templates:recovered",
    new Error(
      `${templateId}: restored "${replacement.templateName}" from .${report.recoverableFrom}; damaged original archived as ${archived.archivedAs}`
    )
  );
  return { kind: "restored", from: report.recoverableFrom, archivedAs: archived.archivedAs, report };
}

const TEMPLATE_SUFFIX = ".json";
const NON_TEMPLATE_SUFFIXES = [".deleted.bak.json", ".bak.json", ".tmp.json"];

/**
 * Inspect every template file in the workspace.
 *
 * The point of scanning rather than asking for a templateId: an admin sees
 * the recurring banner naming a file, but nothing before this pointed them at
 * a place to act on it. This answers that directly.
 *
 * Sorted by severity (needing repair first) so the thing that needs doing is
 * at the top.
 */
export async function inspectAllTemplateFiles(
  directoryHandle: DirectoryHandleLike
): Promise<TemplateFileReport[]> {
  const dir = await getTemplatesRoot(directoryHandle, true);
  const templateIds = (await listDirectoryEntries(dir))
    .filter(
      (entry) =>
        entry.kind === "file" &&
        entry.name.endsWith(TEMPLATE_SUFFIX) &&
        entry.name !== "templates.index.json" &&
        entry.name !== "template.selection.json" &&
        !NON_TEMPLATE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))
    )
    .map((entry) => entry.name.slice(0, -TEMPLATE_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b));

  const reports: TemplateFileReport[] = [];
  for (const templateId of templateIds) {
    reports.push(await inspectTemplateFile(directoryHandle, templateId));
  }
  const severity = (report: TemplateFileReport): number => (report.needsRepair ? 0 : 1);
  return reports.sort((a, b) => severity(a) - severity(b) || a.templateId.localeCompare(b.templateId));
}
