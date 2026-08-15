import { describe, expect, it } from "vitest";

import {
  clearSimulatedFaults,
  createMemoryDirectory,
  setSimulatedFaults,
} from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { createBackup, loadArchiveStatus, restoreBackupSnapshot } from "./backupStorage";

const month = { folderName: "5-may-2026", month: 5, year: 2026 };

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function event(id: string, overrides: Partial<DistributionEvent> = {}): DistributionEvent {
  return {
    eventId: id,
    eventType: "assigned",
    xrayImageId: `XR-${id}`,
    assignedTo: "employee01",
    eventAt: `2026-05-01T08:00:${id.slice(-2).padStart(2, "0")}.000Z`,
    eventBy: "admin",
    ...overrides,
  };
}

function toNdjson(events: DistributionEvent[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

/** Raw text write that deliberately bypasses safeWriteJson — segments are NDJSON, not envelopes. */
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

async function getEventsDir(root: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  const main = await getSampleMainDir(root, month.folderName, true);
  return main.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
}

async function listNames(dir: DirectoryHandleLike): Promise<string[]> {
  const names: string[] = [];
  const values = (dir as DirectoryHandleLike & {
    values: () => AsyncIterable<{ name: string; kind: string }>;
  }).values();
  for await (const entry of values) names.push(entry.name);
  return names.sort();
}

/** Every eventId present across every *.ndjson segment under the month's distribution.events/. */
async function segmentEventIds(root: DirectoryHandleLike): Promise<string[]> {
  const eventsDir = await getEventsDir(root);
  const ids: string[] = [];
  for (const name of await listNames(eventsDir)) {
    if (!name.endsWith(".ndjson")) continue;
    for (const line of (await readRaw(eventsDir, name)).split("\n")) {
      if (line.length > 0) ids.push((JSON.parse(line) as DistributionEvent).eventId);
    }
  }
  return ids.sort();
}

async function backupJsonDir(
  root: DirectoryHandleLike,
  folderName: string
): Promise<DirectoryHandleLike> {
  const system = await root.getDirectoryHandle("5-system", { create: false });
  const backups = await system.getDirectoryHandle("backups", { create: false });
  const backup = await backups.getDirectoryHandle(folderName, { create: false });
  return backup.getDirectoryHandle("json", { create: false });
}

async function backupEventsDir(
  root: DirectoryHandleLike,
  folderName: string
): Promise<DirectoryHandleLike> {
  const json = await backupJsonDir(root, folderName);
  const samples = await json.getDirectoryHandle("2-samples", { create: false });
  const monthDir = await samples.getDirectoryHandle(month.folderName, { create: false });
  const main = await monthDir.getDirectoryHandle("1-main", { create: false });
  return main.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
}

describe("backup — distribution event segments are captured (*.ndjson)", () => {
  it("copies *.ndjson segments and lists them in the manifest", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const result = await createBackup(root, [month], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      result.manifest.jsonFilesBackedUp.some((p) => p.endsWith("distribution.events/devA-s1.ndjson"))
    ).toBe(true);

    const copied = await readRaw(await backupEventsDir(root, result.folderName), "devA-s1.ndjson");
    expect(copied).toBe(toNdjson([event("e01"), event("e02")]));
  });

  it("captures N segments per writer session (forward-compatible with segment rotation)", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1-0.ndjson", toNdjson([event("e01")]));
    await writeRaw(eventsDir, "devA-s1-1.ndjson", toNdjson([event("e02")]));
    await writeRaw(eventsDir, "devA-s1-2.ndjson", toNdjson([event("e03")]));

    const result = await createBackup(root, [month], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await listNames(await backupEventsDir(root, result.folderName))).toEqual([
      "devA-s1-0.ndjson",
      "devA-s1-1.ndjson",
      "devA-s1-2.ndjson",
    ]);
  });

  it("does not capture .bak / .tmp siblings of either family", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));
    await writeRaw(eventsDir, "devA-s1.ndjson.bak", toNdjson([event("e99")]));
    await writeRaw(eventsDir, "devA-s1.ndjson.tmp", toNdjson([event("e98")]));
    await writeRaw(eventsDir, "stray.json.bak", "{}");
    await writeRaw(eventsDir, "notes.txt", "ignored");

    const result = await createBackup(root, [month], "admin", "manual");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await listNames(await backupEventsDir(root, result.folderName))).toEqual([
      "devA-s1.ndjson",
    ]);
  });
});

