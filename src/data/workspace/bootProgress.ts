/**
 * Post-login "data source checklist" pub/sub store.
 *
 * Other code declares, once per boot session (login or workspace switch),
 * which named on-disk sources it is about to load via `registerBootSources`,
 * then reports status transitions as each load runs via `markBootSourceLoading`
 * / `markBootSourceLoaded` / `markBootSourceError`. A splash/checklist screen
 * (not this module's concern) subscribes via `useBootProgress` to render the
 * list and know when it's safe to let the user into the app.
 *
 * Same "plain pub/sub, no external state library" shape as `dataRefreshSignal.ts`,
 * except the state here is a `Map<BootSourceKey, BootSourceEntry>` rather than a
 * single fire-and-forget event, since the checklist UI needs to read current
 * per-source status (not just react to a change notification).
 *
 * A source left in "error" does NOT block `allLoaded` -- one failed source
 * (e.g. a missing/corrupt optional file) must surface as a visible error badge,
 * not hang the whole boot screen forever and lock the user out of the app.
 */

import { useSyncExternalStore } from "react";

export type BootSourceStatus = "pending" | "loading" | "loaded" | "error";

export type BootSourceKey = string;

export type BootSourceEntry = {
  key: BootSourceKey;
  labelEn: string;
  labelAr: string;
  status: BootSourceStatus;
  error?: string;
};

type Subscriber = () => void;

const sources = new Map<BootSourceKey, BootSourceEntry>();
const subscribers = new Set<Subscriber>();

// Bumped by every resetBootProgress() call -- see `useBootProgress`'s
// `resetGeneration` field for why a consumer needs this, distinct from just
// comparing `entries`/`allLoaded`.
let resetGeneration = 0;

function computeEntries(): BootSourceEntry[] {
  return Array.from(sources.values());
}

// Cached, not recomputed per read: useSyncExternalStore's getSnapshot must
// return a referentially-stable value between notifications, or React sees a
// "new" snapshot on every render and re-renders forever. Refreshed exactly
// once per notify() -- the only place `sources` ever mutates.
let cachedEntries: BootSourceEntry[] = computeEntries();

function notify(): void {
  cachedEntries = computeEntries();
  subscribers.forEach((fn) => fn());
}

function getEntries(): BootSourceEntry[] {
  return cachedEntries;
}

function getResetGeneration(): number {
  return resetGeneration;
}

function isTerminal(status: BootSourceStatus): boolean {
  return status === "loaded" || status === "error";
}

/**
 * Declares which sources this boot session will load. Call once per login /
 * workspace switch, before any `markBootSource*` call referencing these keys.
 * Re-registering an already-known key resets it back to "pending".
 */
export function registerBootSources(
  entries: Array<{ key: BootSourceKey; labelEn: string; labelAr: string }>
): void {
  for (const entry of entries) {
    sources.set(entry.key, { ...entry, status: "pending" });
  }
  notify();
}

/** No-op if `key` was never registered (defensive -- a caller that races registration shouldn't throw). */
export function markBootSourceLoading(key: BootSourceKey): void {
  const existing = sources.get(key);
  if (!existing) return;
  sources.set(key, { ...existing, status: "loading", error: undefined });
  notify();
}

/** No-op if `key` was never registered. */
export function markBootSourceLoaded(key: BootSourceKey): void {
  const existing = sources.get(key);
  if (!existing) return;
  sources.set(key, { ...existing, status: "loaded", error: undefined });
  notify();
}

/** No-op if `key` was never registered. */
export function markBootSourceError(key: BootSourceKey, error: string): void {
  const existing = sources.get(key);
  if (!existing) return;
  sources.set(key, { ...existing, status: "error", error });
  notify();
}

/** Clears all registered sources. Call on logout or workspace switch so a stale role's checklist doesn't bleed into the next session. */
export function resetBootProgress(): void {
  resetGeneration++;
  sources.clear();
  notify();
}

function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * React hook -- subscribes to the store, re-renders on any registration/status
 * change. Built on useSyncExternalStore specifically (not useState+useEffect)
 * because that pairing has a real gap: the useState initializer captures a
 * snapshot at first render, but subscribing only happens later in useEffect --
 * and per React's own child-before-parent effect ordering, that runs AFTER a
 * child's own mount effect (Population's useMonthLoad.ts, Employee
 * Workspace's XrayReferrals.tsx both register/mark sources from their own
 * mount effects) has already published and found zero subscribers. That
 * update is lost outright. useSyncExternalStore has no such gap: React
 * re-reads getSnapshot() itself around the subscribe, so a publish that lands
 * between this component's render and its subscription is never missed.
 *
 * `resetGeneration` exists specifically for a caller (BootSplashOverlay) that
 * needs to know not just CURRENT `entries`/`allLoaded`, but whether those
 * values reflect a genuinely-fresh reset -- `entries`/`allLoaded` alone can't
 * distinguish "this session's own reset already landed" from "the previous
 * session's leftover data, reset call not run yet," and a component-local
 * `bootSessionKey`-changed check can't either: React can re-render a
 * component multiple times in the same commit before an effect (where the
 * actual reset call lives) has run at all, so by the time a consumer's own
 * "is my key up to date" check passes, the STORE itself may still be stale.
 * A monotonic counter, incremented only inside `resetBootProgress` itself, is
 * the one signal that can't lie about this.
 */
export function useBootProgress(): { entries: BootSourceEntry[]; allLoaded: boolean; resetGeneration: number } {
  const entries = useSyncExternalStore(subscribe, getEntries);
  const generation = useSyncExternalStore(subscribe, getResetGeneration);
  const allLoaded = entries.every((entry) => isTerminal(entry.status));
  return { entries, allLoaded, resetGeneration: generation };
}
