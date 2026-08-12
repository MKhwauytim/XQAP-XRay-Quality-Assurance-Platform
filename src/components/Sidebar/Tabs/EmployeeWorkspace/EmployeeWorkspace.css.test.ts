import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the bulk-reassignment / referral selection bar
 * overlapping the DataTable toolbar in XrayReferrals.tsx.
 *
 * `DataTable` (src/components/DataTable/index.tsx) renders its root as a
 * React Fragment (`<>...</>`), not a wrapping <div> — so `.dt-toolbar` and
 * `.dt-table-wrap` land as DIRECT children of `.ew-ref-queue` alongside the
 * optional `.ew-selection-bar` (SelectionActionBar / BulkReassignSelectionBar)
 * XrayReferrals.tsx prepends ahead of it. That means `.ew-ref-queue` can hold
 * 2 children (no bar) or 3 (bar + toolbar + table-wrap) depending on
 * showSelectionBar/showBulkReassignBar.
 *
 * `.ew-ref-queue` used to be `display: grid; grid-template-rows: auto
 * minmax(0, 1fr);` — exactly 2 explicit row tracks. With 3 children, CSS
 * grid auto-placement pushed the toolbar into the 1fr track (stretching it
 * across the whole fixed-height container) and the actual table into an
 * implicit auto row squeezed at the bottom — visually, the bar rendered on
 * top of/over the toolbar row instead of pushing it down.
 *
 * A flex column has no such row-count dependency: any number of preceding
 * bars simply stack in normal flow above the table, and only
 * `.dt-table-wrap` (via `flex: 1 1 0` + `min-height: 0`) claims the leftover
 * space. This test pins that contract in the source CSS text so a future
 * edit can't silently reintroduce the row-count-matching grid.
 */
describe("EmployeeWorkspace.css — .ew-ref-queue layout", () => {
  const css = readFileSync(
    fileURLToPath(new URL("./EmployeeWorkspace.css", import.meta.url)),
    "utf8"
  );

  // Anchored to the start of a line: selectors in this file are each written
  // flush-left on their own line, so without the anchor a lookup for
  // ".ew-ref-queue" would also match as a substring of the earlier, unrelated
  // ".ew-split--right .ew-ref-queue { height: ... }" rule.
  function ruleBodyFor(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `expected a "${selector}" rule in EmployeeWorkspace.css`).toBeTruthy();
    return match![1];
  }

  it(".ew-ref-queue stacks its children as a flex column, not a fixed-row-count grid", () => {
    const body = ruleBodyFor(".ew-ref-queue");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    // The old bug source: a grid with a hardcoded number of row tracks that
    // silently mis-lays-out once a 3rd child (the optional selection bar) is
    // present. Guard against it coming back on this selector.
    expect(body).not.toMatch(/display:\s*grid/);
    expect(body).not.toMatch(/grid-template-rows/);
  });

  it(".ew-ref-queue .dt-table-wrap is the sole flex-growing child", () => {
    const body = ruleBodyFor(".ew-ref-queue .dt-table-wrap");
    expect(body).toMatch(/flex:\s*1\s+1\s+0/);
    expect(body).toMatch(/min-height:\s*0/);
  });

  it("the desktop split no longer forces a height:100% on .dt-table-wrap (would fight the flex sizing above)", () => {
    const body = ruleBodyFor(".ew-split--right .dt-table-wrap");
    expect(body).not.toMatch(/height:\s*100%/);
    expect(body).toMatch(/max-height:\s*none/);
  });
});
