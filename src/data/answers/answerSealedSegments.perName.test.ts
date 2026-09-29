// A4 (answer-save perf): a colleague's change used to wipe EVERY sealed-segment
// confirmation (one epoch bump per probe that saw `answers` move), so the next
// save re-stat'ed every sealed segment of the month. Now the probe invalidates
// only the segment names whose signature entry moved; other confirmations
// survive. The 8ff85b1 guarantee -- a sealed segment that grows is never missed --
// still holds: a moved name is re-opened on the very next read.
import { beforeEach, describe, expect, it } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import { __clearAnswerEventsCacheForTests, readAllAnswerEventsForMonth } from "./answerStorage";
import {
  SEALED_REVALIDATE_MS,
  getSealedAnswerSegmentsEpoch,
  invalidateSealedAnswerSegmentNames,
} from "./answerSealedSegments";

const MONTH = "5-May-2026";

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}
const line = (id: string): string =>
  `${JSON.stringify({ eventId: id, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z", eventBy: "e", authority: "self", xrayImageId: `XR-${id}`, answers: [], status: "draft", answeredBy: "e" })}\n`;

async function twoChains() {
  const root = createMemoryDirectory("perName", { trackReads: true }) as unknown as DirectoryHandleLike;
  const main = await getSampleMainDir(root, MONTH, true);
  const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
  for (const chain of ["a", "b"]) {
    const base = `ans-dev-${chain}-sess${chain}`;
    await writeRaw(events, `${base}.ndjson`, line(`${chain}0`));
    await writeRaw(events, `${base}-1.ndjson`, line(`${chain}1`));
  }
  // confirm both seq0 segments sealed (first read sights seq1, second skips seq0)
  await readAllAnswerEventsForMonth(root, MONTH);
  await readAllAnswerEventsForMonth(root, MONTH);
  return { root, events };
}
const opened = (root: DirectoryHandleLike, name: string): boolean => getReadLog(root).some((e) => e.endsWith(name));

describe("sealed-segment confirmations are invalidated per name (A4)", () => {
  beforeEach(() => __clearAnswerEventsCacheForTests());

  it("invalidating one name re-opens only that segment, and picks up bytes that landed in it", async () => {
    const { root, events } = await twoChains();
    const before = await (await (await events.getFileHandle("ans-dev-a-sessa.ndjson")).getFile()).text();
    await writeRaw(events, "ans-dev-a-sessa.ndjson", before + line("LATE"));
    clearReadLog(root);
    // not visible while confirmed sealed...
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.eventId)).not.toContain("LATE");
    const epoch = getSealedAnswerSegmentsEpoch();
    invalidateSealedAnswerSegmentNames(["ans-dev-a-sessa.ndjson"]);
    // a per-name invalidation is NOT a wholesale reset
    expect(getSealedAnswerSegmentsEpoch()).toBe(epoch);
    clearReadLog(root);
    expect((await readAllAnswerEventsForMonth(root, MONTH)).map((e) => e.eventId)).toContain("LATE");
    expect(opened(root, "ans-dev-a-sessa.ndjson")).toBe(true);
    expect(opened(root, "ans-dev-b-sessb.ndjson")).toBe(false); // the other chain's sealed segment stays skipped
    // and the re-confirmed name is skipped again afterwards
    clearReadLog(root);
    await readAllAnswerEventsForMonth(root, MONTH);
    expect(opened(root, "ans-dev-a-sessa.ndjson")).toBe(false);
  });

  it("still bounded by the (lengthened) time-based revalidation, which is longer than 60 s but finite", () => {
    expect(SEALED_REVALIDATE_MS).toBeGreaterThan(60_000);
    expect(SEALED_REVALIDATE_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
