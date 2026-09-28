/**
 * CRITICAL (fix round 2, extended fix round 3): `answerLocalMirror.test.ts`'s
 * own note explains why this repo's test environment has no real IndexedDB
 * at all (jsdom doesn't ship it, and there is no `fake-indexeddb`
 * dependency). `shouldRefreshMirrorFromDisk` — the actual decision both
 * `backfillMirrorFromDisk` AND `mirrorAnswerLocally` delegate to (fix round
 * 3: the same guard, reused, not duplicated) — is unit-tested directly and
 * without any IndexedDB in that file. This file additionally stubs a small,
 * self-contained, purpose-built fake `indexedDB` (supporting exactly the
 * operations `answerLocalMirror.ts` uses: `open`/`onupgradeneeded`,
 * `get`/`getAll`/`put` inside one transaction, `oncomplete`) so both guarded
 * write paths get real, end-to-end coverage of the exact scenarios the
 * reviewer asked for, not just the pure function they delegate to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexedDb } from "../storage/fakeIndexedDb";
import {
  backfillMirrorFromDisk,
  countPendingAnswers,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

type StoredRecord = { key: string; month: string; username: string; xrayImageId: string; item: ItemAnswer; mirroredAt: string; synced: boolean };

function item(id: string, lastSavedAt: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "tpl-1",
    templateVersion: 1,
    answers: [],
    lastSavedAt,
    submittedAt: null,
    answeredBy: "emp1",
    status: "submitted",
  };
}

const MONTH = "5-may-2026";

describe("backfillMirrorFromDisk (CRITICAL, fix round 2, real fake-IDB end-to-end)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never overwrites a pending (synced: false) record with an older on-disk item -- it stays pending, count unchanged", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    // The employee re-edited and re-saved IMG-1; that save is itself queued
    // as pending (synced: false) with a NEWER lastSavedAt than what is
    // (still) on disk -- disk has not caught up yet.
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-1", "2026-09-28T12:00:00.000Z"));
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);

    // The disk read used for backfill sees the OLDER version (the one
    // before the re-edit).
    await backfillMirrorFromDisk(MONTH, "emp1", [item("IMG-1", "2026-09-28T10:00:00.000Z")]);

    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1); // still pending
    const stored = table.get("5-may-2026::emp1::IMG-1");
    expect(stored?.synced).toBe(false);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T12:00:00.000Z"); // the pending edit, not overwritten
  });

  it("refreshes a synced record whose stored item is older than what is now on disk", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-2", "2026-09-28T09:00:00.000Z"));

    await backfillMirrorFromDisk(MONTH, "emp1", [item("IMG-2", "2026-09-28T11:00:00.000Z")]);

    const stored = table.get("5-may-2026::emp1::IMG-2");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T11:00:00.000Z"); // refreshed from disk
  });

  it("writes a brand-new record for a key that was never mirrored before", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await backfillMirrorFromDisk(MONTH, "emp1", [item("IMG-3", "2026-09-28T09:00:00.000Z")]);

    const stored = table.get("5-may-2026::emp1::IMG-3");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.xrayImageId).toBe("IMG-3");
  });

  it("batches an entire month's items into ONE transaction, not one open/transaction per item", async () => {
    const { fakeIndexedDb } = createFakeIndexedDb<StoredRecord>();
    let openCalls = 0;
    const countingIndexedDb = {
      open: (...args: Parameters<typeof fakeIndexedDb.open>) => {
        openCalls += 1;
        return fakeIndexedDb.open(...args);
      },
    };
    vi.stubGlobal("indexedDB", countingIndexedDb);

    await backfillMirrorFromDisk(MONTH, "emp1", [
      item("IMG-A", "2026-09-28T09:00:00.000Z"),
      item("IMG-B", "2026-09-28T09:00:00.000Z"),
      item("IMG-C", "2026-09-28T09:00:00.000Z"),
    ]);

    expect(openCalls).toBe(1); // one openMirrorDb() call for the whole batch
  });
});

// CRITICAL (fix round 3): the SAME guard `backfillMirrorFromDisk` uses also
// protects `mirrorAnswerLocally` -- the function `replayPendingAnswers`'s
// `deps.markSynced` calls by default, and `performAnswerWrite`
// (answerStorage.ts) calls after every successful save. Without it, either
// caller could clobber a NEWER pending (synced: false) record for the same
// key -- an employee re-saving the same item WHILE a replay pass or a
// slower concurrent write is still in flight for an OLDER version of it.
describe("mirrorAnswerLocally (CRITICAL, fix round 3, real fake-IDB end-to-end)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not overwrite a newer pending (synced: false) record when confirming an older item -- the newer edit survives", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    // The employee re-saved IMG-1 WHILE a replay pass (or a slower
    // concurrent write of the earlier version) was still in flight; that
    // re-save itself failed and is queued pending with a NEWER lastSavedAt.
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-1", "2026-09-28T12:00:00.000Z"));
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);

    // The in-flight pass now tries to confirm the OLDER item it read
    // earlier -- e.g. replayPendingAnswers's own deps.markSynced call, or
    // performAnswerWrite's post-success mirror call for a slower write.
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-1", "2026-09-28T10:00:00.000Z"));

    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1); // still pending -- not clobbered
    const stored = table.get("5-may-2026::emp1::IMG-1");
    expect(stored?.synced).toBe(false);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T12:00:00.000Z"); // the newer edit, untouched
  });

  it("marks synced normally when there is no newer (or no) existing record -- the ordinary case", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-2", "2026-09-28T09:00:00.000Z"));

    const stored = table.get("5-may-2026::emp1::IMG-2");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T09:00:00.000Z");
  });

  it("refreshes an older SYNCED record when confirming a newer item -- a real, later save landing", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-3", "2026-09-28T09:00:00.000Z"));
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-3", "2026-09-28T11:00:00.000Z"));

    const stored = table.get("5-may-2026::emp1::IMG-3");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T11:00:00.000Z");
  });
});
