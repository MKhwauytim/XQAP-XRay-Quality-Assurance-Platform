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

import { useEffect, useState } from "react";

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

function notify(): void {
  subscribers.forEach((fn) => fn());
}

function getEntries(): BootSourceEntry[] {
  return Array.from(sources.values());
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
  sources.clear();
  notify();
}

function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** React hook -- subscribes to the store, re-renders on any registration/status change. */
export function useBootProgress(): { entries: BootSourceEntry[]; allLoaded: boolean } {
  const [entries, setEntries] = useState<BootSourceEntry[]>(() => getEntries());
  useEffect(() => {
    // Re-read the snapshot INSIDE the subscribing effect, not just in the
    // useState initializer above. The initializer runs during the first
    // render; this effect runs strictly later -- and per React's own
    // child-before-parent effect ordering, it runs AFTER the landing tab's
    // own mount effect has already called registerBootSources +
    // markBootSourceLoading (Population's useMonthLoad.ts, Employee
    // Workspace's XrayReferrals.tsx -- both descendants of the component
    // that renders the checklist). Those calls' notify() fire while this
    // hook still has no subscriber, so without this re-read they are lost
    // outright: `entries` would stay [] forever, `[].every(...)` is
    // vacuously true, and the checklist would never show at all.
    //
    // This is the "subscribe for updates from an external system" case the
    // set-state-in-effect rule explicitly allows for, just with the store's
    // missed-update gap closed: exactly one extra render per mount, never a
    // cascade (the deps array is empty, and the value read is the same
    // snapshot the subscription itself would deliver).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store snapshot re-read, see above
    setEntries(getEntries());
    return subscribe(() => setEntries(getEntries()));
  }, []);
  const allLoaded = entries.every((entry) => isTerminal(entry.status));
  return { entries, allLoaded };
}
