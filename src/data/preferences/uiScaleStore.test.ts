/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_UI_SCALE,
  MAX_TABLE_HEIGHT,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  TABLE_HEIGHT_CSS_VAR,
  UI_SCALE_CSS_VAR,
  UI_SCALE_STORAGE_KEY,
  __resetUiScaleCacheForTests,
  applyUiScaleToDocument,
  getUiScale,
  isUiScaleCustomized,
  resetUiScale,
  setUiScale,
  subscribeToUiScale,
} from "./uiScaleStore";

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  __resetUiScaleCacheForTests();
});

afterEach(() => {
  localStorage.clear();
  __resetUiScaleCacheForTests();
});

describe("uiScaleStore", () => {
  it("starts at 100% with nothing stored", () => {
    expect(getUiScale()).toEqual(DEFAULT_UI_SCALE);
    expect(isUiScaleCustomized()).toBe(false);
  });

  it("writes both custom properties onto the root element", () => {
    setUiScale({ scale: 0.8, tableHeight: 1.25 });
    expect(cssVar(UI_SCALE_CSS_VAR)).toBe("0.8");
    expect(cssVar(TABLE_HEIGHT_CSS_VAR)).toBe("1.25");
  });

  it("survives a reload", () => {
    setUiScale({ scale: 0.75 });
    __resetUiScaleCacheForTests();
    expect(getUiScale().scale).toBe(0.75);
  });

  it("applies the stored value to the document without a prior set — the boot path", () => {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, JSON.stringify({ scale: 0.7, tableHeight: 1 }));
    __resetUiScaleCacheForTests();
    applyUiScaleToDocument();
    expect(cssVar(UI_SCALE_CSS_VAR)).toBe("0.7");
  });

  it("clamps out-of-range values instead of trusting them", () => {
    expect(setUiScale({ scale: 99 }).scale).toBe(MAX_UI_SCALE);
    expect(setUiScale({ scale: 0.01 }).scale).toBe(MIN_UI_SCALE);
    expect(setUiScale({ tableHeight: 50 }).tableHeight).toBe(MAX_TABLE_HEIGHT);
  });

  it("refuses a stored zero, which would put `zoom: 0` on the root and blank the app", () => {
    // The failure mode this guards is unrecoverable from inside the app: an
    // invisible interface offers no control to fix itself with.
    localStorage.setItem(UI_SCALE_STORAGE_KEY, JSON.stringify({ scale: 0, tableHeight: 0 }));
    __resetUiScaleCacheForTests();
    expect(getUiScale().scale).toBeGreaterThanOrEqual(MIN_UI_SCALE);
  });

  it("falls back to the default for a corrupt or nonsense stored value", () => {
    localStorage.setItem(UI_SCALE_STORAGE_KEY, "{not json");
    __resetUiScaleCacheForTests();
    expect(getUiScale()).toEqual(DEFAULT_UI_SCALE);

    localStorage.setItem(UI_SCALE_STORAGE_KEY, JSON.stringify({ scale: "big" }));
    __resetUiScaleCacheForTests();
    expect(getUiScale()).toEqual(DEFAULT_UI_SCALE);
  });

  it("removes the key on reset rather than storing the default", () => {
    setUiScale({ scale: 0.8 });
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).not.toBeNull();

    resetUiScale();
    expect(localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBeNull();
    expect(isUiScaleCustomized()).toBe(false);
    expect(cssVar(UI_SCALE_CSS_VAR)).toBe("1");
  });

  it("notifies subscribers, and stops once unsubscribed", () => {
    let calls = 0;
    const unsubscribe = subscribeToUiScale(() => { calls += 1; });
    setUiScale({ scale: 0.9 });
    expect(calls).toBe(1);
    unsubscribe();
    setUiScale({ scale: 0.8 });
    expect(calls).toBe(1);
  });

  it("merges a partial update instead of dropping the other value", () => {
    setUiScale({ scale: 0.8, tableHeight: 1.5 });
    setUiScale({ scale: 0.9 });
    expect(getUiScale()).toEqual({ scale: 0.9, tableHeight: 1.5 });
  });
});
