/**
 * Recovery for answers an OUTDATED copy of the app wrote into a per-assignee
 * (layout v2, v154+) month.
 *
 * A pre-v154 build knows nothing about `answers.events/_layout.json`: it keeps
 * appending flat segments straight under `answers.events/`, and it reads them
 * back itself, so on that employee's PC every case looks answered and green.
 * Every current client reads a v2 month only through the assignee folders, so
 * nobody else ever sees those answers — the admin, a supervisor, or the same
 * employee signed in on another PC all find the cases unanswered.
 *
 * This pass finds such stray flat segments and lands their self-saves through
 * `replayPendingAnswers` — the same conflict-safe path an unsent local answer
 * takes (strict "already on disk?" read, the event's own identity, the newer
 * save wins, never creates a month folder, honours closed months and
 * read-only mode). It never moves or deletes the stray file; an unchanged
 * file is not re-read within a session.
 *
 * Supervisor / on-behalf events are skipped, not re-landed: the replay path
 * writes self-saves only, and recording a supervisor's answer as the
 * employee's own would falsify who answered.
 */
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { listDirectoryEntries, listDirectoryEntriesWithSize } from "../storage/directoryScan";
import { logError } from "../storage/errorLogger";
import { isNotFoundError } from "../storage/transientFileErrors";
import { getAnswerEventsDir, getAnswerEventsLayout, getSampleMainDir, getSamplesRoot } from "../workspace/workspacePaths";
import { workspaceScopeId } from "../storage/inFlightReads";
import { ANSWER_EVENT_SEGMENT_SUFFIX, readAnswerEventDelta, type AnswerEvent } from "./answerEventStore";
import type { ItemAnswer } from "./answerTypes";
import type { OutboxIdentity } from "./answerLocalMirror";
import { replayPendingAnswers } from "./pendingAnswerReplay";
import { compareSavedAt } from "./savedAt";

export type StrayAdoptionSummary = {
  /** Stray flat segments opened this pass (unchanged ones are skipped). */
  scannedFiles: number;
  adopted: number;
  alreadyOnDisk: number;
  failed: number;
  cannotLand: number;
  /** Supervisor / on-behalf events left as they are. */
  skippedNonSelf: number;
  /** Answers landed this pass, per employee. */
  byUser: Record<string, number>;
};

type StrayRecord = { month: string; item: ItemAnswer; identity: OutboxIdentity };

function emptySummary(): StrayAdoptionSummary {
  return { scannedFiles: 0, adopted: 0, alreadyOnDisk: 0, failed: 0, cannotLand: 0, skippedNonSelf: 0, byUser: {} };
}

function addInto(total: StrayAdoptionSummary, part: StrayAdoptionSummary): void {
  total.scannedFiles += part.scannedFiles;
  total.adopted += part.adopted;
  total.alreadyOnDisk += part.alreadyOnDisk;
  total.failed += part.failed;
  total.cannotLand += part.cannotLand;
  total.skippedNonSelf += part.skippedNonSelf;
  for (const [user, count] of Object.entries(part.byUser)) total.byUser[user] = (total.byUser[user] ?? 0) + count;
}

/** `${workspace}:${month}` → the stray-file signature already processed this session. */
const processedSignatures = new Map<string, string>();

/** @internal test-only */
export function __resetStrayFlatAnswersForTests(): void {
  processedSignatures.clear();
}

function isSelfSave(event: AnswerEvent): boolean {
  return event.authority === "self" && !event.answeredOnBehalfBy && (!event.eventBy || event.eventBy === event.answeredBy);
}

function itemFromEvent(event: AnswerEvent, assignee: string): ItemAnswer | null {
  if (!event.xrayImageId || !event.answers || !event.status) return null;
  return {
    xrayImageId: event.xrayImageId,
    templateId: event.templateId ?? "",
    templateVersion: event.templateVersion ?? 0,
    answers: event.answers,
    lastSavedAt: event.lastSavedAt ?? event.eventAt,
    submittedAt: event.submittedAt ?? null,
    answeredBy: assignee,
    status: event.status,
  };
}

