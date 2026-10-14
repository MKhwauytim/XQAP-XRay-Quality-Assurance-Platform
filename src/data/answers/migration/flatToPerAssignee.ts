// src/data/answers/migration/flatToPerAssignee.ts
//
// ONE-TIME, ADMIN-CONFIRMED migration of a month's flat `answers.events/` (v1)
// into per-assignee folders (v2) — spec 2026-10-13 §6 and CLAUDE.md's
// post-launch migration policy: offered on admin sign-in, never automatic,
// archives every original (moves to `_archive-v1/`), never deletes.
//
// Crash-safe by construction: `_layout.json` (the commit point) is written
// LAST. Before it exists the month is v1 (`v1-migrating` while the lock or
// `_archive-v1/` exists): v1 readers read flat + `_archive-v1/`, writers defer.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import {
  appendEventSegment,
  chunkEventsForSegmentAppends,
  utf8Length,
  type AppendOnlyEventLogConfig,
  type SegmentWriterIdentity,
} from "../../storage/appendOnlyEventLog";
import { casLoop, readBackOwnWrite } from "../../storage/casLoop";
import { mapWithConcurrency } from "../../storage/concurrency";
import { DIRECTORY_READ_CONCURRENCY, listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { bumpWorkspaceEpoch, workspaceScopeId } from "../../storage/inFlightReads";
import { unwrap, wrap, type JsonEnvelope } from "../../storage/jsonEnvelope";
import { moveFileVerified } from "../../storage/moveFileVerified";
import { readFileTextWithRetry, safeReadJson, safeRemoveJson, safeWriteJson } from "../../storage/safeWrite";
import { getDistributionDeviceId } from "../../distribution/distributionEventStore";
import {
  ANSWER_EVENTS_FOLDERS,
  answerAssigneeFolderName,
  getAnswerArchiveV1Dir,
  getAnswerEventsDir,
  getAnswerEventsLayout,
  getAssigneeAnswerEventsDir,
  noteAnswerEventsLayoutV2,
} from "../../workspace/workspacePaths";
import { ANSWER_EVENT_LOG, ANSWER_EVENT_SEGMENT_SUFFIX, sortAnswerEventsForFold, type AnswerEvent } from "../answerEventStore";
import { clearAnswerEventsCache, foldEmployeeEvents, loadLegacyAnswerSeed } from "../answerStorage";
import { v1OffsetKey } from "../v2/answerSnapshot";
import { readAnswerEventsLayoutMarker, writeAnswerEventsLayoutMarker, type AnswerEventsLayoutMarker } from "../v2/answerEventsLayout";
import { listAssigneeFolders } from "../v2/assigneeEventReader";
import { rebuildAndPersistAssigneeSnapshot } from "../v2/rebuildAssigneeSnapshot";

export const MIGRATION_LOCK_STALE_MS = 30 * 60 * 1000;
export const MIGRATION_MS_PER_SEGMENT_ESTIMATE = 150;
const MAX_STRAGGLER_PASSES = 3;

export type MigrationPhase = "lock" | "read" | "archive" | "snapshot" | "move" | "stragglers" | "commit";
export type MigrationProgress = { phase: MigrationPhase; done: number; total: number };
export type MigrateMonthOptions = {
  actor: string;
  nowMs?: () => number;
  onProgress?: (progress: MigrationProgress) => void | Promise<void>;
};
export type MigrateMonthResult =
  | { status: "migrated"; marker: AnswerEventsLayoutMarker; quarantinedLines: number }
  | { status: "nothing-to-do" }
  | { status: "locked-elsewhere"; by: string; startedAt: string };

export type QuarantinedLine = { segment: string; line: number; raw: string; reason: "unparseable" | "no-assignee" };
type AssigneeGroup = { assignee: string; events: AnswerEvent[]; segments: Map<string, number> };

type MigrationLock = { by: string; deviceId: string; startedAt: string; token: string; revision: number; _writeToken?: string };

/** Pure: spec §6 step 2's grouping. Exported for its own test. */
export function groupFlatSegmentLines(
  segments: readonly { name: string; bytes: number; text: string }[]
): { groups: Map<string, AssigneeGroup>; quarantined: QuarantinedLine[] } {
  const groups = new Map<string, AssigneeGroup>();
  const quarantined: QuarantinedLine[] = [];
  for (const segment of segments) {
    segment.text.split("\n").forEach((raw, line) => {
      if (raw.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        quarantined.push({ segment: segment.name, line, raw, reason: "unparseable" });
        return;
      }
      const event = parsed as AnswerEvent;
      const owner = (event.answeredBy ?? "").trim() || (event.eventBy ?? "").trim();
      let folder: string;
      try {
        folder = answerAssigneeFolderName(owner);
      } catch {
        quarantined.push({ segment: segment.name, line, raw, reason: "no-assignee" });
        return;
      }
      const group = groups.get(folder) ?? { assignee: owner, events: [], segments: new Map<string, number>() };
      group.events.push(event.answeredBy ? event : { ...event, answeredBy: owner });
      group.segments.set(segment.name, segment.bytes);
      groups.set(folder, group);
    });
  }
  return { groups, quarantined };
}

async function acquireMigrationLock(
  eventsDir: DirectoryHandleLike,
  actor: string,
  nowMs: number
): Promise<{ ok: true } | { ok: false; by: string; startedAt: string }> {
  const name = ANSWER_EVENTS_FOLDERS.migrationLock;
  const deviceId = getDistributionDeviceId();
  const outcome = await casLoop<{ ok: true } | { ok: false; by: string; startedAt: string }>(
    async (writeToken) => {
      const existing = await safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name);
      const held = existing.ok ? unwrap<MigrationLock>(existing.value) : null;
      const fresh = held !== null && nowMs - Date.parse(held.startedAt) < MIGRATION_LOCK_STALE_MS;
      if (held && fresh && !(held.by === actor && held.deviceId === deviceId)) {
        return { done: true, result: { ok: false, by: held.by, startedAt: held.startedAt } };
      }
      const previousRevision = held?.revision ?? 0;
      const next: MigrationLock = { by: actor, deviceId, startedAt: new Date(nowMs).toISOString(), token: writeToken, revision: previousRevision + 1, _writeToken: writeToken };
      const written = await safeWriteJson(eventsDir, name, wrap(next, previousRevision));
      const verdict = await readBackOwnWrite(
        written,
        () => safeReadJson<JsonEnvelope<MigrationLock>>(eventsDir, name),
        (verify) => verify.ok && unwrap<MigrationLock>(verify.value)._writeToken === writeToken,
        "answers:migration-lock"
      );
      return verdict === "not-mine" ? { done: false } : { done: true, result: { ok: true } };
    },
    { context: "answers:migration-lock", maxRetries: 3, baseDelayMs: 150 }
  );
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome;
}

