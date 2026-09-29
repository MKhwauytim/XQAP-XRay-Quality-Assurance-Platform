// A6 (answer-save perf): the IndexedDB mirror used to `indexedDB.open()` + `close()`
// on EVERY save (awaited on the click path) and its store was never pruned, so the
// 30 s pending-replay `getAll` grew for the life of the browser profile. Now one
// connection stays open for the page, and `synced: true` records older than the
// retention window are pruned once per session. `synced: false` is NEVER pruned.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexedDb } from "../storage/fakeIndexedDb.testHelper";
import {
  countPendingAnswers,
  loadMirroredAnswers,
  loadPendingAnswerRecords,
  markAnswerPendingLocally,
  MIRROR_SYNCED_RETENTION_MS,
  mirrorAnswerLocally,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

type Stored = { key: string; month: string; username: string; xrayImageId: string; item: ItemAnswer; mirroredAt: string; synced: boolean };

const MONTH = "5-may-2026";

function item(id: string, lastSavedAt = "2026-09-28T09:00:00.000Z"): ItemAnswer {
  return {
    xrayImageId: id, templateId: "t", templateVersion: 1, answers: [], lastSavedAt,
    submittedAt: null, answeredBy: "emp1", status: "submitted",
  };
}
function stored(id: string, synced: boolean, mirroredAt: string): Stored {
  return { key: `${MONTH}::emp1::${id}`, month: MONTH, username: "emp1", xrayImageId: id, item: item(id), mirroredAt, synced };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("one IndexedDB connection for the page (A6)", () => {
  it("opens once for many saves and never closes it per save", async () => {
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    for (let i = 0; i < 5; i += 1) await mirrorAnswerLocally(MONTH, "emp1", item(`IMG-${i}`));
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-P", "2026-09-28T10:00:00.000Z"));
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);
    expect((await loadMirroredAnswers(MONTH, "emp1")).length).toBe(6);
    expect(fake.getOpenCalls()).toBe(1);
    expect(fake.getCloseCalls()).toBe(0);
  });

  it("a versionchange from another tab closes our connection and the next call reopens", async () => {
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-1"));
    expect(typeof fake.db.onversionchange).toBe("function");
    fake.db.onversionchange!();
    expect(fake.getCloseCalls()).toBe(1);
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-2"));
    expect(fake.getOpenCalls()).toBe(2);
    expect(fake.table.has(`${MONTH}::emp1::IMG-2`)).toBe(true);
  });

  it("a connection the browser closed underneath us is reopened once and the write still lands", async () => {
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-1"));
    const realTransaction = fake.db.transaction;
    let failNext = true;
    fake.db.transaction = ((...args: Parameters<typeof realTransaction>) => {
      if (failNext) {
        failNext = false;
        const error = new Error("The database connection is closing.");
        error.name = "InvalidStateError";
        throw error;
      }
      return realTransaction(...args);
    }) as typeof realTransaction;
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-2"));
    expect(fake.table.get(`${MONTH}::emp1::IMG-2`)?.synced).toBe(false);
    expect(fake.getOpenCalls()).toBe(2);
  });

  it("is a no-op, never an error, when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(mirrorAnswerLocally(MONTH, "emp1", item("IMG-1"))).resolves.toBeUndefined();
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(0);
  });
});

describe("pruning the mirror (A6)", () => {
  const NOW = Date.parse("2026-09-29T09:00:00.000Z");
  const old = new Date(NOW - MIRROR_SYNCED_RETENTION_MS - 86_400_000).toISOString();
  const recent = new Date(NOW - 86_400_000).toISOString();

  it("prunes old synced records once per session and NEVER a pending one, however old", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    for (const r of [
      stored("OLD-SYNCED", true, old),
      stored("OLD-PENDING", false, old),
      stored("RECENT-SYNCED", true, recent),
      stored("RECENT-PENDING", false, recent),
    ]) fake.table.set(r.key, r);

    const pending = await loadPendingAnswerRecords("emp1");
    expect(pending.map((p) => p.item.xrayImageId).sort()).toEqual(["OLD-PENDING", "RECENT-PENDING"]);
    // let the fire-and-forget prune transaction settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect([...fake.table.keys()].sort()).toEqual([
      `${MONTH}::emp1::OLD-PENDING`,
      `${MONTH}::emp1::RECENT-PENDING`,
      `${MONTH}::emp1::RECENT-SYNCED`,
    ]);
  });

  it("does not prune a record that was re-mirrored (mirroredAt refreshed) between the scan and the delete", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    fake.table.set(`${MONTH}::emp1::X`, stored("X", true, old));
    // A save confirms X right after the scan read it as old: the guarded delete re-checks.
    const realGetAll = fake.db.transaction;
    void realGetAll;
    const first = loadPendingAnswerRecords("emp1");
    fake.table.set(`${MONTH}::emp1::X`, stored("X", true, recent));
    await first;
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.table.has(`${MONTH}::emp1::X`)).toBe(true);
  });

  it("scans for stale records only once per connection, not on every 30 s replay tick", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const fake = createFakeIndexedDb<Stored>();
    vi.stubGlobal("indexedDB", fake.fakeIndexedDb);
    await loadPendingAnswerRecords("emp1");
    await new Promise((r) => setTimeout(r, 0));
    fake.table.set(`${MONTH}::emp1::LATE-OLD`, stored("LATE-OLD", true, old));
    await loadPendingAnswerRecords("emp1");
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.table.has(`${MONTH}::emp1::LATE-OLD`)).toBe(true); // second tick did not prune
  });
});
