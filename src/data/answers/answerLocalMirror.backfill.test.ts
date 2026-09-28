/**
 * CRITICAL (fix round 2): `answerLocalMirror.test.ts`'s own note explains why
 * this repo's test environment has no real IndexedDB at all (jsdom doesn't
 * ship it, and there is no `fake-indexeddb` dependency). `shouldRefreshMirrorFromDisk`
 * — the actual decision the fix hinges on — is unit-tested directly and
 * without any IndexedDB in that file. This file additionally stubs a small,
 * self-contained, purpose-built fake `indexedDB` (supporting exactly the
 * operations `answerLocalMirror.ts` uses: `open`/`onupgradeneeded`,
 * `get`/`getAll`/`put` inside one transaction, `oncomplete`) so
 * `backfillMirrorFromDisk` itself — including the ONE-transaction batching
 * and the get-then-conditionally-put flow — gets real, end-to-end coverage
 * of the exact scenarios the reviewer asked for, not just the pure function
 * it delegates the decision to.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backfillMirrorFromDisk,
  countPendingAnswers,
  markAnswerPendingLocally,
  mirrorAnswerLocally,
} from "./answerLocalMirror";
import type { ItemAnswer } from "./answerTypes";

type StoredRecord = { key: string; month: string; username: string; xrayImageId: string; item: ItemAnswer; mirroredAt: string; synced: boolean };

function createFakeIndexedDb() {
  const table = new Map<string, StoredRecord>();
  let storeCreated = false;
  let pendingRequests = 0;

  function makeRequest<T>(work: () => T): { result?: T; error?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } {
    const request: { result?: T; error?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      onsuccess: null,
      onerror: null,
    };
    pendingRequests += 1;
    queueMicrotask(() => {
      try {
        request.result = work();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
      } finally {
        pendingRequests -= 1;
      }
    });
    return request;
  }

  function objectStore() {
    return {
      get: (key: string) => makeRequest(() => table.get(key)),
      getAll: () => makeRequest(() => [...table.values()]),
      put: (value: StoredRecord) => makeRequest(() => { table.set(value.key, value); return undefined; }),
    };
  }

  function transaction() {
    const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; objectStore: () => ReturnType<typeof objectStore>; error?: unknown } = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      objectStore,
    };
    // "Commits" once no request issued by this transaction (directly, or
    // from another request's onsuccess handler -- e.g. a put fired from a
    // get's callback) is still pending, given one extra microtask turn to
    // let any such chained request actually get issued first.
    const checkComplete = () => {
      if (pendingRequests > 0) {
        queueMicrotask(checkComplete);
        return;
      }
      queueMicrotask(() => {
        if (pendingRequests === 0) tx.oncomplete?.();
        else checkComplete();
      });
    };
    queueMicrotask(checkComplete);
    return tx;
  }

  const db = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => { storeCreated = true; return objectStore(); },
    transaction,
    close: () => {},
  };

  const fakeIndexedDb = {
    open: (_name: string, _version: number) => {
      const request: { result?: typeof db; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null } = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        request.result = db;
        if (!storeCreated) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return { fakeIndexedDb, table };
}

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
    const { fakeIndexedDb, table } = createFakeIndexedDb();
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
    const { fakeIndexedDb, table } = createFakeIndexedDb();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await mirrorAnswerLocally(MONTH, "emp1", item("IMG-2", "2026-09-28T09:00:00.000Z"));

    await backfillMirrorFromDisk(MONTH, "emp1", [item("IMG-2", "2026-09-28T11:00:00.000Z")]);

    const stored = table.get("5-may-2026::emp1::IMG-2");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.lastSavedAt).toBe("2026-09-28T11:00:00.000Z"); // refreshed from disk
  });

  it("writes a brand-new record for a key that was never mirrored before", async () => {
    const { fakeIndexedDb, table } = createFakeIndexedDb();
    vi.stubGlobal("indexedDB", fakeIndexedDb);

    await backfillMirrorFromDisk(MONTH, "emp1", [item("IMG-3", "2026-09-28T09:00:00.000Z")]);

    const stored = table.get("5-may-2026::emp1::IMG-3");
    expect(stored?.synced).toBe(true);
    expect(stored?.item.xrayImageId).toBe("IMG-3");
  });

  it("batches an entire month's items into ONE transaction, not one open/transaction per item", async () => {
    const { fakeIndexedDb } = createFakeIndexedDb();
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
