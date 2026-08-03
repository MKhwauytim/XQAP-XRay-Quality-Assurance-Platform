import type { DirectoryHandleLike } from "./fileSystemAccess";

/**
 * Coalesce OVERLAPPING calls sharing the same key: while the promise for
 * `key` is unsettled, subsequent callers share it. The entry is removed the
 * instant it settles (resolve OR reject), so this is deliberately NOT a TTL
 * cache -- there is no staleness window. A call started after the previous
 * one finished always performs fresh work.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function __clearInFlightForTests(): void {
  inFlight.clear();
  scopeIds = new WeakMap();
  nextScopeId = 1;
  epochs.clear();
}

let scopeIds = new WeakMap<DirectoryHandleLike, string>();
let nextScopeId = 1;

/** Stable per-workspace-root id, so two workspaces open in one session never
 *  collide on a dedupe/epoch key even if they share a month folder name. */
export function workspaceScopeId(root: DirectoryHandleLike): string {
  let id = scopeIds.get(root);
  if (!id) {
    id = `ws${nextScopeId++}`;
    scopeIds.set(root, id);
  }
  return id;
}

const epochs = new Map<string, number>();

function epochKey(root: DirectoryHandleLike, month: string): string {
  return `${workspaceScopeId(root)}|${month}`;
}

/** Bumped on every successful write to a (root, month) pair. Included in
 *  dedupeInFlight keys so a post-write read can never coalesce with a
 *  pre-write read that happened to still be in flight -- defence-in-depth
 *  even if a future write path is mistakenly migrated to a deduped read.
 *  Per-tab only: it is sufficient to invalidate, never necessary for
 *  cross-machine freshness, which continues to come from each domain's own
 *  revision/_writeToken/contentHash mechanisms exactly as today. */
export function bumpWorkspaceEpoch(root: DirectoryHandleLike, month: string): void {
  const key = epochKey(root, month);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
}

export function workspaceEpoch(root: DirectoryHandleLike, month: string): number {
  return epochs.get(epochKey(root, month)) ?? 0;
}
