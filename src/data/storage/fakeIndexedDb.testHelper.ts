/**
 * A small, self-contained, purpose-built fake `indexedDB` for tests that
 * need to exercise real IndexedDB-backed code end-to-end. This repo's test
 * environment has no real IndexedDB at all — jsdom does not ship it, and
 * there is no `fake-indexeddb` dependency (see `answerLocalMirror.test.ts`'s
 * own note) — so a caller with genuinely IndexedDB-shaped logic to verify
 * (a guarded get-then-put, a batched multi-item transaction, …) needs
 * something that behaves like the real API's request/transaction lifecycle,
 * not just a plain in-memory Map swapped in for the whole module.
 *
 * Supports exactly what `answerLocalMirror.ts` uses: `open` /
 * `onupgradeneeded`, a single object store's `get` / `getAll` / `put`
 * inside one `readwrite` transaction, and `transaction.oncomplete` firing
 * only once every request issued by that transaction — including one
 * issued synchronously from inside another request's own `onsuccess`
 * handler (a `put` fired from a `get`'s callback) — has settled. Nothing
 * beyond that (indexes, cursors, multiple stores, versioned upgrades) is
 * implemented; add to it only when a real caller needs it.
 *
 * Usage: `vi.stubGlobal("indexedDB", createFakeIndexedDb().fakeIndexedDb)`
 * before the module under test opens its database, and `vi.unstubAllGlobals()`
 * in `afterEach`. `table` gives direct read access to the stored rows for
 * assertions.
 */
export function createFakeIndexedDb<TRecord extends { key: string }>() {
  const table = new Map<string, TRecord>();
  let storeCreated = false;
  let pendingRequests = 0;
  let closeCalls = 0;
  let openCalls = 0;

  function makeRequest<T>(work: () => T): {
    result?: T;
    error?: unknown;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  } {
    const request: {
      result?: T;
      error?: unknown;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    } = { onsuccess: null, onerror: null };
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
      put: (value: TRecord) => makeRequest(() => { table.set(value.key, value); return undefined; }),
      delete: (key: string) => makeRequest(() => { table.delete(key); return undefined; }),
    };
  }

  function transaction() {
    const tx: {
      oncomplete: (() => void) | null;
      onerror: (() => void) | null;
      onabort: (() => void) | null;
      objectStore: () => ReturnType<typeof objectStore>;
      error?: unknown;
    } = { oncomplete: null, onerror: null, onabort: null, objectStore };
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
    close: () => { closeCalls += 1; },
    // Handlers the module under test may install; tests call them to simulate the browser.
    onversionchange: null as (() => void) | null,
    onclose: null as (() => void) | null,
  };

  const fakeIndexedDb = {
    open: (_name: string, _version: number) => {
      openCalls += 1;
      const request: {
        result?: typeof db;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        request.result = db;
        if (!storeCreated) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    fakeIndexedDb,
    table,
    db,
    /** How many times the module under test called `db.close()`. */
    getCloseCalls: () => closeCalls,
    /** How many times it called `indexedDB.open()`. */
    getOpenCalls: () => openCalls,
  };
}
