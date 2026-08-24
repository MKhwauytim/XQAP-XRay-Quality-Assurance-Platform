/**
 * The width split between the queue and the inspection panel on «صور الأشعة
 * المحالة» (`XrayReferrals`).
 *
 * ## Why this is a store at all
 *
 * The two-column grid on that page used to be a fixed `1.15fr / 1fr`. That
 * ratio is right for some screens and wrong for others — a reviewer working
 * mostly in the queue wants it wider; one who lives in the inspection form
 * wants the opposite — so `QueueSplitResizer` makes the divider draggable and
 * this module remembers what was dragged to.
 *
 * ## Storage
 *
 * `localStorage`, per browser — the same layer and lifetime as
 * `uiScaleStore.ts`'s `xray_ui_scale_v1`, and registered in
 * `storageRegistry.ts` like every other key this app owns. It is a
 * per-machine display preference, not workspace data: two operators on two
 * screens must be able to choose differently, so nothing here is written to
 * the workspace folder, and it must NOT migrate into the workspace column
 * preset (`browsePresetStorage`) — see the plan this shipped with.
 *
 * ## What this store does NOT do
 *
 * Unlike `uiScaleStore`, there is no `applyToDocument` here. UI scale is a
 * root-level property every page depends on, so `main.tsx` applies it before
 * React mounts. This ratio belongs to one CSS custom property on one element
 * inside one screen — `QueueSplitResizer` owns applying it, in a layout
 * effect, once its grid element is known.
 */

import { logError } from "../storage/errorLogger";

export const QUEUE_SPLIT_STORAGE_KEY = "xray_queue_split_v1";

/** The CSS custom property `QueueSplitResizer` writes onto the grid element. */
export const QUEUE_SPLIT_CSS_VAR = "--ew-xr-queue-basis";

/** 1.15fr ÷ (1.15fr + 1fr) — the ratio the fixed grid has always rendered. */
export const DEFAULT_QUEUE_SPLIT = 0.5349;

/**
 * Ratio bounds. Loose enough to let either column dominate, but never so far
 * that the CSS-side pixel minimums (`minmax(340px, …)` / `minmax(430px, …)`)
 * would need to override the ratio on an ordinary screen — those minimums
 * stay the true floor, this is just a sane default range for the handle.
 */
export const MIN_QUEUE_SPLIT = 0.25;
export const MAX_QUEUE_SPLIT = 0.75;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * A stored value coerced into range, or the default.
 *
 * Deliberately forgiving about the SHAPE and strict about the RANGE: a
 * half-written or hand-edited key must never be able to produce
 * `grid-template-columns: minmax(340px, NaN%)`, which drops the whole
 * declaration and collapses the layout — the same reasoning as
 * `uiScaleStore`'s guard against `zoom: 0`.
 */
function sanitize(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, MIN_QUEUE_SPLIT, MAX_QUEUE_SPLIT) : DEFAULT_QUEUE_SPLIT;
}

let current: number = DEFAULT_QUEUE_SPLIT;
let loaded = false;

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function readFromStorage(): number {
  try {
    const raw = localStorage.getItem(QUEUE_SPLIT_STORAGE_KEY);
    if (raw === null) return DEFAULT_QUEUE_SPLIT;
    return sanitize(JSON.parse(raw));
  } catch (error) {
    // A corrupt or unreadable key is not worth failing a page load over — the
    // default split is always renderable.
    logError("queueSplitStore:read", error);
    return DEFAULT_QUEUE_SPLIT;
  }
}

/** The current ratio, loading it from storage on first use. */
export function getQueueSplit(): number {
  if (!loaded) {
    current = readFromStorage();
    loaded = true;
  }
  return current;
}

function persist(value: number): void {
  try {
    if (value === DEFAULT_QUEUE_SPLIT) {
      // Storing the default would leave a key behind that says nothing.
      // Removing it keeps "never dragged the divider" and "dragged it back to
      // normal" indistinguishable, which is the honest state.
      localStorage.removeItem(QUEUE_SPLIT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(QUEUE_SPLIT_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    // Private mode, a full quota, a locked-down origin: the split still
    // applies to this session, it just will not survive a reload.
    logError("queueSplitStore:persist", error);
  }
}

function notify(): void {
  subscribers.forEach((fn) => fn());
}

/**
 * Store a new ratio, clamped, then persist and broadcast.
 *
 * Returns what was actually stored — clamping means the caller's number and
 * the stored one can differ, and a handle that silently disagrees with the
 * store is how a control ends up fighting the user.
 */
export function setQueueSplit(next: number): number {
  const merged = sanitize(next);
  current = merged;
  loaded = true;
  persist(merged);
  notify();
  return merged;
}

/** Back to the default ratio, storage key removed. */
export function resetQueueSplit(): number {
  return setQueueSplit(DEFAULT_QUEUE_SPLIT);
}

/** True when the ratio differs from the default — drives the reset affordance. */
export function isQueueSplitCustomized(): boolean {
  return getQueueSplit() !== DEFAULT_QUEUE_SPLIT;
}

export function subscribeToQueueSplit(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Test-only: forget the in-memory copy so the next read hits storage again. */
export function __resetQueueSplitCacheForTests(): void {
  current = DEFAULT_QUEUE_SPLIT;
  loaded = false;
}
