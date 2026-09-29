// A5 (answer-save perf): a plain SELF save by an employee this tab already knows
// is seeded does not re-read the whole month before appending. The decision never
// used `previous` (only the IndexedDB mirror candidate does), "seeded" is monotonic,
// and the append re-reads its OWN target segment under the chain lock anyway.
// Everything that DOES depend on the read keeps it: the first-ever event (seeding),
// on-behalf, reopen, quality note, and any save after a cache drop (restore/refresh).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { getSampleMainDir } from "../workspace/workspacePaths";
import { ANSWER_EVENTS_DIR } from "./answerEventStore";
import * as answerLocalMirror from "./answerLocalMirror";
import {
  __clearAnswerEventsCacheForTests,
  clearAnswerEventsCache,
  loadEmployeeAnswers,
  reopenItemAnswer,
  setItemQualityNote,
  upsertItemAnswer,
  upsertItemAnswerOnBehalf,
} from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";

vi.mock("./answerLocalMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./answerLocalMirror")>();
  return { ...actual, mirrorAnswerLocally: vi.fn(async () => {}) };
});
const mirrorMock = vi.mocked(answerLocalMirror.mirrorAnswerLocally);

const MONTH = "5-May-2026";
const SINGLETONS = 40;

async function writeRaw(dir: DirectoryHandleLike, name: string, content: string): Promise<void> {
  const handle: FileHandleLike = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(content);
  await writable.close();
}

function item(id: string, extra: Partial<ItemAnswer> = {}): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t",
    templateVersion: 1,
    answers: [{ fieldId: "f", value: id }],
    lastSavedAt: "2026-05-02T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
    ...extra,
  };
}

/** A month with dead pre-stable-chain singleton segments: each one costs a getFile per full read. */
async function monthWithSingletons(count = SINGLETONS): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("blind", { trackReads: true }) as unknown as DirectoryHandleLike;
  const main = await getSampleMainDir(root, MONTH, true);
  const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
  for (let i = 0; i < count; i += 1) {
    const line = JSON.stringify({
      eventId: `old-${i}`, eventType: "item-saved", eventAt: "2026-05-01T08:00:00.000Z",
      eventBy: "colleague", authority: "self", xrayImageId: `OLD-${i}`, answers: [], status: "draft",
      answeredBy: "colleague",
    });
    await writeRaw(events, `s${i}-ans-dev${i}-sess${i}.ndjson`, `${line}\n`);
  }
  return root;
}

const singletonReads = (root: DirectoryHandleLike): number =>
  getReadLog(root).filter((e) => /\/s\d+-ans-dev\d+-sess\d+\.ndjson$/.test(e)).length;

/** Seed emp1 and warm the memo (save 1 seeds, save 2 observes the seed). */
async function warm(root: DirectoryHandleLike): Promise<void> {
  expect((await upsertItemAnswer(root, MONTH, "emp1", item("W1"))).ok).toBe(true);
  expect((await upsertItemAnswer(root, MONTH, "emp1", item("W2"))).ok).toBe(true);
}

beforeEach(() => {
  __clearAnswerEventsCacheForTests();
  mirrorMock.mockClear();
});

