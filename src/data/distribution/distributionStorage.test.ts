import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { appendDistributionEvent, loadDistributionLog } from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

async function makeRoot() {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

describe("distributionStorage", () => {
  it("starts with an empty log", async () => {
    const root = await makeRoot();
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(0);
  });

  it("appends a single event and reads it back", async () => {
    const root = await makeRoot();
    const evt = buildAssignEvent({
      xrayImageId: "img-001",
      assignedTo: "alice",
      eventBy: "admin",
    });
    await appendDistributionEvent(root, "5-May-2026", evt);
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(1);
    expect(log.events[0].xrayImageId).toBe("img-001");
  });

  it("appends multiple events sequentially", async () => {
    const root = await makeRoot();
    const evts = ["img-001", "img-002", "img-003"].map((id) =>
      buildAssignEvent({ xrayImageId: id, assignedTo: "alice", eventBy: "admin" })
    );
    for (const evt of evts) {
      await appendDistributionEvent(root, "5-May-2026", evt);
    }
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(3);
  });
});
