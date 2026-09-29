import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import {
  __clearAnswerEventsCacheForTests,
  clearAnswerEventsCache,
  readAllAnswerEventsForMonth,
  upsertItemAnswer,
} from "./answerStorage";
import { SEALED_REVALIDATE_MS, invalidateSealedAnswerSegments } from "./answerSealedSegments";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

const line = (id: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "e", authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: "e" })}\n`;

describe("readAllAnswerEventsForMonth — sealed segments are opened once (S3)", () => {
  beforeEach(() => __clearAnswerEventsCacheForTests());

  it("a month of rotated segments costs one open per sealed segment, not one per read", async () => {
    const root = createMemoryDirectory("r", { trackReads: true }) as unknown as DirectoryHandleLike;
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    // 5 chains x 4 segments = 20 segments; only each chain's highest is open.
    for (let chain = 0; chain < 5; chain += 1) {
      const base = `ans-dev0000${chain}-abcde${chain}`;
      await writeRaw(events, `${base}.ndjson`, line(`c${chain}s0`));
      for (let seq = 1; seq < 4; seq += 1) await writeRaw(events, `${base}-${seq}.ndjson`, line(`c${chain}s${seq}`));
    }
    const opens = () => getReadLog(root).filter((entry) => entry.endsWith(".ndjson")).length;

    expect((await readAllAnswerEventsForMonth(root, MONTH)).length).toBe(20);
    const cold = opens();
    expect(cold).toBe(20);

    clearReadLog(root);
    expect((await readAllAnswerEventsForMonth(root, MONTH)).length).toBe(20);
    // 15 sealed segments were confirmed on the cold read: only the 5 open ones are probed.
    expect(opens()).toBe(5);
  });
});

function item(id: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t",
    templateVersion: 1,
    answers: [{ fieldId: "f", value: id }],
    lastSavedAt: "2026-05-02T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

async function namesIn(dir: DirectoryHandleLike): Promise<string[]> {
  const names: string[] = [];
  for await (const handle of (dir as unknown as { values(): AsyncIterable<{ name: string }> }).values()) names.push(handle.name);
  return names.sort();
}

const lateLine = (id: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2099-01-01T00:00:00.000Z", eventBy: "emp1", authority: "self", xrayImageId: id, answers: [], status: "draft", answeredBy: "emp1" })}\n`;

describe("a sealed answer segment that grows is never missed (S3 fix round)", () => {
  beforeEach(() => {
    __clearAnswerEventsCacheForTests();
    invalidateSealedAnswerSegments();
  });
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const root = createMemoryDirectory("late", { trackReads: true }) as unknown as DirectoryHandleLike;
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("XR-1"))).ok).toBe(true);
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const [seq0] = await namesIn(events);
    return { root, events, seq0: seq0! };
  }

  it("reviewer scenario: a second tab rotated (seq1 exists), ANOTHER reader confirmed seq0 sealed, then this tab saves XR-LATE", async () => {
    const { root, events, seq0 } = await setup();
    // A separate reader (its own read cache, like another tab/machine) over the same folder.
    const reader = new Proxy(root, {}) as DirectoryHandleLike;
    // 2. another tab rotated: a `-1` sibling of the SAME chain now exists.
    await writeRaw(events, seq0.replace(/\.ndjson$/, "-1.ndjson"), line("rot1"));
    // 3. the reader confirms seq0 sealed (first read sights seq1, second skips seq0).
    await readAllAnswerEventsForMonth(reader, MONTH);
    clearReadLog(root);
    await readAllAnswerEventsForMonth(reader, MONTH);
    expect(getReadLog(root).some((entry) => entry.endsWith(seq0))).toBe(false); // sealed: skipped
    // 4. this tab (memo still says seq0, its own cache lists the head) saves XR-LATE.
    await readAllAnswerEventsForMonth(root, MONTH);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("XR-LATE"))).ok).toBe(true);
    // 5. the reader sees it, without waiting for revalidation or the probe...
    const ids = (await readAllAnswerEventsForMonth(reader, MONTH)).map((e) => e.xrayImageId);
    expect(ids).toContain("XR-LATE");
    // ...because the writer advanced to the head instead of appending below it.
    const seq0Text = await (await (await events.getFileHandle(seq0)).getFile()).text();
    expect(seq0Text).not.toContain("XR-LATE");
  });

  it("backstop: bytes that land in a confirmed-sealed segment anyway are picked up by time-based revalidation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-02T10:00:00.000Z"));
    const { root, events, seq0 } = await setup();
    await writeRaw(events, seq0.replace(/\.ndjson$/, "-1.ndjson"), line("rot1"));
    await readAllAnswerEventsForMonth(root, MONTH);
    await readAllAnswerEventsForMonth(root, MONTH); // seq0 confirmed sealed
    const before = await (await (await events.getFileHandle(seq0)).getFile()).text();
    await writeRaw(events, seq0, before + lateLine("XR-LAG"));

    // Bounded staleness: not visible inside the window...
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.xrayImageId)).not.toContain("XR-LAG");
    // ...but visible once the confirmation is older than the revalidation interval.
    vi.setSystemTime(new Date(Date.now() + SEALED_REVALIDATE_MS + 1_000));
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.xrayImageId)).toContain("XR-LAG");
  });

  it.each([
    ["the sync probe / manual refresh invalidation", () => invalidateSealedAnswerSegments()],
    ["a backup restore clearing the answers read cache", () => clearAnswerEventsCache()],
  ])("backstop: %s makes the very next read see it", async (_label, invalidate) => {
    const { root, events, seq0 } = await setup();
    await writeRaw(events, seq0.replace(/\.ndjson$/, "-1.ndjson"), line("rot1"));
    await readAllAnswerEventsForMonth(root, MONTH);
    await readAllAnswerEventsForMonth(root, MONTH);
    const before = await (await (await events.getFileHandle(seq0)).getFile()).text();
    await writeRaw(events, seq0, before + lateLine("XR-LAG"));
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.xrayImageId)).not.toContain("XR-LAG");
    invalidate();
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.xrayImageId)).toContain("XR-LAG");
  });
});