async function listFlatSegmentNames(eventsDir: DirectoryHandleLike): Promise<string[]> {
  return (await listDirectoryEntries(eventsDir))
    .filter((entry) => entry.kind === "file" && entry.name.endsWith(ANSWER_EVENT_SEGMENT_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

type FlatRead =
  | { status: "ok"; name: string; bytes: number; text: string }
  | { status: "missing"; name: string }
  | { status: "unopenable"; name: string };

async function readFlatSegments(eventsDir: DirectoryHandleLike, names: readonly string[], options: MigrateMonthOptions): Promise<FlatRead[]> {
  let done = 0;
  const reads = await mapWithConcurrency(names, DIRECTORY_READ_CONCURRENCY, async (name): Promise<FlatRead> => {
    try {
      const text = await readFileTextWithRetry(eventsDir, name);
      return text === null ? { status: "missing", name } : { status: "ok", name, bytes: utf8Length(text), text };
    } catch (error) {
      logError("answers:migration:unopenable", error, { action: name });
      return { status: "unopenable", name };
    }
  });
  // Progress is reported after every read finished, so a crash injected at
  // "read" happens before any write (spec §6 step 2).
  while (done < reads.length) {
    done += 1;
    await options.onProgress?.({ phase: "read", done, total: reads.length });
  }
  return reads;
}

function migrationWriter(root: DirectoryHandleLike, month: string, folder: string, kind: "v1merge" | "quarant"): { writer: SegmentWriterIdentity; config: AppendOnlyEventLogConfig } {
  return {
    // Scoped per folder: the module-level seq memos are keyed on scopeId.
    writer: { deviceId: kind, sessionId: "migrat", scopeId: `${workspaceScopeId(root)}|${month}|${folder}|${kind}`, stable: false },
    config: {
      ...ANSWER_EVENT_LOG,
      consumerNamespace: "ansmig",
      eventsDirName: kind === "v1merge" ? ANSWER_EVENTS_FOLDERS.assigneeArchive : ANSWER_EVENTS_FOLDERS.quarantine,
      baseNamePrefix: kind === "v1merge" ? "v1" : "unparsed-v1",
    },
  };
}

async function appendToAssigneeArchive(root: DirectoryHandleLike, month: string, folder: string, group: AssigneeGroup): Promise<void> {
  const assigneeDir = await getAssigneeAnswerEventsDir(root, month, group.assignee, true);
  const { writer, config } = migrationWriter(root, month, folder, "v1merge");
  for (const chunk of chunkEventsForSegmentAppends(sortAnswerEventsForFold([...group.events]))) {
    await appendEventSegment<AnswerEvent>(assigneeDir, chunk, writer, config);
  }
}

/** Quarantined lines are wrapped as JSON records (the raw text is kept verbatim in `raw`; the original segment itself is archived untouched in `_archive-v1/`). */
async function writeQuarantine(root: DirectoryHandleLike, month: string, eventsDir: DirectoryHandleLike, lines: readonly QuarantinedLine[], nowIso: string): Promise<void> {
  const { writer, config } = migrationWriter(root, month, ANSWER_EVENTS_FOLDERS.quarantine, "quarant");
  const records = lines.map((line) => ({ quarantinedFrom: line.segment, line: line.line, reason: line.reason, raw: line.raw, quarantinedAt: nowIso }));
  for (const chunk of chunkEventsForSegmentAppends(records)) await appendEventSegment(eventsDir, chunk, writer, config);
}

type MigrationState = { processed: Map<string, number>; unmovable: Set<string>; moved: number; quarantinedLines: number };

async function migratePass(
  root: DirectoryHandleLike,
  month: string,
  eventsDir: DirectoryHandleLike,
  archiveV1Dir: DirectoryHandleLike,
  names: readonly string[],
  state: MigrationState,
  options: MigrateMonthOptions,
  now: () => number
): Promise<void> {
  const reads = await readFlatSegments(eventsDir, names, options);
  const fresh: { name: string; bytes: number; text: string }[] = [];
  for (const read of reads) {
    if (read.status === "missing") continue;
    if (read.status === "unopenable") state.unmovable.add(read.name);
    else if (state.processed.get(read.name) === read.bytes) state.unmovable.add(read.name); // folded, but its move keeps failing
    else fresh.push(read);
  }
  const { groups, quarantined } = groupFlatSegmentLines(fresh);
  if (quarantined.length > 0) {
    await writeQuarantine(root, month, eventsDir, quarantined, new Date(now()).toISOString());
    state.quarantinedLines += quarantined.length;
  }
  let done = 0;
  for (const [folder, group] of groups) {
    await appendToAssigneeArchive(root, month, folder, group);
    done += 1;
    await options.onProgress?.({ phase: "archive", done, total: groups.size });
  }
  done = 0;
  for (const group of groups.values()) {
    const extraOffsets = Object.fromEntries([...group.segments].map(([name, bytes]) => [v1OffsetKey(name), bytes]));
    await rebuildAndPersistAssigneeSnapshot(root, month, group.assignee, {
      actor: options.actor,
      loadLegacySeed: () => loadLegacyAnswerSeed(root, month, group.assignee),
      foldFn: foldEmployeeEvents,
      extraOffsets,
      nowMs: now(),
    });
    done += 1;
    await options.onProgress?.({ phase: "snapshot", done, total: groups.size });
  }
  for (const segment of fresh) state.processed.set(segment.name, segment.bytes);
  done = 0;
  for (const segment of fresh) {
    const outcome = await moveFileVerified(eventsDir, segment.name, archiveV1Dir, segment.bytes);
    if (outcome.status === "moved") state.moved += 1;
    done += 1;
    await options.onProgress?.({ phase: "move", done, total: fresh.length });
  }
}

export async function migrateMonthToPerAssignee(
  root: DirectoryHandleLike,
  month: string,
  options: MigrateMonthOptions
): Promise<MigrateMonthResult> {
  const now = options.nowMs ?? Date.now;
  const layout = await getAnswerEventsLayout(root, month);
  if (layout === "absent") return { status: "nothing-to-do" };
  const eventsDir = await getAnswerEventsDir(root, month, false);
  const prior = layout === "v2" ? await readAnswerEventsLayoutMarker(root, month) : null;
  const state: MigrationState = { processed: new Map(), unmovable: new Set(prior?.unmovable ?? []), moved: 0, quarantinedLines: 0 };
  let names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  if (layout === "v2" && names.length === 0) return { status: "nothing-to-do" };

  await options.onProgress?.({ phase: "lock", done: 0, total: 1 });
  const lock = await acquireMigrationLock(eventsDir, options.actor, now());
  if (!lock.ok) return { status: "locked-elsewhere", by: lock.by, startedAt: lock.startedAt };
  const archiveV1Dir = await getAnswerArchiveV1Dir(root, month, true);

  for (let pass = 0; pass < MAX_STRAGGLER_PASSES && names.length > 0; pass += 1) {
    if (pass > 0) await options.onProgress?.({ phase: "stragglers", done: pass, total: MAX_STRAGGLER_PASSES - 1 });
    await migratePass(root, month, eventsDir, archiveV1Dir, names, state, options, now);
    names = (await listFlatSegmentNames(eventsDir)).filter((name) => !state.unmovable.has(name));
  }
  for (const name of names) state.unmovable.add(name);

  await options.onProgress?.({ phase: "commit", done: 0, total: 1 });
  const marker: AnswerEventsLayoutMarker = {
    layout: "per-assignee",
    schemaVersion: 1,
    migratedAt: new Date(now()).toISOString(),
    migratedBy: options.actor,
    flatSegmentsArchived: (prior?.flatSegmentsArchived ?? 0) + state.moved,
    assignees: (await listAssigneeFolders(root, month)).length,
    unmovable: [...state.unmovable].sort(),
    origin: prior?.origin ?? "migration",
  };
  await writeAnswerEventsLayoutMarker(eventsDir, marker);
  await safeRemoveJson(eventsDir, ANSWER_EVENTS_FOLDERS.migrationLock);
  noteAnswerEventsLayoutV2(root, month);
  bumpWorkspaceEpoch(root, month);
  clearAnswerEventsCache();
  return { status: "migrated", marker, quarantinedLines: state.quarantinedLines };
}
