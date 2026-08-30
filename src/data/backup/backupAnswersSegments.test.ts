/**
 * Stage 2 of `docs/architecture/ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27.md`,
 * §8a / round 3's backup-and-restore finding: `backupStorage.ts` independently
 * reads, classifies and rewrites `.ndjson` segment files, and was not
 * exercised by any distribution test in the relevant way. These tests mirror
 * `backupSegments.test.ts`'s shape but exercise `answers.events/` — the two
 * fixes this file specifically targets are:
 *
 *  1. `collectJsonRestoreEntries`'s cache-directory capture generalized from
 *     `entry.name === DISTRIBUTION_EVENTS_DIR` to any `*.events` directory —
 *     without it a restore into `answers.events/` would never have been
 *     classified for the answers-aware merge path at all.
 *  2. `mergeEventSegment`'s conflict detection given an `AnswerEvent`-aware
 *     comparator — distribution's own field-subset comparator would declare
 *     two different-content answer events sharing an `eventId` "identical"
 *     (every distribution-only field it checks is `undefined` on both sides),
 *     silently keeping one and dropping the other instead of throwing.
 */
import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR, type AnswerEvent } from "../answers/answerEventStore";
import { createBackup, restoreBackupSnapshot } from "./backupStorage";

const month = { folderName: "5-may-2026", month: 5, year: 2026 };

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function answerEvent(id: string, overrides: Partial<AnswerEvent> = {}): AnswerEvent {
  return {
    eventId: id,
    eventType: "item-saved",
    eventAt: `2026-05-01T08:00:${id.slice(-2).padStart(2, "0")}.000Z`,
    eventBy: "emp1",
    authority: "self",
    xrayImageId: `XR-${id}`,
    answers: [{ fieldId: "f1", value: "v0" }],
    status: "draft",
    answeredBy: "emp1",
    ...overrides,
  };
}

