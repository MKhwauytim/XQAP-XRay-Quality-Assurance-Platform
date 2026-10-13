import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory, getOperationLog, clearOperationLog } from "./memoryDirectory";
import { listSizedAndNamedEntries } from "./directoryScan";
import { clearDeadSegmentRegistry, DEAD_SEGMENT_MIN_AGE_MS, DEAD_SEGMENT_MIN_SCANS, recordUnopenableSegment } from "./deadSegmentRegistry";

async function put(dir: ReturnType<typeof createMemoryDirectory>, name: string): Promise<void> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable!();
  await w.write("x\n");
  await w.close();
}

describe("listSizedAndNamedEntries skips confirmed-dead names when given a scopeKey", () => {
  beforeEach(() => clearDeadSegmentRegistry());
  afterEach(() => clearDeadSegmentRegistry());

  it("a confirmed-dead segment is absent from `sized` and never opened; without the scope it is sized as usual", async () => {
    const dir = createMemoryDirectory("events", { trackOperations: true });
    await put(dir, "a-s1.ndjson");
    await put(dir, "dead-s1.ndjson");
    await put(dir, "legacy.json");
    const scope = "scope:events";
    const t0 = Date.now() - DEAD_SEGMENT_MIN_AGE_MS - 1_000;
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) {
      recordUnopenableSegment(scope, "dead-s1.ndjson", t0 + i * (DEAD_SEGMENT_MIN_AGE_MS / (DEAD_SEGMENT_MIN_SCANS - 1)));
    }

    clearOperationLog(dir);
    const scoped = await listSizedAndNamedEntries(dir, ".ndjson", ".json", scope);
    expect(scoped.sized.map((e) => e.name)).toEqual(["a-s1.ndjson"]);
    expect(scoped.names).toEqual(["legacy.json"]);
    expect(getOperationLog(dir).some((entry) => entry.name === "dead-s1.ndjson")).toBe(false);

    const unscoped = await listSizedAndNamedEntries(dir, ".ndjson", ".json");
    expect(unscoped.sized.map((e) => e.name).sort()).toEqual(["a-s1.ndjson", "dead-s1.ndjson"]);
    // The log does record opens of that name — so the scoped assertion above is not vacuous.
    expect(getOperationLog(dir).some((entry) => entry.name === "dead-s1.ndjson")).toBe(true);
  });
});
