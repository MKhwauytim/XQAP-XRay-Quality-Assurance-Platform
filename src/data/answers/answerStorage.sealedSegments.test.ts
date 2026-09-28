import { beforeEach, describe, expect, it } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, readAllAnswerEventsForMonth } from "./answerStorage";

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
