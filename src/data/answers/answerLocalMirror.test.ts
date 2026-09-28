import { describe, expect, it } from "vitest";

import {
  backfillMirrorFromDisk,
  countPendingAnswers,
  loadMirroredAnswers,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
  shouldConfirmMirrorRecord,
  shouldQueueMirrorRecord,
  shouldRefreshMirrorFromDisk,
  type MirroredItemInfo,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

// This suite runs in the default `node` test environment, which has no
// `indexedDB` global at all (unlike jsdom's DOM APIs, IndexedDB is not part
// of jsdom either — a real browser or a shim like fake-indexeddb is needed
// for that). What matters here is exactly the contract the module's own doc
// comment promises: with no IndexedDB available, every call degrades to a
// silent no-op rather than throwing — the real browser behavior is exercised
// manually (see the PR description) since introducing a new IndexedDB test
// shim is out of scope for this fix.
function item(id: string, lastSavedAt = "2026-09-09T00:00:00.000Z"): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "tpl-1",
    templateVersion: 1,
    answers: [],
    lastSavedAt,
    submittedAt: null,
    answeredBy: "emp1",
    status: "draft",
  };
}

describe("answerLocalMirror (no IndexedDB in this test environment)", () => {
  it("mirrorAnswerLocally never throws", async () => {
    await expect(mirrorAnswerLocally("5-may-2026", "emp1", item("X1"))).resolves.toBeUndefined();
  });

  it("loadMirroredAnswers resolves to an empty array rather than throwing or returning null", async () => {
    await expect(loadMirroredAnswers("5-may-2026", "emp1")).resolves.toEqual([]);
  });

  it("markAnswerPendingLocally never throws", async () => {
    await expect(markAnswerPendingLocally("5-may-2026", "emp1", item("X1"))).resolves.toBeUndefined();
  });

  it("countPendingAnswers resolves to 0 rather than throwing", async () => {
    await expect(countPendingAnswers("5-may-2026", "emp1")).resolves.toBe(0);
  });

  it("backfillMirrorFromDisk never throws", async () => {
    await expect(
      backfillMirrorFromDisk("5-may-2026", "emp1", [item("X1")])
    ).resolves.toBeUndefined();
  });
});

