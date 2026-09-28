/**
 * CRITICAL (fix round 2, extended fix round 3, corrected fix round 4):
 * `answerLocalMirror.test.ts`'s own note explains why this repo's test
 * environment has no real IndexedDB at all (jsdom doesn't ship it, and
 * there is no `fake-indexeddb` dependency). `backfillMirrorFromDisk` and
 * `mirrorAnswerLocally` now delegate to TWO DIFFERENT pure decision
 * functions — `shouldRefreshMirrorFromDisk` (backfill: never touches a
 * pending record) and `shouldConfirmMirrorRecord` (confirmation: DOES clear
 * a pending record unless it is itself strictly newer than the incoming
 * confirm) — both unit-tested directly and without any IndexedDB in that
 * file. Fix round 3 wrongly had `mirrorAnswerLocally` share
 * `shouldRefreshMirrorFromDisk`'s "never touch a pending record" rule,
 * which meant a pending item could NEVER be confirmed once queued — the
 * exact stuck-queue symptom this whole task exists to fix; `countPendingAnswers`
 * would never reach 0. This file additionally stubs a small, self-contained,
 * purpose-built fake `indexedDB` (`../storage/fakeIndexedDb.testHelper.ts` —
 * supporting exactly the operations `answerLocalMirror.ts` uses:
 * `open`/`onupgradeneeded`, `get`/`getAll`/`put` inside one transaction,
 * `oncomplete`) so both guarded write paths get real, end-to-end coverage of
 * the exact scenarios the reviewer asked for, not just the pure functions
 * they delegate to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeIndexedDb } from "../storage/fakeIndexedDb.testHelper";
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

// CRITICAL (fix round 3, corrected fix round 4): `mirrorAnswerLocally` --
// the function `replayPendingAnswers`'s `deps.markSynced` calls by default,
// and `performAnswerWrite` (answerStorage.ts) calls after every successful
// save -- carries AUTHORITATIVE knowledge that its `item` really is on disk
// right now, so it uses `shouldConfirmMirrorRecord`, NOT
// `shouldRefreshMirrorFromDisk`: it DOES clear a pending record when
// confirming it (that is the entire point of confirming one), refusing only
// when the existing pending record is itself strictly NEWER than the
// incoming confirm -- a genuinely newer, still-unsaved edit racing against
// a stale confirmation of an older version of the same item.
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

  // The three required fix-round-4 scenarios, stated precisely against
  // `shouldConfirmMirrorRecord`'s boundary: pending at T, confirm at T
  // (equal) clears it; pending at T, confirm at T' > T clears it; pending
  // at T', confirm at T < T' (the test above) is refused.
  it("marking pending at T, then confirming the SAME item (T) clears the pending flag", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-4", "2026-09-28T10:00:00.000Z"));
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);

    // replayPendingAnswers landed this EXACT item (or verified it already
    // matches disk) and confirms it with the SAME lastSavedAt.
    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-4", "2026-09-28T10:00:00.000Z"));

    expect(await countPendingAnswers(MONTH, "emp1")).toBe(0); // cleared
    const stored = table.get("5-may-2026::emp1::IMG-4");
    expect(stored?.synced).toBe(true);
  });

  it("marking pending at T, then confirming a NEWER item (T' > T) clears the pending flag", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-5", "2026-09-28T10:00:00.000Z"));
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);

    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-5", "2026-09-28T11:00:00.000Z"));

    expect(await countPendingAnswers(MONTH, "emp1")).toBe(0); // cleared
    const stored = table.get("5-may-2026::emp1::IMG-5");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T11:00:00.000Z");
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

// Follow-up (16b): an OLDER save that fails late must not replace a NEWER
// pending edit already queued for the same item.
describe("markAnswerPendingLocally (older failed save vs newer pending, real fake-IDB)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pending T2, then mark-pending T1 (older) -> T2 is kept", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-6", "2026-09-28T12:00:00.000Z"));
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-6", "2026-09-28T10:00:00.000Z"));

    const stored = table.get("5-may-2026::emp1::IMG-6");
    expect(stored?.synced).toBe(false);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T12:00:00.000Z");
    expect(await countPendingAnswers(MONTH, "emp1")).toBe(1);
  });

  it("pending T1, then mark-pending T2 (newer) -> T2 replaces it and stays pending", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-7", "2026-09-28T10:00:00.000Z"));
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-7", "2026-09-28T12:00:00.000Z"));

    const stored = table.get("5-may-2026::emp1::IMG-7");
    expect(stored?.synced).toBe(false);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T12:00:00.000Z");
  });

  it("an equal-timestamp legacy stamp (no milliseconds) still writes and stays pending", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb<StoredRecord>();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-8", "2026-09-28T10:00:00.000Z"));
    await markAnswerPendingLocally(MONTH, "emp1", item("IMG-8", "2026-09-28T10:00:00Z"));

    expect(table.get("5-may-2026::emp1::IMG-8")?.synced).toBe(false);
  });
});
