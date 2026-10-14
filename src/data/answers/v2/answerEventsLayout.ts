// src/data/answers/v2/answerEventsLayout.ts
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { isNotFoundError } from "../../storage/transientFileErrors";
import {
  ANSWER_EVENTS_FOLDERS,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  noteAnswerEventsLayoutV2,
} from "../../workspace/workspacePaths";
import { ANSWER_EVENT_SEGMENT_SUFFIX } from "../answerEventStore";

/** `answers.events/_layout.json` (spec §4). `origin` is beyond the spec: it tells a stamped new month from a migrated one. */
export type AnswerEventsLayoutMarker = {
  layout: "per-assignee";
  schemaVersion: 1;
  migratedAt: string;
  migratedBy: string;
  flatSegmentsArchived: number;
  assignees: number;
  unmovable: string[];
  /**
   * Subset of `unmovable` whose events were never folded into an assignee
   * folder (unopenable, or landed after the last listing). Optional: markers
   * written before this field existed carry none (treated as all folded).
   */
  unfolded?: string[];
  origin: "migration" | "new-month";
};

export async function readAnswerEventsLayoutMarker(root: DirectoryHandleLike, month: string): Promise<AnswerEventsLayoutMarker | null> {
  let eventsDir: DirectoryHandleLike;
  try {
    eventsDir = await getAnswerEventsDir(root, month, false);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const read = await safeReadJson<JsonEnvelope<AnswerEventsLayoutMarker>>(eventsDir, ANSWER_EVENTS_FOLDERS.layoutMarker);
  return read.ok ? unwrap<AnswerEventsLayoutMarker>(read.value) : null;
}

export async function writeAnswerEventsLayoutMarker(eventsDir: DirectoryHandleLike, marker: AnswerEventsLayoutMarker): Promise<void> {
  await safeWriteJson(eventsDir, ANSWER_EVENTS_FOLDERS.layoutMarker, wrap(marker));
}

/**
 * TEST-ONLY: keep brand-new months on the v1 flat layout. Suites written before
 * layout v2 inspect the flat `answers.events/` folder (and count its file
 * operations) for a month they create on the fly; pinning them here keeps their
 * operation counts byte-identical instead of pre-creating folders per test.
 */
let pinNewMonthsToV1ForTests = false;
export function __pinNewAnswerMonthsToV1ForTests(on: boolean): void {
  pinNewMonthsToV1ForTests = on;
}

/**
 * The layout a WRITE must use, probed fresh (v2 is cached monotone in
 * workspacePaths). A month with no `answers.events/` yet has no v1 data to
 * migrate, so it is stamped v2 before its first append — unless a flat segment
 * appeared between the probe and the create (a racing writer), in which case
 * it stays v1 and the admin prompt offers the migration.
 */
export async function ensureAnswerEventsLayoutForWrite(
  root: DirectoryHandleLike,
  month: string,
  actor: string
): Promise<"v1" | "v1-migrating" | "v2"> {
  const layout = await getAnswerEventsLayout(root, month);
  if (layout !== "absent") return layout;
  if (pinNewMonthsToV1ForTests) return "v1";
  const eventsDir = await getAnswerEventsDir(root, month, true);
  const flat = (await listDirectoryEntries(eventsDir)).some(
    (entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX)
  );
  if (flat) return "v1";
  await writeAnswerEventsLayoutMarker(eventsDir, {
    layout: "per-assignee",
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    migratedBy: actor,
    flatSegmentsArchived: 0,
    assignees: 0,
    unmovable: [],
    origin: "new-month",
  });
  noteAnswerEventsLayoutV2(root, month);
  return "v2";
}
