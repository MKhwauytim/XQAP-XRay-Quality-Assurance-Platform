// S2 measurement: how many share reads does ONE answer save cost on a month
// that already holds 20 answer segments (4 other writers x 5 rotated segments)?
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, upsertItemAnswer } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

const hooks = vi.hoisted(() => ({ failAppend: false, appendCalls: 0 }));
vi.mock("./answerEventStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerEventStore")>();
  return {
    ...actual,
    appendAnswerEventSegment: async (...args: Parameters<typeof actual.appendAnswerEventSegment>) => {
      hooks.appendCalls += 1;
      if (hooks.failAppend) throw new Error("simulated persistent append failure");
      return actual.appendAnswerEventSegment(...args);
    },
  };
});

const MONTH = "5-May-2026";

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

const line = (id: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "o", authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: "other" })}\n`;

function item(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t",
    templateVersion: 1,
    answers: [{ fieldId: "f", value: "v" }],
    lastSavedAt: "2026-05-02T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

async function monthWith20Segments(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("cost", { trackReads: true }) as unknown as DirectoryHandleLike;
  const main = await getSampleMainDir(root, MONTH, true);
  const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
  for (let chain = 0; chain < 4; chain += 1) {
    const base = `ans-dev0000${chain}-abcde${chain}`;
    await writeRaw(events, `${base}.ndjson`, line(`c${chain}s0`));
    for (let seq = 1; seq < 5; seq += 1) await writeRaw(events, `${base}-${seq}.ndjson`, line(`c${chain}s${seq}`));
  }
  return root;
}

describe("answer save — read cost on a month with 20 segments (S2)", () => {
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    hooks.failAppend = false;
    hooks.appendCalls = 0;
  });

  it("a successful save: cold save opens each segment once, warm save only the open segments", async () => {
    const root = await monthWith20Segments();
    const opens = () => getReadLog(root).filter((e) => e.endsWith(".ndjson")).length;
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A"))).ok).toBe(true);
    // Measured before and after S2 (identical): 23 reads / 21 segment opens.
    expect(getReadLog(root).length).toBe(23);
    expect(opens()).toBe(21);
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("B"))).ok).toBe(true);
    // A5: the first save left emp1's seed event in the cache, so this plain self-save
    // appends without the month read: only the frozen legacy seed (read once, 1 read)
    // and the append's own pre-write re-read of the open segment (1 read / 1 open).
    expect(getReadLog(root).length).toBeLessThanOrEqual(3);
    expect(opens()).toBeLessThanOrEqual(2);
  });

  it("a persistently failing append is attempted once and does not re-read the month per attempt", async () => {
    const root = await monthWith20Segments();
    hooks.failAppend = true;
    clearReadLog(root);
    const result = await upsertItemAnswer(root, MONTH, "emp1", item("A"));
    expect(result.ok).toBe(false);
    expect(hooks.appendCalls).toBe(1);
    // Before S2: 14 append attempts and 87 reads under casLoop (each attempt re-listed
    // the month and re-opened the open segments); now one attempt, 22 reads.
    expect(getReadLog(root).length).toBe(22);
  }, 60_000);
});
