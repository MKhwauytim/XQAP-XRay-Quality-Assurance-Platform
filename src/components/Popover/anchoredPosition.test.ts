import { describe, expect, it } from "vitest";

import {
  POPOVER_GAP,
  POPOVER_VIEWPORT_MARGIN,
  computeAnchoredPosition,
  type RectLike
} from "./anchoredPosition";

const VIEWPORT = { width: 1000, height: 800 };

function rect(left: number, top: number, width: number, height: number): RectLike {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A filter button sitting comfortably in the middle of the viewport. */
const MIDDLE_ANCHOR = rect(400, 300, 24, 24);

describe("computeAnchoredPosition — RTL edge selection", () => {
  it("pins the popover's RIGHT edge to the anchor's right edge in RTL (align: start)", () => {
    const { left } = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: true
    });

    // inline-start === physical right in RTL, so the box grows leftwards.
    expect(left + 220).toBe(MIDDLE_ANCHOR.right);
  });

  it("pins the popover's LEFT edge to the anchor's left edge in LTR (align: start)", () => {
    const { left } = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: false
    });

    expect(left).toBe(MIDDLE_ANCHOR.left);
  });

  it("swaps the pinned edge for align: end", () => {
    const rtlEnd = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: true,
      align: "end"
    });
    const ltrEnd = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: false,
      align: "end"
    });

    expect(rtlEnd.left).toBe(MIDDLE_ANCHOR.left);
    expect(ltrEnd.left + 220).toBe(MIDDLE_ANCHOR.right);
  });
});

describe("computeAnchoredPosition — viewport collision", () => {
  it("clamps a right-aligned RTL popover that would run off the physical LEFT edge", () => {
    // The regression this replaces: `right: innerWidth - anchor.right` with no
    // clamp put a 220px menu at left = -130 for the last column of a wide RTL
    // table, i.e. entirely off-screen.
    const anchor = rect(66, 300, 24, 24);

    const { left } = computeAnchoredPosition({
      anchor,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: true
    });

    expect(left).toBe(POPOVER_VIEWPORT_MARGIN);
  });

  it("clamps a left-aligned LTR popover that would run off the right edge", () => {
    const anchor = rect(960, 300, 24, 24);

    const { left } = computeAnchoredPosition({
      anchor,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: false
    });

    expect(left).toBe(VIEWPORT.width - POPOVER_VIEWPORT_MARGIN - 220);
  });

  it("opens below the anchor when there is room", () => {
    const result = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 220, height: 180 },
      viewport: VIEWPORT,
      isRtl: true
    });

    expect(result.placement).toBe("below");
    expect(result.top).toBe(MIDDLE_ANCHOR.bottom + POPOVER_GAP);
  });

  it("flips above the anchor when the space below cannot hold the popover", () => {
    // Filter button near the bottom of the viewport, tall multiselect menu.
    const anchor = rect(400, 700, 24, 24);

    const result = computeAnchoredPosition({
      anchor,
      popover: { width: 220, height: 300 },
      viewport: VIEWPORT,
      isRtl: true
    });

    expect(result.placement).toBe("above");
    expect(result.top + 300).toBe(anchor.top - POPOVER_GAP);
  });

  it("stays below — and shrinks — when neither side fits but below has more room", () => {
    const anchor = rect(400, 120, 24, 24);

    const result = computeAnchoredPosition({
      anchor,
      popover: { width: 220, height: 5000 },
      viewport: VIEWPORT,
      isRtl: true
    });

    expect(result.placement).toBe("below");
    expect(result.maxHeight).toBe(
      VIEWPORT.height - anchor.bottom - POPOVER_GAP - POPOVER_VIEWPORT_MARGIN
    );
    // Every edge of the clamped box is inside the viewport.
    expect(result.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("never collapses below the usable minimum when the anchor hugs a viewport edge", () => {
    // Anchor flush with the bottom: `spaceBelow` is 0, but a 0-high menu is
    // worse than a short scrollable one.
    const anchor = rect(400, 780, 24, 20);

    const result = computeAnchoredPosition({
      anchor,
      popover: { width: 220, height: 400 },
      viewport: VIEWPORT,
      isRtl: true
    });

    expect(result.maxHeight).toBeGreaterThanOrEqual(120);
    expect(result.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
  });

  it("caps maxWidth at the viewport minus both margins", () => {
    const result = computeAnchoredPosition({
      anchor: MIDDLE_ANCHOR,
      popover: { width: 4000, height: 180 },
      viewport: { width: 360, height: 800 },
      isRtl: true
    });

    expect(result.maxWidth).toBe(360 - POPOVER_VIEWPORT_MARGIN * 2);
    expect(result.left).toBe(POPOVER_VIEWPORT_MARGIN);
  });
});