describe("blind append for a plain self save (A5)", () => {
  it("(a) a warm self save does not read the dead segments of the month", async () => {
    const root = await monthWithSingletons();
    await warm(root);
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("X1"))).ok).toBe(true);
    expect(singletonReads(root)).toBe(0);
    // Only its own open segment (pre-append re-read + verify), not a month scan.
    expect(getReadLog(root).length).toBeLessThanOrEqual(6);
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("X2"))).ok).toBe(true);
    expect(singletonReads(root)).toBe(0);
  });

  it("still lands durably and is visible to the next full read", async () => {
    const root = await monthWithSingletons();
    await warm(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("X1", { status: "submitted", submittedAt: "2026-05-03T00:00:00.000Z" }))).ok).toBe(true);
    clearAnswerEventsCache();
    const items = (await loadEmployeeAnswers(root, MONTH, "emp1")).items;
    expect(items.map((i) => i.xrayImageId).sort()).toEqual(["W1", "W2", "X1"]);
    expect(items.find((i) => i.xrayImageId === "X1")?.status).toBe("submitted");
  });

  it("(c) reads in full for the first-ever event (seeding)", async () => {
    const root = await monthWithSingletons();
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("F1"))).ok).toBe(true);
    expect(singletonReads(root)).toBe(SINGLETONS);
    // and the seed event was written
    clearAnswerEventsCache();
    expect((await loadEmployeeAnswers(root, MONTH, "emp1")).items).toHaveLength(1);
  });

  it("(c) reads in full for a save after the cache was dropped (restore / manual refresh)", async () => {
    const root = await monthWithSingletons();
    await warm(root);
    clearAnswerEventsCache();
    clearReadLog(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("R1"))).ok).toBe(true);
    expect(singletonReads(root)).toBe(SINGLETONS);
  });

  it("(c) reads in full for an on-behalf answer", async () => {
    const root = await monthWithSingletons();
    await warm(root);
    clearReadLog(root);
    expect((await upsertItemAnswerOnBehalf(root, MONTH, "emp1", item("B1"), "sup1")).ok).toBe(true);
    expect(singletonReads(root)).toBeGreaterThan(0);
  });

  it("(c) reads in full for reopen and quality note (their decision depends on the current item)", async () => {
    const root = await monthWithSingletons();
    await warm(root);
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("S1", { status: "submitted", submittedAt: "2026-05-03T00:00:00.000Z" }))).ok).toBe(true);
    clearReadLog(root);
    // These decide FROM `previous`, so they never take the blind path: they always read the month.
    expect((await reopenItemAnswer(root, MONTH, "emp1", "S1", "sup1", "why")).ok).toBe(true);
    expect(singletonReads(root)).toBeGreaterThan(0);
    clearReadLog(root);
    expect((await setItemQualityNote(root, MONTH, "emp1", "S1", "note")).ok).toBe(true);
    expect(singletonReads(root)).toBeGreaterThan(0);
  });

  it("(b) appends exactly the events the full path appends", async () => {
    const strip = (text: string): string[] =>
      text.split("\n").filter(Boolean).map((l) => {
        const e = JSON.parse(l) as Record<string, unknown>;
        delete e.eventId; delete e.eventAt;
        return JSON.stringify(e);
      });
    async function run(forceFull: boolean): Promise<string[]> {
      __clearAnswerEventsCacheForTests();
      const root = await monthWithSingletons(5);
      for (let i = 0; i < 6; i += 1) {
        if (forceFull) clearAnswerEventsCache();
        const r = await upsertItemAnswer(root, MONTH, "emp1", item(`E${i % 4}`, {
          answers: [{ fieldId: "f", value: `v${i}` }],
          status: i % 3 === 2 ? "submitted" : "draft",
          submittedAt: i % 3 === 2 ? "2026-05-03T00:00:00.000Z" : null,
        }));
        expect(r.ok).toBe(true);
      }
      const main = await getSampleMainDir(root, MONTH, false);
      const dir = await main.getDirectoryHandle(ANSWER_EVENTS_DIR);
      const lines: string[] = [];
      for await (const entry of (dir as unknown as { values(): AsyncIterable<FileHandleLike & { kind: string }> }).values()) {
        if (entry.kind !== "file" || /^s\d+-ans-dev/.test(entry.name)) continue;
        lines.push(...strip(await (await entry.getFile()).text()));
      }
      return lines;
    }
    const blind = await run(false);
    const full = await run(true);
    expect(blind.length).toBeGreaterThanOrEqual(7); // 6 saves + the seed
    expect(blind).toEqual(full);
  });

  it("(b) the IndexedDB mirror candidate is the same as the full path builds", async () => {
    async function run(forceFull: boolean): Promise<ItemAnswer[]> {
      __clearAnswerEventsCacheForTests();
      const root = await monthWithSingletons(3);
      await warm(root);
      // The item already has history the candidate carries over from `previous`.
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("H1", { status: "submitted", submittedAt: "2026-05-03T00:00:00.000Z" }))).ok).toBe(true);
      expect((await reopenItemAnswer(root, MONTH, "emp1", "H1", "sup1", "fix")).ok).toBe(true);
      expect((await setItemQualityNote(root, MONTH, "emp1", "H1", "note")).ok).toBe(true);
      mirrorMock.mockClear();
      if (forceFull) clearAnswerEventsCache();
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("H1", { answers: [{ fieldId: "f", value: "again" }] }))).ok).toBe(true);
      return mirrorMock.mock.calls.map((c) => c[2] as ItemAnswer);
    }
    const norm = (list: ItemAnswer[]) => JSON.parse(JSON.stringify(list).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "T"));
    const blind = await run(false);
    const full = await run(true);
    expect(blind).toHaveLength(1);
    expect(blind[0]!.qualityNote).toBe("note");
    expect(norm(blind)).toEqual(norm(full));
  });

  it("(c) a colleague's reopen made on another machine folds the same whether or not the save read first", async () => {
    async function run(forceFull: boolean): Promise<string> {
      __clearAnswerEventsCacheForTests();
      const root = await monthWithSingletons(2);
      await warm(root);
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("Q1", { status: "submitted", submittedAt: "2026-05-03T00:00:00.000Z" }))).ok).toBe(true);
      // Another machine's supervisor reopens Q1: raw segment, invisible to this tab's cache.
      const main = await getSampleMainDir(root, MONTH, true);
      const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
      await writeRaw(events, "sup-ans-devSUP-sessSUP.ndjson", `${JSON.stringify({
        eventId: "sup-reopen-1", eventType: "item-reopened", eventAt: new Date(Date.now() + 60_000).toISOString(),
        eventBy: "sup1", authority: "supervisor", xrayImageId: "Q1", reason: "r", answeredBy: "emp1",
      })}\n`);
      if (forceFull) clearAnswerEventsCache();
      expect((await upsertItemAnswer(root, MONTH, "emp1", item("Q1", { answers: [{ fieldId: "f", value: "redo" }] }))).ok).toBe(true);
      clearAnswerEventsCache();
      const items = (await loadEmployeeAnswers(root, MONTH, "emp1")).items;
      return JSON.stringify(items).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "T");
    }
    const blind = await run(false);
    const full = await run(true);
    expect(blind).toEqual(full);
  });

  it.each([false, true])("(floor) another tab of the same employee rotated the shared chain: the save lands in the head segment (forceFull=%s)", async (forceFull) => {
    const root = createMemoryDirectory("floor", { trackReads: true }) as unknown as DirectoryHandleLike;
    for (const id of ["W1", "W2", "W3"]) expect((await upsertItemAnswer(root, MONTH, "emp1", item(id))).ok).toBe(true);
    const main = await getSampleMainDir(root, MONTH, true);
    const events = await main.getDirectoryHandle(ANSWER_EVENTS_DIR, { create: true });
    const names: string[] = [];
    for await (const e of (events as unknown as { values(): AsyncIterable<{ kind: string; name: string }> }).values()) {
      if (e.kind === "file") names.push(e.name);
    }
    expect(names).toHaveLength(1);
    const head = names[0]!.replace(/\.ndjson$/, "-1.ndjson");
    // Tab B rotated to seq 1 without filling seq 0.
    await writeRaw(events, head, `${JSON.stringify({
      eventId: "tabB-1", eventType: "item-saved", eventAt: new Date().toISOString(), eventBy: "emp1",
      authority: "self", xrayImageId: "B1", answers: [], status: "draft", answeredBy: "emp1",
      templateId: "t", templateVersion: 1, lastSavedAt: "2026-05-02T00:00:00.000Z", submittedAt: null,
    })}\n`);
    if (forceFull) clearAnswerEventsCache();
    expect((await upsertItemAnswer(root, MONTH, "emp1", item("A-after"))).ok).toBe(true);
    const text = async (n: string) => (await (await events.getFileHandle(n)).getFile()).text();
    expect(await text(head)).toContain('"A-after"');
    expect(await text(names[0]!)).not.toContain('"A-after"');
  });
});
