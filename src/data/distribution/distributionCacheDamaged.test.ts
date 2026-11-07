// A damaged `distribution.current.json` is a cache miss, not a recovery: the
// month refolds from its events and rewrites the cache, never serving an older
// `.bak` and never raising the «تعذّرت قراءة النسخة الأصلية» banner (which no
// admin repair would ever clear for this file — see loadDistributionCurrent).
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { __resetBakRecoveryReportsForTests } from "../storage/bakRecoveryReport";
import { getSampleMainDir } from "../workspace/workspacePaths";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { buildAssignEvent } from "./distributionLog";
import { __clearDeriveMemoForTests, appendDistributionEvent, loadOrDeriveDistributionCurrent } from "./distributionStorage";

const MONTH = "5-May-2026";
const CURRENT_FILE = "distribution.current.json";

const row = (id: string) => ({ xrayImageId: id, portName: "بري", certScanStatus: "NonCertscan" }) as PreparedPopulationRow;

async function assign(root: DirectoryHandleLike, id: string, at: string): Promise<void> {
  const result = await appendDistributionEvent(root, MONTH, buildAssignEvent({ xrayImageId: id, assignedTo: "alice", eventBy: "admin", eventAt: at }));
  expect(result.ok).toBe(true);
}

async function writeText(dir: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const handle = (await dir.getFileHandle(name, { create: true })) as FileHandleLike;
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function readText(dir: DirectoryHandleLike, name: string): Promise<string> {
  return (await (await dir.getFileHandle(name)).getFile()).text();
}

describe("damaged distribution.current.json", () => {
  beforeEach(() => {
    __clearDeriveMemoForTests();
    __resetBakRecoveryReportsForTests();
    clearErrors();
  });

  it("refolds from the events instead of serving a stale .bak, logs no recovery, and rewrites the cache", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const rows = [row("A1"), row("A2")];
    await assign(root, "A1", "2026-05-01T08:00:00.000Z");
    await loadOrDeriveDistributionCurrent(root, MONTH, rows, { awaitCachePersist: true });
    const dir = await getSampleMainDir(root, MONTH, false);
    await writeText(dir, `${CURRENT_FILE}.bak`, await readText(dir, CURRENT_FILE)); // older copy: A1 only

    await assign(root, "A2", "2026-05-01T09:00:00.000Z");
    await writeText(dir, CURRENT_FILE, "{ torn"); // damaged live copy
    __clearDeriveMemoForTests();
    clearErrors();

    const current = await loadOrDeriveDistributionCurrent(root, MONTH, rows, { awaitCachePersist: true });

    expect(current?.entries.map((entry) => entry.xrayImageId).sort()).toEqual(["A1", "A2"]);
    expect(getRecentErrors().filter((entry) => entry.context === "storage:bak-recovery")).toHaveLength(0);
    const rewritten = JSON.parse(await readText(dir, CURRENT_FILE)) as { data: { entries: unknown[] } };
    expect(rewritten.data.entries).toHaveLength(2);
  });
});