/** The latest self-save per (employee, case); everything else counted as skipped. */
function collectStrayRecords(month: string, events: readonly AnswerEvent[], onlyUser?: string): { byUser: Map<string, StrayRecord[]>; skippedNonSelf: number } {
  const latest = new Map<string, StrayRecord>();
  let skippedNonSelf = 0;
  for (const event of events) {
    if (event.eventType !== "item-saved") continue;
    const assignee = (event.answeredBy ?? "").trim();
    if (!assignee || (onlyUser !== undefined && assignee !== onlyUser)) continue;
    if (!isSelfSave(event)) { skippedNonSelf += 1; continue; }
    const item = itemFromEvent(event, assignee);
    if (!item) continue;
    const key = `${assignee}::${item.xrayImageId}`;
    const previous = latest.get(key);
    if (!previous || compareSavedAt(item.lastSavedAt, previous.item.lastSavedAt) > 0) {
      latest.set(key, { month, item, identity: { eventId: event.eventId, eventAt: event.eventAt } });
    }
  }
  const byUser = new Map<string, StrayRecord[]>();
  for (const record of latest.values()) {
    const list = byUser.get(record.item.answeredBy) ?? [];
    list.push(record);
    byUser.set(record.item.answeredBy, list);
  }
  return { byUser, skippedNonSelf };
}

/** Stray flat segments of a v2 month, as a change signature; null when there is nothing to do. */
async function strayFileSignature(root: DirectoryHandleLike, month: string): Promise<string | null> {
  if ((await getAnswerEventsLayout(root, month)) !== "v2") return null;
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(root, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const strays = await listDirectoryEntriesWithSize(eventsDir, ANSWER_EVENT_SEGMENT_SUFFIX);
  if (strays.length === 0) return null;
  return strays.map((e) => `${e.name}:${e.size}:${e.lastModified}`).sort().join("|");
}

/**
 * Find and land one v2 month's stray flat answers. `onlyUser` limits it to that
 * employee's own; `force` re-reads files this session already processed.
 */
export async function adoptStrayFlatAnswers(
  root: DirectoryHandleLike,
  month: string,
  options: { onlyUser?: string; force?: boolean } = {}
): Promise<StrayAdoptionSummary> {
  const summary = emptySummary();
  const signature = await strayFileSignature(root, month);
  if (signature === null) return summary;
  const memoKey = `${workspaceScopeId(root)}:${month}:${options.onlyUser ?? "*"}`;
  if (!options.force && processedSignatures.get(memoKey) === signature) return summary;

  const mainDir = await getSampleMainDir(root, month, false);
  const { events, segmentNames } = await readAnswerEventDelta(mainDir, {});
  summary.scannedFiles = segmentNames.length;
  const { byUser, skippedNonSelf } = collectStrayRecords(month, events, options.onlyUser);
  summary.skippedNonSelf = skippedNonSelf;

  let complete = true;
  for (const [user, records] of byUser) {
    const result = await replayPendingAnswers(root, user, {
      loadPending: async () => records,
      // Nothing to confirm locally: these answers were never in this browser's outbox.
      markSynced: async () => {},
    });
    if (result.skipped) { complete = false; continue; }
    summary.adopted += result.replayed;
    summary.alreadyOnDisk += result.alreadyOnDisk;
    summary.failed += result.failed;
    summary.cannotLand += result.cannotLand;
    if (result.replayed > 0) summary.byUser[user] = result.replayed;
    if (result.failed > 0 || result.cannotLand > 0) complete = false;
  }
  if (complete) processedSignatures.set(memoKey, signature);
  if (summary.adopted > 0) {
    const who = Object.entries(summary.byUser).map(([user, count]) => `${user} (${count})`).join("، ");
    logError(
      "answers:stray-flat-adopted",
      new Error(`Recovered ${summary.adopted} answer(s) in ${month} written by an outdated copy of the app: ${who}. Make sure these employees open the current shared app file.`),
      { action: "stray-flat-adopted" }
    );
  }
  return summary;
}

/** Month folders under the samples root (where answers live); none when it does not exist yet. */
async function listSampleMonthFolders(root: DirectoryHandleLike): Promise<string[]> {
  try {
    const entries = await listDirectoryEntries(await getSamplesRoot(root, false));
    return entries.filter((entry) => entry.kind === "directory").map((entry) => entry.name).sort();
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

/** Every month folder with samples. A month that fails is logged and the rest still run. */
export async function adoptStrayFlatAnswersAllMonths(
  root: DirectoryHandleLike,
  options: { onlyUser?: string; force?: boolean } = {}
): Promise<StrayAdoptionSummary> {
  const total = emptySummary();
  for (const folderName of await listSampleMonthFolders(root)) {
    try {
      addInto(total, await adoptStrayFlatAnswers(root, folderName, options));
    } catch (error) {
      if (!isNotFoundError(error)) logError("answers:stray-flat-adopt", error);
    }
  }
  return total;
}
