import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearErrors, getRecentErrors } from "./errorLogger";
import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { __resetVanishedEntryLogForTests, readSegmentTails } from "./directoryScan";
import { clearDeadSegmentRegistry, DEAD_SEGMENT_MIN_AGE_MS } from "./deadSegmentRegistry";

async function put(dir: Awaited<ReturnType<typeof createMemoryDirectory>>, name: string): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!();
  await w.write("x\n");
  await w.close();
}

describe("dead-segment log line", () => {
  let now = 5_000_000;
  beforeEach(() => {
    clearErrors();
    clearDeadSegmentRegistry();
    __resetVanishedEntryLogForTests();
    now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it("fires exactly once when the age gate is crossed BETWEEN scans, and leaves other vanished names' message alone", async () => {
    const dir = createMemoryDirectory("events");
    await put(dir, "dead-s1.ndjson");
    await put(dir, "flaky-s1.ndjson");
    setSimulatedFaults(dir, [
      { operation: "getFile", name: "dead-s1.ndjson", errorName: "NotFoundError", times: Number.POSITIVE_INFINITY },
    ]);
    const scan = (): Promise<unknown> =>
      readSegmentTails(dir, { suffix: ".ndjson", knownOffsets: {}, scopeKey: "scope-a" });

    // 30 s scans: the failure COUNT is satisfied long before the 5 min AGE gate.
    for (let t = 0; t <= DEAD_SEGMENT_MIN_AGE_MS + 90_000; t += 30_000) {
      await scan();
      now += 30_000;
    }
    const lines = getRecentErrors().filter((e) => e.context === "directoryScan:segment-tails");
    const deadLines = lines.filter((e) => String(e.message).includes("treated as unreadable"));
    expect(deadLines).toHaveLength(1);
    expect(String(deadLines[0]!.message)).toContain("dead-s1.ndjson");
    expect(String(deadLines[0]!.message)).not.toContain("flaky-s1.ndjson");
    // The ordinary "Skipped N listed entries" line for the same name is still emitted once, as before.
    expect(lines.filter((e) => String(e.message).startsWith("Skipped"))).toHaveLength(1);
  });
});
