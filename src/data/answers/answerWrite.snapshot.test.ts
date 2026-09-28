// Deterministic-by-contract pin for the answer write path (`performAnswerWrite`):
// the emitted events (seed / legacy seed / skip decisions) and the folded state
// after a scripted sequence of writes. Recorded BEFORE the S2 change (casLoop
// taken off the private-chain append) and must not change with it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  loadEmployeeAnswers,
  readAllAnswerEventsForMonth,
  reopenItemAnswer,
  saveEmployeeAnswers,
  setItemQualityNote,
  upsertItemAnswer,
  __clearAnswerEventsCacheForTests,
} from "./answerStorage";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import type { ItemAnswer } from "./answerTypes";

const MONTH = "5-May-2026";

function item(id: string, overrides: Partial<ItemAnswer> = {}): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: `v-${id}` }],
    lastSavedAt: "2026-05-02T00:00:00.000Z",
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
    ...overrides,
  };
}

let uuidCounter = 0;

beforeEach(() => {
  __clearAnswerEventsCacheForTests();
  uuidCounter = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-02T10:00:00.000Z"));
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function capture(root: DirectoryHandleLike, user: string) {
  __clearAnswerEventsCacheForTests();
  const events = (await readAllAnswerEventsForMonth(root, MONTH)).filter((e) => e.answeredBy === user);
  const file = await loadEmployeeAnswers(root, MONTH, user);
  // eventIds are random UUIDs: number them by order so the snapshot does not
  // depend on how many other components consumed randomUUID (e.g. casLoop tokens).
  const ids = new Map<string, string>();
  const norm = (id: string): string => {
    const base = id.endsWith("-seed") ? id.slice(0, -5) : id;
    if (!ids.has(base)) ids.set(base, `E${ids.size + 1}`);
    return id.endsWith("-seed") ? `${ids.get(base)}-seed` : ids.get(base)!;
  };
  return { events: events.map((e) => ({ ...e, eventId: norm(e.eventId) })), items: file.items };
}

describe("answer write path — output snapshot (S2 pin)", () => {
  it("fresh employee: seed + save, submit, reopen, note, and the four skip decisions", async () => {
    const root = createMemoryDirectory("snap") as unknown as DirectoryHandleLike;
    const results = [
      await upsertItemAnswer(root, MONTH, "emp1", item("X1")),
      await upsertItemAnswer(root, MONTH, "emp1", item("X1", { status: "submitted", submittedAt: "2026-05-02T10:00:00.000Z" })),
      await reopenItemAnswer(root, MONTH, "emp1", "X1", "sup1", "why"),
      await reopenItemAnswer(root, MONTH, "emp1", "X1", "sup1", "again (item no longer submitted: skip)"),
      await setItemQualityNote(root, MONTH, "emp1", "X1", "  note  "),
      await setItemQualityNote(root, MONTH, "emp1", "MISSING", "skip: no such item"),
      await reopenItemAnswer(root, MONTH, "emp1", "MISSING", "sup1", "skip: no such item"),
      await upsertItemAnswer(root, MONTH, "emp1", item("X2", { answers: [{ fieldId: "f1", value: "b" }] })),
    ];
    expect(results).toEqual(results.map(() => ({ ok: true })));
    expect(await capture(root, "emp1")).toMatchSnapshot();
  });

  it("legacy seed: a pre-existing legacy file is hashed into the seed and folded with the new events", async () => {
    const root = createMemoryDirectory("snap-legacy") as unknown as DirectoryHandleLike;
    await saveEmployeeAnswers(root, MONTH, "emp2", [
      item("L1", { answeredBy: "emp2", status: "submitted", submittedAt: "2026-05-01T09:00:00.000Z" }),
      item("L2", { answeredBy: "emp2" }),
    ]);
    expect((await upsertItemAnswer(root, MONTH, "emp2", item("L2", { answeredBy: "emp2", answers: [{ fieldId: "f1", value: "edited" }] }))).ok).toBe(true);
    expect((await reopenItemAnswer(root, MONTH, "emp2", "L1", "sup1", "fix")).ok).toBe(true);
    expect(await capture(root, "emp2")).toMatchSnapshot();
    const answersDir = await getSampleEmployeeDir(root, MONTH, true);
    const names: string[] = [];
    for await (const handle of (answersDir as unknown as { values(): AsyncIterable<{ name: string }> }).values()) {
      names.push(handle.name);
    }
    expect(names.sort()).toMatchSnapshot();
  });
});
