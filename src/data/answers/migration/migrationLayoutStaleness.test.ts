// v154.0 review finding 2: an abandoned migration (stale lock, nothing moved)
// must not block every write for the month until an admin reruns it.
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { __resetAppendOnlyEventLogMemosForTests, encodeEventLine } from "../../storage/appendOnlyEventLog";
import { wrap } from "../../storage/jsonEnvelope";
import { safeWriteJson } from "../../storage/safeWrite";
import {
  __clearWorkspaceDirCacheForTests, ANSWER_EVENTS_FOLDERS, getAnswerArchiveV1Dir, getAnswerEventsDir,
  getAnswerEventsLayout, invalidateAnswerEventsLayout,
} from "../../workspace/workspacePaths";
import { __clearAnswerEventsCacheForTests } from "../answerStorage";
import { makeV1Month, savedEvent, writeText } from "../v2/v2TestFixtures";
import { probeAnswerLayoutMigrations } from "./answerLayoutMigrationProbe";
import { MIGRATION_LOCK_STALE_MS, migrateMonthToPerAssignee } from "./flatToPerAssignee";

const MONTH = "5-may-2026";

function resetCaches(): void {
  __clearWorkspaceDirCacheForTests();
  invalidateAnswerEventsLayout();
  __clearAnswerEventsCacheForTests();
  __resetAppendOnlyEventLogMemosForTests();
}

async function v1MonthWithLock(name: string, lastSeenAgoMs: number): Promise<{ root: DirectoryHandleLike; events: DirectoryHandleLike }> {
  const root = createMemoryDirectory(name) as unknown as DirectoryHandleLike;
  await makeV1Month(root, MONTH);
  const events = await getAnswerEventsDir(root, MONTH, false);
  await writeText(events, "aa-ans-deva-sesa.ndjson", encodeEventLine(savedEvent("e1", 1)));
  const at = new Date(Date.now() - lastSeenAgoMs).toISOString();
  await safeWriteJson(events, ANSWER_EVENTS_FOLDERS.migrationLock, wrap({ by: "admin2", deviceId: "d", startedAt: at, heartbeatAt: at, token: "t", revision: 1 }));
  resetCaches();
  return { root, events };
}

describe("getAnswerEventsLayout vs an abandoned migration (finding 2)", () => {
  beforeEach(resetCaches);

  it("a FRESH lock still reads v1-migrating", async () => {
    const { root } = await v1MonthWithLock("fresh", 60_000);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
  });

  it("a STALE lock with no _archive-v1/ reads v1", async () => {
    const { root } = await v1MonthWithLock("stale-none", MIGRATION_LOCK_STALE_MS + 60_000);
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
  });

  it("a STALE lock with an EMPTY _archive-v1/ reads v1", async () => {
    const { root } = await v1MonthWithLock("stale-empty", MIGRATION_LOCK_STALE_MS + 60_000);
    await getAnswerArchiveV1Dir(root, MONTH, true);
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
  });

  it("a STALE lock with MOVED files in _archive-v1/ stays v1-migrating and the probe re-offers it", async () => {
    const { root } = await v1MonthWithLock("stale-partial", MIGRATION_LOCK_STALE_MS + 60_000);
    const archive = await getAnswerArchiveV1Dir(root, MONTH, true);
    await writeText(archive, "moved-ans-devm-sesm.ndjson", encodeEventLine(savedEvent("m1", 2)));
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1-migrating");
    const needs = await probeAnswerLayoutMigrations(root, [MONTH]);
    expect(needs).toMatchObject([{ monthFolderName: MONTH, kind: "incomplete" }]);
  });

  it("a run that dies before its first move leaves no _archive-v1/ behind (created lazily)", async () => {
    const { root, events } = await v1MonthWithLock("lazy", MIGRATION_LOCK_STALE_MS + 60_000);
    await expect(migrateMonthToPerAssignee(root, MONTH, {
      actor: "admin",
      onProgress: (p) => { if (p.phase === "snapshot") throw new Error("simulated crash"); },
    })).rejects.toThrow(/simulated crash/);
    await expect(events.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.archiveV1, { create: false })).rejects.toMatchObject({ name: "NotFoundError" });
    resetCaches();
    expect(await getAnswerEventsLayout(root, MONTH)).toBe("v1");
  });
});
