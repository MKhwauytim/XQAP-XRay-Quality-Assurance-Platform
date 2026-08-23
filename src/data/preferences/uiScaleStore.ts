/**
 * App-wide UI scale — one zoom factor for the whole interface, plus a separate
 * multiplier for how tall a data table's scroll viewport is allowed to be.
 *
 * ## Why zoom, and why at the root
 *
 * The problem this solves is a screen too small for the data: on a 1366×768
 * laptop the referrals queue («صور الأشعة المحالة») pushes its action buttons
 * below the fold and its columns past the right edge, so reading one row means
 * scrolling in two directions. The fix an operator actually wants is the one
 * they would reach for in the browser — make everything a bit smaller so more
 * fits — applied once and remembered.
 *
 * `zoom` on the root element is what delivers that here, and the choice is
 * forced rather than stylistic. This app's CSS is px-dominant (~4,400 px
 * literals against ~175 rem), so scaling a root font-size would move almost
 * nothing. Scaling a *container* with `transform` or a nested `zoom` would
 * break every `position: fixed` descendant — the sidebar, dialogs, popovers,
 * the feedback widget — because a transformed ancestor becomes their containing
 * block. At the root, fixed positioning stays viewport-relative and Chromium
 * treats the whole thing like browser zoom. (Chromium-only is already this
 * app's baseline: the workspace needs `showDirectoryPicker`.)
 *
 * ## The one thing zoom does NOT do for you
 *
 * Verified in Chromium 1280×800 with `zoom: 0.8`: an element sized `100vh`
 * renders 640 device px, not 800. `vh` resolves against the viewport in CSS
 * pixels and the result is *then* scaled, so every `100vh`-derived height comes
 * out short by exactly the zoom factor and leaves a dead band at the bottom of
 * the screen. Width needs no such correction — the root simply gets
 * `1280 / 0.8 = 1600` CSS px of room, which is the entire point of the feature.
 *
 * So `--app-vh` (defined in `index.css` as `100vh / var(--ui-scale)`) is the
 * viewport height every rule must use in place of `100vh`. A raw `100vh`
 * anywhere in this app's CSS is now a bug, and `uiScaleCss.contract.test.ts`
 * fails on one.
 *
 * ## Storage
 *
 * `localStorage`, per browser — the same layer and lifetime as the label
 * overrides in `labelsStore.ts`, and registered in `storageRegistry.ts` like
 * every other key this app owns. It is a per-machine display preference, not
 * workspace data: nothing here is written to the workspace folder, so two
 * machines can each pick the scale their own screen needs.
 */

import { logError } from "../storage/errorLogger";

export const UI_SCALE_STORAGE_KEY = "xray_ui_scale_v1";

/**
 * Zoom bounds. The floor is where 12.5px table text stops being readable at
 * arm's length; the ceiling is a mild enlargement for a high-DPI screen, not an
 * accessibility zoom (the browser's own Ctrl+= still stacks on top of this and
 * goes further).
 */
export const MIN_UI_SCALE = 0.6;
export const MAX_UI_SCALE = 1.4;

/**
 * Table-viewport bounds. `1` is the historical `calc(100vh - 260px)` behavior.
 * Below 1 the table gets shorter, which is what pulls a page's action buttons
 * back above the fold; above 1 it grows past the viewport and the PAGE scrolls
 * instead of the table — legitimate on a tall screen, and the reason the
 * ceiling is not clamped at 1.
 */
export const MIN_TABLE_HEIGHT = 0.5;
export const MAX_TABLE_HEIGHT = 2;

export type UiScaleSettings = {
  /** Root zoom factor. 1 = unscaled. */
  scale: number;
  /** Multiplier on every data table's max scroll height. 1 = unchanged. */
  tableHeight: number;
};

export const DEFAULT_UI_SCALE: UiScaleSettings = { scale: 1, tableHeight: 1 };

/** CSS custom properties this store owns on the root element. */
export const UI_SCALE_CSS_VAR = "--ui-scale";
export const TABLE_HEIGHT_CSS_VAR = "--ui-table-height-scale";

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * A stored value coerced into range, or the default.
 *
 * Deliberately forgiving about the SHAPE and strict about the RANGE: a
 * half-written or hand-edited key must never be able to put `zoom: 0` on the
 * root element, which would render the entire app invisible with no way back
 * short of clearing site data. Anything non-finite falls back to the default.
 */
