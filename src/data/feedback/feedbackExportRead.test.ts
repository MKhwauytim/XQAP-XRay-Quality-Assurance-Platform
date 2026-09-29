import { describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { getFeedbackThreadsDir } from "../workspace/workspacePaths";
import { createThread, flushPendingFeedbackIndexWrites } from "./feedbackStorage";
import { readAllThreadsForExport } from "./feedbackExportRead";

async function seed(count: number) {
  const root = createMemoryDirectory("root");
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = await createThread(root, { from: `u${i}`, role: "employee", category: "issue", text: `م${i}` });
    ids.push(t.id);
  }
  await flushPendingFeedbackIndexWrites();
  return { root, ids };
}

describe("readAllThreadsForExport", () => {
  it("reads every thread in chunks and reports progress up to the total", async () => {
    const { root, ids } = await seed(5);
    const progress = vi.fn();
    const result = await readAllThreadsForExport(root, { chunkSize: 2, onProgress: progress });
    expect(result.threads.map((t) => t.id).sort()).toEqual([...ids].sort());
    expect(result.skippedIds).toEqual([]);
    expect(progress.mock.calls).toEqual([[2, 5], [4, 5], [5, 5]]);
  });

  it("counts a thread it could not read instead of silently dropping it", async () => {
    const { root, ids } = await seed(3);
    const dir = await getFeedbackThreadsDir(root, false);
    const handle = await dir.getFileHandle(`${ids[1]}.json`);
    const writable = await handle.createWritable!();
    await writable.write("{ not json");
    await writable.close();

    const result = await readAllThreadsForExport(root, { chunkSize: 10 });
    expect(result.threads).toHaveLength(2);
    expect(result.skippedIds).toEqual([ids[1]]);
  });

  it("returns nothing for a workspace with no feedback", async () => {
    const result = await readAllThreadsForExport(createMemoryDirectory("empty"), {});
    expect(result).toEqual({ threads: [], skippedIds: [] });
  });
});
