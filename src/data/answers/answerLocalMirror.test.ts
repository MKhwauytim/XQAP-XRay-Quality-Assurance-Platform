import { describe, expect, it } from "vitest";

import {
  backfillMirrorFromDisk,
  countPendingAnswers,
  loadMirroredAnswers,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
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
