// src/data/answers/v2/v2TestFixtures.ts
// TEST-ONLY helpers for layout-v2 tests. Never imported by production code.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { encodeEventLine } from "../../storage/appendOnlyEventLog";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { ANSWER_EVENTS_FOLDERS, getAnswerEventsDir, getAssigneeAnswerEventsDir } from "../../workspace/workspacePaths";
import type { AnswerEvent } from "../answerEventStore";

export const V2_MONTH = "5-may-2026";

/** An `item-saved` for `assignee`, `minute` minutes after 2026-05-02T08:00Z. */
export function savedEvent(id: string, minute: number, overrides: Partial<AnswerEvent> = {}, assignee = "emp1"): AnswerEvent {
  return {
    eventId: id,
    eventType: "item-saved",
    eventAt: new Date(Date.UTC(2026, 4, 2, 8, 0) + minute * 60_000).toISOString(),
    eventBy: assignee,
    authority: "self",
    xrayImageId: `X-${id}`,
    answers: [{ fieldId: "f", value: id }],
    status: "draft",
    answeredBy: assignee,
    ...overrides,
  };
}

/** The empty-legacy migration seed every chain starts with. */
export function seedEvent(assignee = "emp1"): AnswerEvent {
  return { eventId: `seed-${assignee}`, eventType: "migration-seed", eventAt: "2026-05-01T00:00:00.000Z", eventBy: assignee, authority: "self", answeredBy: assignee, legacyContentHash: "" };
}

export async function writeText(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable!();
  await writable.write(text);
  await writable.close();
}

export async function readText(dir: DirectoryHandleLike, name: string): Promise<string> {
  return (await (await dir.getFileHandle(name, { create: false })).getFile()).text();
}

/** Write a raw segment `{name}` with `events` into `answers.events/{assignee}/`. */
export async function writeAssigneeSegment(root: DirectoryHandleLike, assignee: string, name: string, events: readonly AnswerEvent[], month = V2_MONTH): Promise<DirectoryHandleLike> {
  const dir = await getAssigneeAnswerEventsDir(root, month, assignee, true);
  await writeText(dir, name, events.map(encodeEventLine).join(""));
  return dir;
}

/** Append raw lines to an existing segment, exactly as appendEventSegment's rewrite leaves it (prefix preserved). */
export async function appendToSegment(dir: DirectoryHandleLike, name: string, events: readonly AnswerEvent[]): Promise<void> {
  const before = await readText(dir, name);
  await writeText(dir, name, before + events.map(encodeEventLine).join(""));
}

/** Stamp a month v2 (marker only — what a new month gets). */
export async function makeV2Month(root: DirectoryHandleLike, month = V2_MONTH): Promise<void> {
  const events = await getAnswerEventsDir(root, month, true);
  await writeText(events, ANSWER_EVENTS_FOLDERS.layoutMarker, JSON.stringify({ layout: "per-assignee", schemaVersion: 1, migratedAt: "2026-05-01T00:00:00.000Z", migratedBy: "test", flatSegmentsArchived: 0, assignees: 0, unmovable: [], origin: "new-month" }));
}

/** Keep a fresh month on the v1 flat layout (an existing `answers.events/` with no marker). */
export async function makeV1Month(root: DirectoryHandleLike, month = V2_MONTH): Promise<void> {
  await getAnswerEventsDir(root, month, true);
}

export async function fileNames(dir: DirectoryHandleLike, suffix = ".ndjson"): Promise<string[]> {
  return (await listDirectoryEntries(dir)).filter((e) => e.kind === "file" && e.name.endsWith(suffix)).map((e) => e.name).sort();
}
