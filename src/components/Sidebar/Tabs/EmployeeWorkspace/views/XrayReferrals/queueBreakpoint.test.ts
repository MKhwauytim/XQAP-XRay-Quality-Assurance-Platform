import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the queue/panel stacking breakpoint in
 * `XrayReferrals.css`.
 *
 * jsdom does not compute CSS, so this cannot check real layout the way a
 * browser would (see `queueLayout.test.tsx`'s header comment) — what it CAN
 * do is pin the source text's numeric threshold, so a future edit can't
 * silently regress it back toward a value that clips the panel.
 *
 * THE MATH THIS PINS: `.ew-xr-grid` needs 340px (queue) + 430px (panel) +
 * 14px (gap) = 784px of real content width before the two columns stack.
 * "Real content width" is NOT raw viewport width — the grid sits inside:
 *   - the expanded sidebar: 280px (`--sidebar-width`, App.css)
 *   - `.app-workspace`'s own `padding-inline`: 2 × `--sp-6` (24px) = 48px
 *   - `.page-shell`'s fluid `padding-inline: clamp(var(--sp-2), 1.2vw,
 *     var(--sp-6))`, i.e. roughly `0.024 × viewport` combined (both sides)
 *     while under the 24px-per-side cap, which holds throughout this band
 * So available width ≈ `viewport - 280 - 48 - 0.024 · viewport`, which only
 * reaches 784px once `viewport` is at least `(784 + 328) / 0.976 ≈ 1139px`.
 * A viewport of, say, 1120px — comfortably above the OLD 1100px breakpoint —
 * only has about `1120 - 280 - 48 - 26.9 ≈ 765px` of real room: less than the
 * 784px the grid needs, so the excess used to be silently clipped by
 * `.app-workspace`'s `overflow-x: hidden` instead of ever stacking.
 *
 * The new threshold below must clear that ~1139px break (with a little
 * margin for the vertical scrollbar `.app-workspace` shows whenever the
 * queue is taller than one screen, which this calc doesn't otherwise
 * account for) — see the comment directly above the media query in
 * `XrayReferrals.css` for the full derivation.
 */
describe("XrayReferrals.css — queue/panel stacking breakpoint", () => {
  const css = readFileSync(
    fileURLToPath(new URL("./XrayReferrals.css", import.meta.url)),
    "utf8"
  );

  const CONTENT_MINIMUM_PX = 340 + 430 + 14; // 784
  const CHROME_FLOOR_PX = 280 + 48; // sidebar + .app-workspace padding, ignoring the fluid page-shell gutter
  // The break below which raw-viewport-only math clips the grid, using only
  // the FIXED chrome (sidebar + .app-workspace padding) as a conservative
  // lower bound — the fluid .page-shell gutter only pushes this higher.
  const MINIMUM_SAFE_BREAKPOINT_PX = CONTENT_MINIMUM_PX + CHROME_FLOOR_PX; // 1112

  it("stacks below a threshold that accounts for the sidebar + workspace chrome, not just raw viewport width", () => {
    const match = css.match(/@media \(max-width:\s*(\d+)px\)\s*\{\s*\n\s*\.ew-ref-queue\.ew-xr-grid,/);
    expect(match, "expected the queue/panel stacking media query in XrayReferrals.css").toBeTruthy();

    const breakpoint = Number(match![1]);
    // The old value (1100px) ignored ~355px of chrome entirely and left a
    // real clipped band between it and ~1139px. Guard against that band
    // reopening: the threshold must clear the fixed-chrome-only floor.
    expect(breakpoint).toBeGreaterThanOrEqual(MINIMUM_SAFE_BREAKPOINT_PX);
    // Sanity bound so this doesn't silently drift into "always stacked" —
    // a regression in the other direction (needlessly narrow two-column
    // range) is a real usability loss even though it can't clip anything.
    expect(breakpoint).toBeLessThan(1400);
  });
});