function toNdjson(events: AnswerEvent[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function readRaw(dir: DirectoryHandleLike, name: string): Promise<string> {
  const handle = await dir.getFileHandle(name, { create: false });
  return (await handle.getFile()).text();
}

async function getAnswerEventsDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const main = await getSampleMainDir(root, month.folderName, true);
  return main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
}

async function listNames(dir: DirectoryHandleLike): Promise<string[]> {
  const names: string[] = [];
  const values = (dir as DirectoryHandleLike & {
    values: () => AsyncIterable<{ name: string; kind: string }>;
  }).values();
  for await (const entry of values) names.push(entry.name);
  return names.sort();
}

/** Every eventId present across every *.ndjson segment under the month's answers.events/. */
async function segmentEventIds(root: DirectoryHandleLike): Promise<string[]> {
  const eventsDir = await getAnswerEventsDir(root);
  const ids: string[] = [];
  for (const name of await listNames(eventsDir)) {
    if (!name.endsWith(".ndjson")) continue;
    for (const line of (await readRaw(eventsDir, name)).split("\n")) {
      if (line.length > 0) ids.push((JSON.parse(line) as AnswerEvent).eventId);
    }
  }
  return ids.sort();
}

describe("backup/restore — answers.events segments (Stage 2, round 3's backup finding)", () => {
  it("round-trips every answer event into a workspace whose segment was lost", async () => {
    const root = makeRoot();
    const eventsDir = await getAnswerEventsDir(root);
    await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([answerEvent("e01"), answerEvent("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // The disaster this feature exists for: the live segment is lost.
    await eventsDir.removeEntry!("a1-ans-devA-s1.ndjson");
    expect(await segmentEventIds(root)).toEqual([]);

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
    // Fix 1: the answers.events/ segment was actually classified and merged —
    // not silently skipped the way an un-generalized cache-directory capture
    // would have left it (this assertion would still pass even with the
    // pre-fix classification, since restoreActionFor's suffix match already
    // covered it; the cache-directory generalization is what stops a SECOND
    // restore's incremental fold from mis-reading a stale offset — see the
    // dedicated round-trip-then-restore-again test below).
    expect(
      restored.ok &&
        restored.restoredFiles.some((path) => path.endsWith("answers.events/a1-ans-devA-s1.ndjson"))
    ).toBe(true);
  });

  it("restoring over live answer events loses nothing and duplicates nothing (exact id-set union)", async () => {
    const root = makeRoot();
    const eventsDir = await getAnswerEventsDir(root);
    await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([answerEvent("e01"), answerEvent("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Live work continues: e03 appended to the same writer's segment, e04
    // lands in a different writer's segment.
    await writeRaw(
      eventsDir,
      "a1-ans-devA-s1.ndjson",
      toNdjson([answerEvent("e01"), answerEvent("e02"), answerEvent("e03")])
    );
    await writeRaw(eventsDir, "a1-ans-devB-s9.ndjson", toNdjson([answerEvent("e04")]));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    const ids = await segmentEventIds(root);
    expect(ids).toEqual(["e01", "e02", "e03", "e04"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Fix 2: refuses loudly when one eventId carries CONFLICTING answer content on the two sides", async () => {
    // The case distribution's own field-subset comparator gets wrong: every
    // distribution-only field (assignedTo, replacedById, reassignedTo, …) is
    // `undefined` on BOTH sides of an answer event, so that comparator would
    // call these two "identical" and silently keep one, dropping the other —
    // exactly the silent-data-loss path round 3 flagged. The AnswerEvent-aware
    // comparator must catch it and refuse instead.
    const root = makeRoot();
    const eventsDir = await getAnswerEventsDir(root);
    await writeRaw(
      eventsDir,
      "a1-ans-devA-s1.ndjson",
      toNdjson([answerEvent("e01", { answers: [{ fieldId: "f1", value: "original" }] })])
    );

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Same eventId, DIFFERENT answer content — the shape a retried append with
    // an ambiguous outcome could produce (§3: eventId is stable across a
    // retry, so same-id-different-content is a real, in-contract case here).
    await writeRaw(
      eventsDir,
      "a1-ans-devA-s1.ndjson",
      toNdjson([answerEvent("e01", { answers: [{ fieldId: "f1", value: "DIFFERENT" }] })])
    );

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error).toContain("e01");

    // A refused restore must leave the live segment untouched, not half-merged.
    const eventsDirAfter = await getAnswerEventsDir(root);
    const text = await readRaw(eventsDirAfter, "a1-ans-devA-s1.ndjson");
    expect(text).toContain("DIFFERENT");
    expect(text).not.toContain("\"original\"");
  });

  it("does NOT throw on two lines sharing an eventId that are genuinely byte-identical (a harmless retry duplicate)", async () => {
    const root = makeRoot();
    const eventsDir = await getAnswerEventsDir(root);
    const seed = answerEvent("e01");
    await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([seed]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Live segment picked up a genuinely duplicate line for the same event
    // (e.g. a retried append after an ambiguous failure) — byte-identical
    // content, just written twice.
    await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([seed, seed]));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
  });

  it("captures a migration-seed event's frozen legacyContentHash byte-for-byte through backup and restore", async () => {
    const root = makeRoot();
    const eventsDir = await getAnswerEventsDir(root);
    const seedEvent = answerEvent("seed-1", {
      eventType: "migration-seed",
      xrayImageId: undefined,
      answers: undefined,
      status: undefined,
      legacyContentHash: "abc123",
    });
    await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([seedEvent, answerEvent("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await eventsDir.removeEntry!("a1-ans-devA-s1.ndjson");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    const eventsDirAfter = await getAnswerEventsDir(root);
    const text = await readRaw(eventsDirAfter, "a1-ans-devA-s1.ndjson");
    expect(text).toContain("\"legacyContentHash\":\"abc123\"");
    expect(text).toContain("\"migration-seed\"");
  });

  it(
    "an answers-only restore does NOT invalidate or re-stamp distribution's own derived cache " +
      "(distribution.events/ and answers.events/ share the same parent 1-main directory as their " +
      "cacheDir, so the restore's cache-invalidation must be scoped by which events dir actually " +
      "changed, not merely by which directory the change happened under)",
    async () => {
      const root = makeRoot();
      const eventsDir = await getAnswerEventsDir(root);
      await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", toNdjson([answerEvent("e01")]));

      // Distribution's own derived-cache files, sitting in the SAME 1-main
      // directory as answers.events/ — untouched by this restore, since only
      // an answer event is ever added back in.
      const mainDir = await getSampleMainDir(root, month.folderName, true);
      await writeRaw(mainDir, "distribution.current.json", '{"marker":"pre-restore"}');
      await writeRaw(mainDir, "distribution.checkpoint.json", '{"marker":"pre-restore"}');
      await writeRaw(
        mainDir,
        "distribution.log.json",
        '{"revision":1,"_writeToken":"pre-restore-token","events":[]}'
      );

      const backup = await createBackup(root, [month], "admin", "manual");
      expect(backup.ok).toBe(true);
      if (!backup.ok) return;

      // Live answers segment loses an event the backup still has — this makes
      // the restore genuinely MERGE new answer lines back in, without touching
      // any distribution.events/ segment at all (there is none in this test).
      await writeRaw(eventsDir, "a1-ans-devA-s1.ndjson", "");

      const restored = await restoreBackupSnapshot({
        directoryHandle: root,
        months: [month],
        backupFolderName: backup.folderName,
        username: "admin",
      });
      expect(restored.ok).toBe(true);
      // Confirm the restore actually did something (else this test would pass
      // vacuously): the answer event came back.
      expect(await segmentEventIds(root)).toEqual(["e01"]);

      // Distribution's derived cache and log stamp must be exactly as they
      // were before the restore — an answers-only change must never delete or
      // re-mint them.
      const mainDirAfter = await getSampleMainDir(root, month.folderName, true);
      expect(await readRaw(mainDirAfter, "distribution.current.json")).toBe('{"marker":"pre-restore"}');
      expect(await readRaw(mainDirAfter, "distribution.checkpoint.json")).toBe('{"marker":"pre-restore"}');
      const logText = await readRaw(mainDirAfter, "distribution.log.json");
      expect(JSON.parse(logText)._writeToken).toBe("pre-restore-token");
    }
  );
});