// CRITICAL fix round 2: the actual bug and its fix live entirely in this
// pure decision function, so it is unit-tested directly and independent of
// IndexedDB (see the module-level note above on why this test environment
// has none at all). `backfillMirrorFromDisk` itself only ever calls this
// function to decide whether to issue a `put` -- it is the single source of
// truth the reviewer asked for.
describe("shouldRefreshMirrorFromDisk", () => {
  function record(overrides?: Partial<MirroredItemInfo>): MirroredItemInfo {
    return { synced: true, item: item("X1", "2026-09-01T00:00:00.000Z"), ...overrides };
  }

  it("says yes when there is no existing record at all", () => {
    expect(shouldRefreshMirrorFromDisk(undefined, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
  });

  it("says NO for a still-pending (synced: false) record, even when disk is newer -- never clobber an unsaved edit", () => {
    const existing = record({ synced: false, item: item("X1", "2026-09-01T00:00:00.000Z") });
    const newerDiskItem = item("X1", "2026-09-05T00:00:00.000Z");
    expect(shouldRefreshMirrorFromDisk(existing, newerDiskItem)).toBe(false);
  });

  it("says yes for a synced record when disk holds a strictly newer item", () => {
    const existing = record({ synced: true, item: item("X1", "2026-09-01T00:00:00.000Z") });
    const newerDiskItem = item("X1", "2026-09-05T00:00:00.000Z");
    expect(shouldRefreshMirrorFromDisk(existing, newerDiskItem)).toBe(true);
  });

  it("says NO for a synced record when disk holds the SAME lastSavedAt -- nothing to refresh", () => {
    const existing = record({ synced: true, item: item("X1", "2026-09-01T00:00:00.000Z") });
    expect(shouldRefreshMirrorFromDisk(existing, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(false);
  });

  it("says NO for a synced record when disk holds an OLDER item -- never let disk regress the mirror", () => {
    const existing = record({ synced: true, item: item("X1", "2026-09-05T00:00:00.000Z") });
    const olderDiskItem = item("X1", "2026-09-01T00:00:00.000Z");
    expect(shouldRefreshMirrorFromDisk(existing, olderDiskItem)).toBe(false);
  });
});

// CRITICAL fix round 4: `shouldRefreshMirrorFromDisk`'s "never touch a
// pending record" rule is right for an OPPORTUNISTIC disk read
// (`backfillMirrorFromDisk`) but wrong for a CONFIRMATION
// (`mirrorAnswerLocally`, called with authoritative knowledge that `item`
// really is on disk now) -- fix round 3 wrongly reused the former for the
// latter, which meant a pending record could never be confirmed at all
// (countPendingAnswers stuck > 0 forever). `shouldConfirmMirrorRecord` is
// the corrected, separate rule: it DOES clear a pending record, refusing
// only when the pending record is itself strictly newer than the incoming
// confirm.
describe("shouldConfirmMirrorRecord", () => {
  function record(overrides?: Partial<MirroredItemInfo>): MirroredItemInfo {
    return { synced: true, item: item("X1", "2026-09-01T00:00:00.000Z"), ...overrides };
  }

  it("says yes when there is no existing record at all", () => {
    expect(shouldConfirmMirrorRecord(undefined, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
  });

  it("says yes for a pending record confirmed at the SAME lastSavedAt -- clears the pending flag", () => {
    const existing = record({ synced: false, item: item("X1", "2026-09-01T00:00:00.000Z") });
    expect(shouldConfirmMirrorRecord(existing, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
  });

  it("says yes for a pending record confirmed at a NEWER lastSavedAt -- clears the pending flag", () => {
    const existing = record({ synced: false, item: item("X1", "2026-09-01T00:00:00.000Z") });
    const newerConfirm = item("X1", "2026-09-05T00:00:00.000Z");
    expect(shouldConfirmMirrorRecord(existing, newerConfirm)).toBe(true);
  });

  it("says NO for a pending record when the incoming confirm is OLDER -- the pending record is itself the newer, unsaved edit", () => {
    const existing = record({ synced: false, item: item("X1", "2026-09-05T00:00:00.000Z") });
    const olderConfirm = item("X1", "2026-09-01T00:00:00.000Z");
    expect(shouldConfirmMirrorRecord(existing, olderConfirm)).toBe(false);
  });

  it("says yes for an already-synced record when the incoming confirm is not older", () => {
    const existing = record({ synced: true, item: item("X1", "2026-09-01T00:00:00.000Z") });
    expect(shouldConfirmMirrorRecord(existing, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(shouldConfirmMirrorRecord(existing, item("X1", "2026-09-05T00:00:00.000Z"))).toBe(true);
  });

  it("says NO for an already-synced record when the incoming confirm is OLDER -- never regress it", () => {
    const existing = record({ synced: true, item: item("X1", "2026-09-05T00:00:00.000Z") });
    expect(shouldConfirmMirrorRecord(existing, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("shouldQueueMirrorRecord", () => {
  const rec = (synced: boolean, at: string): MirroredItemInfo => ({ synced, item: item("X1", at) });

  it("writes when nothing exists", () => {
    expect(shouldQueueMirrorRecord(undefined, item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
  });
  it("refuses an OLDER failed save over a newer pending record", () => {
    expect(shouldQueueMirrorRecord(rec(false, "2026-09-05T00:00:00.000Z"), item("X1", "2026-09-01T00:00:00.000Z"))).toBe(false);
  });
  it("writes an equal or newer item over a pending record", () => {
    expect(shouldQueueMirrorRecord(rec(false, "2026-09-01T00:00:00.000Z"), item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(shouldQueueMirrorRecord(rec(false, "2026-09-01T00:00:00.000Z"), item("X1", "2026-09-05T00:00:00.000Z"))).toBe(true);
  });
  it("compares instants, not strings: a legacy no-ms stamp is not 'newer' than .000 of the same second", () => {
    expect(shouldConfirmMirrorRecord(rec(false, "2026-09-01T00:00:00Z"), item("X1", "2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(shouldRefreshMirrorFromDisk(rec(true, "2026-09-01T00:00:00.000Z"), item("X1", "2026-09-01T00:00:00Z"))).toBe(false);
  });
});
