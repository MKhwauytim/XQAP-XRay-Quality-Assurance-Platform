/**
 * App-wide "refresh workspace data" signal — mirrors the
 * `xray-user-management-change` pattern in `auth/userManagement.ts`, but for
 * everything else that reads workspace disk state (samples, distribution,
 * referrals/replacements/reopens, notifications, answers, ...).
 *
 * Broadcast by the manual refresh button (AdminToolbar) and the sync tick
 * (`SyncTick.tsx`, rendered inside `AuthGate`'s `GlobalMonthProvider`); any
 * view that loads workspace data on mount can subscribe to re-run its own
 * load function when this fires, so an action taken by another
 * user/tab/machine (a reassigned sample, a posted notification, an approved
 * referral) shows up without a full page reload.
 *
 * This only broadcasts a "go re-read your data" signal within the current
 * tab — it does not itself read or write anything on disk.
 */

const DATA_REFRESH_EVENT_NAME = "xray-data-refresh";

/**
 * "manual" -- the admin toolbar's explicit refresh button; an admin asked
 * for a hard refresh, so subscribers may treat this as license to discard
 * any local cache entirely.
 * "periodic" -- the sync tick; subscribers should re-read their own data,
 * but a subscriber holding a cache with its own correct invalidation (e.g.
 * the append-only directory cache) should NOT wholesale-reset on this
 * source -- that would defeat the cache for no correctness benefit.
 */
export type DataRefreshSource = "manual" | "periodic";

/**
 * Per-family change set (§4.2 of the perf/sync spec). The sync tick computes
 * one of these per tick and broadcasts only the families it actually found
 * changed -- never a single global "something changed" gate, because gating
 * the whole tick on (for example) the distribution stamp alone would starve
 * notifications, new referral/replacement/reopen requests, answer
 * submissions, manifest changes, and permission propagation, none of which
 * touch the distribution log.
 */
export type DataRefreshFamily = "distribution" | "notifications" | "requests" | "answers" | "manifest";

/** Every family, in a stable order -- used as the "everything changed"
 *  shorthand for the back-compat bare-string "periodic" broadcast below, and
 *  as a convenient default for callers that want to react to any change. */
export const ALL_DATA_REFRESH_FAMILIES: readonly DataRefreshFamily[] = [
  "distribution",
  "notifications",
  "requests",
  "answers",
  "manifest",
];

export type DataRefreshDetail =
  | { source: "manual" }
  | { source: "periodic"; changed: ReadonlySet<DataRefreshFamily> };

function isDataRefreshDetail(value: unknown): value is DataRefreshDetail {
  return typeof value === "object" && value !== null && "source" in value;
}

/**
 * Broadcast a refresh. Two call shapes:
 * - `broadcastDataRefresh()` / `broadcastDataRefresh("manual")` /
 *   `broadcastDataRefresh("periodic")` -- the pre-existing bare-string form,
 *   kept working so no subscriber written before the change-set contract
 *   existed breaks mid-migration. A bare `"periodic"` is treated as "every
 *   family changed" (`ALL_DATA_REFRESH_FAMILIES`) -- the same "discard
 *   everything and re-read" semantics the old signal always had.
 * - `broadcastDataRefresh({ source: "periodic", changed })` -- the granular
 *   form the sync tick uses, naming exactly which families changed this
 *   tick.
 */
export function broadcastDataRefresh(source?: DataRefreshSource): void;
export function broadcastDataRefresh(detail: DataRefreshDetail): void;
export function broadcastDataRefresh(arg: DataRefreshSource | DataRefreshDetail = "manual"): void {
  const detail: DataRefreshDetail = isDataRefreshDetail(arg)
    ? arg
    : arg === "periodic"
      ? { source: "periodic", changed: new Set(ALL_DATA_REFRESH_FAMILIES) }
      : { source: "manual" };
  window.dispatchEvent(new CustomEvent<DataRefreshDetail>(DATA_REFRESH_EVENT_NAME, { detail }));
}

/**
 * Back-compat subscription: delivers just the bare `DataRefreshSource`
 * string, exactly as before the change-set contract was added. Every
 * pre-existing subscriber keeps working unmodified -- `changed` is dropped
 * for these callers, so they still re-run on every periodic tick regardless
 * of which families actually changed (correct but non-optimal; migrate to
 * `subscribeToDataChange` to opt into the narrower behavior).
 */
export function subscribeToDataRefresh(
  callback: (source: DataRefreshSource) => void
): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<DataRefreshDetail>).detail.source);
  };
  window.addEventListener(DATA_REFRESH_EVENT_NAME, handler);
  return () => {
    window.removeEventListener(DATA_REFRESH_EVENT_NAME, handler);
  };
}

/**
 * Change-set-aware subscription (§4.2). `families` names which families this
 * subscriber cares about. The callback fires:
 * - on every `"manual"` broadcast (unconditional discard-everything
 *   semantics -- the safety valve if a family probe ever misses a mutation
 *   class), with `{ source: "manual" }`;
 * - on a `"periodic"` broadcast only when `changed` intersects `families`,
 *   with `{ source: "periodic", changed }` (the full changed set, not just
 *   the intersection -- callers reacting to more than one family want to
 *   know exactly what changed, not just that something in their list did).
 *
 * Unchanged (no broadcast reaches this callback at all) ⇒ zero invalidation,
 * zero setState, zero re-render -- the whole point of moving off a single
 * global reload gate.
 */
export function subscribeToDataChange(
  families: readonly DataRefreshFamily[],
  callback: (detail: DataRefreshDetail) => void
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<DataRefreshDetail>).detail;
    if (detail.source === "manual") {
      callback(detail);
      return;
    }
    if (families.some((family) => detail.changed.has(family))) {
      callback(detail);
    }
  };
  window.addEventListener(DATA_REFRESH_EVENT_NAME, handler);
  return () => {
    window.removeEventListener(DATA_REFRESH_EVENT_NAME, handler);
  };
}
