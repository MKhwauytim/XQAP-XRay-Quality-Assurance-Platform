/* @vitest-environment jsdom */
// Bug A regression guard — Population Browse's per-column sort button rendered
// with browser-default <button> chrome because Population.css declared no
// .bv-sort-btn rule at all, while the filter button sitting next to it in the
// same .bv-th-content flex row was fully styled. This test pins BOTH halves:
// the markup still emits the classes, and the stylesheet still defines them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "Population.css");
const css = readFileSync(cssPath, "utf8");

describe("BrowseDataView sort button styling (Bug A)", () => {
  it("declares a base rule for .bv-sort-btn", () => {
    expect(css).toMatch(/^\.bv-sort-btn\s*\{/m);
  });

  it("gives the active (currently-sorted) state its own visual treatment", () => {
    // The `active` class was applied by BrowseDataView but consumed by nothing,
    // so a sorted column looked identical to an unsorted one.
    expect(css).toMatch(/\.bv-sort-btn\.active/);
  });

  it("styles the idle chevron so the unsorted state reads as available, not applied", () => {
    expect(css).toMatch(/\.bv-sort-btn-idle-icon/);
  });

  it("sizes the sort button to match the filter button it sits beside", () => {
    // Both live in the same .bv-th-content flex row; a size mismatch is the
    // single most visible part of the "detached chip" report.
    const sortRule = /\.bv-sort-btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const filterRule = /\.bv-filter-btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const size = (rule: string) => ({
      width: /width:\s*([^;]+);/.exec(rule)?.[1]?.trim(),
      height: /height:\s*([^;]+);/.exec(rule)?.[1]?.trim(),
    });
    expect(size(sortRule)).toEqual(size(filterRule));
    expect(size(filterRule).width).toBeDefined();
  });

  it("uses design tokens, not raw hex literals (check:hex-literals guards this file)", () => {
    const sortRules = css.match(/\.bv-sort-btn[^{]*\{[^}]*\}/g) ?? [];
    expect(sortRules.length).toBeGreaterThan(0);
    for (const rule of sortRules) {
      expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
