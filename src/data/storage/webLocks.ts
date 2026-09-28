import type { DirectoryHandleLike } from "./fileSystemAccess";

/**
 * Item 1.11 — lock-key path registry.
 *
 * Lock keys used to be built from the leaf folder name alone (`dir.name`), so
 * every month's `2-samples/{month}/1-main/sample.master.json` produced the
 * identical key `1-main/sample.master.json` and contended on ONE lock across
 * the whole app. Directory handles carry no path in the File System Access
 * API, so the path has to be remembered on the side: `workspacePaths.ts`
 * registers the logical path of every directory it hands out, and
 * `createMemoryDirectory` does the same for test trees. Anything not
 * registered falls back to `dir.name`, i.e. exactly the old behaviour.
 *
 * The registered path deliberately excludes any per-session workspace id: a
 * key that is *too coarse* only over-serializes (safe), whereas a key that
 * differs between two references to the same folder would under-lock.
 */
const directoryPaths = new WeakMap<DirectoryHandleLike, string>();

/** Remember the workspace-relative path of a directory handle. */
export function registerDirectoryPath(dir: DirectoryHandleLike, path: string): void {
  if (!path) return;
  directoryPaths.set(dir, path);
}

/** Registered path for a directory handle, or `dir.name` when unregistered. */
export function directoryPath(dir: DirectoryHandleLike): string {
  return directoryPaths.get(dir) ?? dir.name;
}

/** Lock key for a file inside a directory: full path when known, leaf otherwise. */
export function directoryResourceKey(dir: DirectoryHandleLike, entryName: string): string {
  return `${directoryPath(dir)}/${entryName}`;
}

type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<unknown>
  ) => Promise<unknown>;
};

function getNativeLockManager(): LockManagerLike | null {
  const nav = globalThis.navigator as Navigator & {
    locks?: LockManagerLike;
  };
  return nav?.locks ?? null;
}

// Fallback: one promise chain per resource name, serializing within this thread.
const fallbackChains = new Map<string, Promise<unknown>>();

async function withFallbackLock<T>(
  name: string,
  callback: () => Promise<T>
): Promise<T> {
  const previous = fallbackChains.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  fallbackChains.set(name, next);

  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    // Drop the chain entry if no one queued behind us.
    if (fallbackChains.get(name) === next) {
      fallbackChains.delete(name);
    }
  }
}

export async function withResourceLock<T>(
  resourceName: string,
  callback: () => Promise<T>
): Promise<T> {
  const manager = getNativeLockManager();
  if (!manager) {
    return withFallbackLock(resourceName, callback);
  }

  return manager.request(
    `xray:${resourceName}`,
    { mode: "exclusive" },
    callback as () => Promise<unknown>
  ) as Promise<T>;
}

type TryLockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => Promise<unknown>
  ) => Promise<unknown>;
};

// Fallback for `withTryResourceLock` when the native Web Locks API is
// unavailable (non-Chromium, or a test/node environment): an in-memory
// held-set approximates try-lock semantics. This only protects THIS
// TAB/REALM, the same limitation `withFallbackLock` above already has for
// `withResourceLock` — the cross-tab case `withTryResourceLock` exists for
// IS the native API.
const fallbackHeld = new Set<string>();

/**
 * Try-lock variant of `withResourceLock`: if `resourceName` is already held
 * — by another tab, via the native Web Locks API, or (fallback path) by
 * this realm — the callback is SKIPPED rather than queued behind the
 * holder. Returns `{ ran: false }` in that case, `{ ran: true, result }`
 * once the callback actually ran. For a background poller that would rather
 * skip one tick than pile up behind (or serialize behind) a slow holder —
 * see `pendingAnswerReplay.ts`'s cross-tab guard.
 *
 * Fix round 3: `navigator.locks` existing is not the same as it WORKING —
 * the Web Locks API can refuse a request outright (a `SecurityError` on an
 * opaque origin, which `file://` — how this app is routinely opened, see
 * CLAUDE.md — commonly is) either synchronously (throwing before returning a
 * promise) or by rejecting the promise it returns. Either way, that refusal
 * is caught and falls through to the SAME in-memory fallback used when
 * `navigator.locks` is absent entirely — never left to reject this call (and
 * with it, the whole caller's pass: `replayPendingAnswers` has no outer
 * try/catch around this call). The one exception: if the native API had
 * already invoked OUR callback (`ran` is true) before something failed, the
 * error is rethrown rather than falling back and running the callback a
 * SECOND time — that ambiguous case is a genuine failure of the caller's own
 * work, not a reason to redo it.
 */
export async function withTryResourceLock<T>(
  resourceName: string,
  callback: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false }> {
  const manager = getNativeLockManager() as unknown as TryLockManagerLike | null;
  if (manager) {
    let ran = false;
    let result: T | undefined;
    try {
      await manager.request(
        `xray:${resourceName}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) return; // Not granted immediately -- someone else holds it.
          ran = true;
          result = await callback();
        }
      );
      return ran ? { ran: true, result: result as T } : { ran: false };
    } catch (error) {
      if (ran) throw error; // our own callback already ran -- surface its failure, never re-run it
      // The API exists but refused the request itself (sync throw or an
      // async rejection, before our callback ever ran) -- fall through to
      // the in-memory fallback below exactly as if it were unavailable.
    }
  }

  if (fallbackHeld.has(resourceName)) return { ran: false };
  fallbackHeld.add(resourceName);
  try {
    return { ran: true, result: await callback() };
  } finally {
    fallbackHeld.delete(resourceName);
  }
}
