import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import { readDistributionLogStamp } from "../distribution/distributionStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { createBackup, restoreBackupSnapshot } from "./backupStorage";

/**
 * A restore has to be VISIBLE to the rest of the fleet.
 *
 * `distribution.log.json` is deliberately not overwritten by a restore
 * (`restore-if-absent`), yet it carries the only stamp the 45s sync probe reads
 * for the `distribution` family. Without an explicit stamp refresh a restore
 * that merged real events back into `distribution.events/` left every other
 * machine serving its pre-restore snapshot forever.
 */
const month = { folderName: "5-may-2026", month: 5, year: 2026 };

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

function event(id: string): DistributionEvent {
  return {
    eventId: id,
    eventType: "assigned",
    xrayImageId: `XR-${id}`,
    assignedTo: "employee01",
    eventAt: `2026-05-01T08:00:${id.slice(-2).padStart(2, "0")}.000Z`,
    eventBy: "admin",
  };
}

function toNdjson(events: DistributionEvent[]): string {
  return events.map((e) => `${JSON.stringify(e)}\n`).join("");
}

async function writeRaw(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function seedMonth(root: DirectoryHandleLike, revision: number): Promise<DirectoryHandleLike> {
  const main = await getSampleMainDir(root, month.folderName, true);
  await safeWriteJson(main, "distribution.log.json", {
    monthFolderName: month.folderName,
    revision,
    _writeToken: "token-before-restore",
    events: [],
  });
  return main.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: true });
}

describe("restoreBackupSnapshot — a completed restore moves the sync probe's distribution stamp", () => {
  it("re-mints the compatibility log's write token (without touching its revision) when a restore merges events back", async () => {
    const root = makeRoot();
    const eventsDir = await seedMonth(root, 7);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01"), event("e02")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // The disaster this exists for: the live segment is lost after the backup.
    await eventsDir.removeEntry!("devA-s1.ndjson");

    const before = await readDistributionLogStamp(root, month.folderName);
    expect(before).toEqual({ revision: 7, writeToken: "token-before-restore" });

    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    const after = await readDistributionLogStamp(root, month.folderName);
    // The probe compares BOTH fields: the token must move (so every other
    // machine's next tick reports the `distribution` family changed) while the
    // revision — the mirror-staleness authority — must not.
    expect(after.revision).toBe(7);
    expect(after.writeToken).not.toBe("token-before-restore");
    expect(after.writeToken).toBeTruthy();
  });

  it("leaves the stamp alone when the restore merged nothing new (no spurious fleet-wide refresh)", async () => {
    const root = makeRoot();
    const eventsDir = await seedMonth(root, 3);
    await writeRaw(eventsDir, "devA-s1.ndjson", toNdjson([event("e01")]));

    const backup = await createBackup(root, [month], "admin", "manual");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Nothing was lost: restoring this backup is a no-op for the event history.
    const restored = await restoreBackupSnapshot({
      directoryHandle: root,
      months: [month],
      backupFolderName: backup.folderName,
      username: "admin",
    });
    expect(restored.ok).toBe(true);

    const after = await readDistributionLogStamp(root, month.folderName);
    expect(after).toEqual({ revision: 3, writeToken: "token-before-restore" });
  });
});