describe("restore — event segments merge rather than replace", () => {
  it("round-trips every event into a workspace whose segments were wiped", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Simulate the disaster this feature exists for: the live segment is lost.
    await eventsDir.removeEntry!("devA-s1.ndjson");
    expect(await segmentEventIds(root)).toEqual([]);

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
  });

  it("restoring over live events loses nothing and duplicates nothing (exact id-set union)", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Live work continues after the backup: e03 is appended to the SAME segment
    // (same writer session) and e04 lands in a different writer's segment.
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02"), event("e03")]));
    await writeRaw(eventsDir, "devB-s9.ndjson", toNdjson([event("e04")]));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    // Union, with no id appearing twice.
    const ids = await segmentEventIds(root);
    expect(ids).toEqual(["e01", "e02", "e03", "e04"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("re-adds a backed-up event that was deleted from a live segment", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Live segment truncated (the corruption a restore is meant to undo).
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
  });

  it("refuses loudly when one eventId carries conflicting content on the two sides", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await writeRaw(
      eventsDir,
      "devA-s1.ndjson",
      toNdjson([event("e01", { assignedTo: "someone-else" })])
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
    expect(await segmentEventIds(root)).toEqual(["e01"]);
  });

  it("merges every segment when one session spans several rotated files", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1-0.ndjson", toNdjson([event("e01")]));
    await writeRaw(eventsDir, "devA-s1-1.ndjson", toNdjson([event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await eventsDir.removeEntry!("devA-s1-1.ndjson");
    await writeRaw(eventsDir, "devA-s1-2.ndjson", toNdjson([event("e03")]));

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await segmentEventIds(root)).toEqual(["e01", "e02", "e03"]);
  });
});

describe("restore — derived distribution files never outrun their events", () => {
  it("drops the live distribution.current.json cache when a segment actually changed", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // A cache derived from a LATER, smaller view of the log.
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));
    await safeWriteJson(mainDir, "distribution.current.json", {
      monthFolderName: month.folderName,
      entries: [],
      foldCheckpoint: { segmentOffsets: { "devA-s1.ndjson": 999 } },
    });

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    // The merge re-added e02, so the stale cache (and its byte offsets) must be gone.
    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
    expect(await listNames(mainDir)).not.toContain("distribution.current.json");
  });

  it("drops the live distribution.checkpoint.json sidecar when a segment actually changed", async () => {
    // The single most dangerous file in a restore. Its segmentOffsets say
    // "already folded up to this byte"; a merge that re-adds events shifts
    // those bytes, so a checkpoint left behind makes the incremental reader
    // skip straight past the re-added events — silent loss, with a cache that
    // claims to be current. (Same reasoning as distribution.current.json above,
    // but the checkpoint is now a SEPARATE file and has to be named separately
    // in the delete list — classification here is by exact filename.)
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));
    await safeWriteJson(mainDir, "distribution.current.json", {
      monthFolderName: month.folderName,
      entries: [],
      eventSetId: "d1:1:aaaa:aaaa",
    });
    await safeWriteJson(mainDir, "distribution.checkpoint.json", {
      segmentOffsets: { "devA-s1.ndjson": 999 },
      legacyEventFileNames: [],
      knownEventIds: ["e01"],
      quotaFacts: { assignmentCounts: {}, firstAssignments: {}, latestStoredQuotas: {} },
      deriveVersion: 2,
      eventSetId: "d1:1:aaaa:aaaa",
    });

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
    const names = await listNames(mainDir);
    expect(names).not.toContain("distribution.checkpoint.json");
    expect(names).not.toContain("distribution.current.json");
  });

  it("never restores a backed-up distribution.checkpoint.json over the live workspace", async () => {
    // Derived state is skipped at collection time, so the backup's copy can
    // never reintroduce byte offsets for a segment layout that no longer
    // exists — not even into a workspace that currently has no checkpoint.
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));
    await safeWriteJson(mainDir, "distribution.checkpoint.json", {
      segmentOffsets: { "devA-s1.ndjson": 123 },
      legacyEventFileNames: [],
      knownEventIds: ["e01"],
      quotaFacts: { assignmentCounts: {}, firstAssignments: {}, latestStoredQuotas: {} },
      deriveVersion: 2,
      eventSetId: "d1:1:aaaa:aaaa",
    });

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await mainDir.removeEntry!("distribution.checkpoint.json");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await listNames(mainDir)).not.toContain("distribution.checkpoint.json");
    // …and it is not reported as a restored file either.
    expect(restored.ok && restored.restoredFiles.some((path) => path.includes("distribution.checkpoint.json")))
      .toBe(false);
  });

  it("keeps a live distribution.current.json when the restore added no events", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await safeWriteJson(mainDir, "distribution.current.json", {
      monthFolderName: month.folderName,
      entries: [],
    });

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await listNames(mainDir)).toContain("distribution.current.json");
  });

  it("never overwrites a live distribution.log.json with the backup's older projection", async () => {
    const root = makeRoot();
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: month.folderName,
      revision: 1,
      events: [event("e01")],
    });

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: month.folderName,
      revision: 2,
      events: [event("e01"), event("e02")],
    });

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    const text = await readRaw(mainDir, "distribution.log.json");
    expect(text).toContain("e02");
  });

  it("restores distribution.log.json into a workspace that has none", async () => {
    const root = makeRoot();
    const mainDir = await getSampleMainDir(root, month.folderName, true);
    await safeWriteJson(mainDir, "distribution.log.json", {
      monthFolderName: month.folderName,
      revision: 1,
      events: [event("e01")],
    });

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    await mainDir.removeEntry!("distribution.log.json");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);
    expect(await readRaw(mainDir, "distribution.log.json")).toContain("e01");
  });
});