function sanitize(raw: unknown): UiScaleSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_UI_SCALE;
  const source = raw as Partial<Record<keyof UiScaleSettings, unknown>>;
  const scale = Number(source.scale);
  const tableHeight = Number(source.tableHeight);
  return {
    scale: Number.isFinite(scale) ? clamp(scale, MIN_UI_SCALE, MAX_UI_SCALE) : DEFAULT_UI_SCALE.scale,
    tableHeight: Number.isFinite(tableHeight)
      ? clamp(tableHeight, MIN_TABLE_HEIGHT, MAX_TABLE_HEIGHT)
      : DEFAULT_UI_SCALE.tableHeight,
  };
}

let current: UiScaleSettings = DEFAULT_UI_SCALE;
let loaded = false;

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function readFromStorage(): UiScaleSettings {
  try {
    const raw = localStorage.getItem(UI_SCALE_STORAGE_KEY);
    if (raw === null) return DEFAULT_UI_SCALE;
    return sanitize(JSON.parse(raw));
  } catch (error) {
    // A corrupt or unreadable key is not worth failing a page load over — the
    // default scale is always renderable.
    logError("uiScaleStore:read", error);
    return DEFAULT_UI_SCALE;
  }
}

/** The current settings, loading them from storage on first use. */
export function getUiScale(): UiScaleSettings {
  if (!loaded) {
    current = readFromStorage();
    loaded = true;
  }
  return current;
}

/**
 * Write the two custom properties onto the root element.
 *
 * Separated from `setUiScale` so the boot path (`main.tsx`) can apply the
 * stored value BEFORE React mounts. Applying it from an effect instead would
 * paint the first frame unscaled and then jump, which reads as a layout bug on
 * every single page load.
 *
 * No-ops outside a DOM (the Vitest `node` environment, which most of this
 * repo's tests use), so importing this module never requires jsdom.
 */
export function applyUiScaleToDocument(settings: UiScaleSettings = getUiScale()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty(UI_SCALE_CSS_VAR, String(settings.scale));
  root.style.setProperty(TABLE_HEIGHT_CSS_VAR, String(settings.tableHeight));
}

function persist(settings: UiScaleSettings): void {
  try {
    if (settings.scale === DEFAULT_UI_SCALE.scale && settings.tableHeight === DEFAULT_UI_SCALE.tableHeight) {
      // Storing the default would leave a key behind that says nothing. Removing
      // it keeps "never touched this setting" and "set it back to normal"
      // indistinguishable, which is the honest state.
      localStorage.removeItem(UI_SCALE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(UI_SCALE_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    // Private mode, a full quota, a locked-down origin: the scale still applies
    // to this session, it just will not survive a reload.
    logError("uiScaleStore:persist", error);
  }
}

function notify(): void {
  subscribers.forEach((fn) => fn());
}

/**
 * Update one or both values, clamped, then persist, apply and broadcast.
 *
 * Returns what was actually stored — clamping means the caller's number and
 * the stored one can differ, and a slider that silently disagrees with the
 * store is how a control ends up fighting the user.
 */
export function setUiScale(next: Partial<UiScaleSettings>): UiScaleSettings {
  const merged = sanitize({ ...getUiScale(), ...next });
  current = merged;
  loaded = true;
  persist(merged);
  applyUiScaleToDocument(merged);
  notify();
  return merged;
}

/** Back to 100% / normal table height, storage key removed. */
export function resetUiScale(): UiScaleSettings {
  return setUiScale(DEFAULT_UI_SCALE);
}

/** True when either value differs from the default — drives the reset button. */
export function isUiScaleCustomized(): boolean {
  const settings = getUiScale();
  return (
    settings.scale !== DEFAULT_UI_SCALE.scale ||
    settings.tableHeight !== DEFAULT_UI_SCALE.tableHeight
  );
}

export function subscribeToUiScale(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Test-only: forget the in-memory copy so the next read hits storage again. */
export function __resetUiScaleCacheForTests(): void {
  current = DEFAULT_UI_SCALE;
  loaded = false;
}