describe("restore — an incomplete backup is refused, not silently half-applied", () => {
  it("refuses a backup folder whose completion sentinel is missing", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const system = await root.getDirectoryHandle("5-system", { create: false });
    const backups = await system.getDirectoryHandle("backups", { create: false });
    const backupDir = await backups.getDirectoryHandle(backup.folderName, { create: false });
    await backupDir.removeEntry!("backup.complete.json");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error).toContain(backup.folderName);
  });

  it("refuses the partial folder left behind by a backup that failed mid-walk", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    // The share drops out permanently while the copy walk is reading segments,
    // so createBackup fails — but the half-written backup folder stays on disk.
    setSimulatedFaults(root, [
      { operation: "getFile", nameSuffix: ".ndjson", times: Number.POSITIVE_INFINITY },
    ]);
    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(false);
    clearSimulatedFaults(root);

    const system = await root.getDirectoryHandle("5-system", { create: false });
    const backups = await system.getDirectoryHandle("backups", { create: false });
    const [partialFolder] = await listNames(backups);
    expect(partialFolder).toBeDefined();

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: partialFolder!,
      username: "admin",
    });
    expect(restored.ok).toBe(false);

    // And the live events are untouched — a refused restore mutates nothing.
    expect(await segmentEventIds(root)).toEqual(["e01", "e02"]);
  });

  it("refuses a backup folder whose manifest is missing", async () => {
    const root = makeRoot();
    await writeRaw(await getEventsDir(root), "devA-s1.ndjson", toNdjson([event("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    const system = await root.getDirectoryHandle("5-system", { create: false });
    const backups = await system.getDirectoryHandle("backups", { create: false });
    const backupDir = await backups.getDirectoryHandle(backup.folderName, { create: false });
    await backupDir.removeEntry!("backup.manifest.json");

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(false);
  });
});

describe("archive status — segment presence is reported honestly", () => {
  it("reports hasDistribution when only event segments exist (no derived cache)", async () => {
    const root = makeRoot();
    await writeRaw(await getEventsDir(root), "devA-s1.ndjson", toNdjson([event("e01")]));

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status!.hasDistribution).toBe(true);
  });

  it("reports no distribution when neither a cache nor any segment exists", async () => {
    const root = makeRoot();
    await getSampleMainDir(root, month.folderName, true);

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status!.hasDistribution).toBe(false);
  });

  it("counts legacy per-event *.json files as distribution presence too", async () => {
    const root = makeRoot();
    const eventsDir = await getEventsDir(root);
    await safeWriteJson(eventsDir, "evt-1.json", event("e01"));

    const [status] = await loadArchiveStatus(root, [month]);
    expect(status!.hasDistribution).toBe(true);
  });
});
