import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The one rule the UI-scale feature depends on, pinned in the CSS source text.
 *
 * `html { zoom: var(--ui-scale) }` scales the whole interface, and the
 * measurement that does NOT follow it is `vh`. Verified in Chromium at
 * 1280×800 with `zoom: 0.8`: an element sized `100vh` renders 640 device px,
 * not 800 — `vh` resolves against the viewport in CSS pixels and the result is
 * then scaled. So a raw `100vh` under a scaled-down UI comes out short by
 * exactly the zoom factor and leaves a dead band at the bottom of the screen;
 * under a scaled-up one it overflows and the page gains a scrollbar it should
 * not have.
 *
 * `--app-vh` (`calc(100vh / var(--ui-scale))`, defined on `html` in index.css)
 * is the corrected unit every rule must use instead. This test is what makes
 * that a rule rather than a convention: a new stylesheet — or one line added to
 * an old one — reaching for `100vh` fails here instead of shipping a layout
 * that is subtly wrong at every scale but 100 %.
 *
 * The two definitions in `index.css` are the only legal raw uses, since they
 * are what the corrected units are built FROM.
 */

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALLOWED_RAW_VIEWPORT_UNITS = new Map<string, readonly string[]>([
  [
    "index.css",
    [
      "--app-vh: calc(100vh / var(--ui-scale));",
      "--app-vw: calc(100vw / var(--ui-scale));",
    ],
  ],
]);

/**
 * Blank out `/* … *\/` spans while preserving newlines, so the scan below sees
 * declarations only and line numbers still line up.
 *
 * Stripping per-line was not enough: this file's own subject, the module doc in
 * `index.css`, is a MULTI-line comment that names `100vh` in prose, and a
 * same-line `/*` check reported it as an offender. A guard that fires on its
 * own documentation is a guard people delete.
 */
function withoutComments(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf("/*", index);
    if (start === -1) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, start);
    const end = css.indexOf("*/", start + 2);
    const commented = css.slice(start, end === -1 ? css.length : end + 2);
    // Keep the newlines, drop everything else.
    out += commented.replace(/[^\n]/g, " ");
    if (end === -1) break;
    index = end + 2;
  }
  return out;
}

function cssFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...cssFilesUnder(full));
    } else if (entry.endsWith(".css")) {
      found.push(full);
    }
  }
  return found;
}

describe("UI scale — viewport units in CSS", () => {
  const files = cssFilesUnder(SRC_ROOT);

  it("finds the app's stylesheets at all (guards against a silently empty sweep)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses --app-vh / --app-vw everywhere instead of raw viewport units", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const name = basename(file);
      const allowed = ALLOWED_RAW_VIEWPORT_UNITS.get(name) ?? [];
      for (const line of withoutComments(readFileSync(file, "utf-8")).split("\n")) {
        if (!/\b100v[hw]\b/.test(line)) continue;
        if (allowed.some((permitted) => line.includes(permitted))) continue;
        offenders.push(`${relative(SRC_ROOT, file)}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the root zoom and the corrected units defined together", () => {
    const indexCss = readFileSync(join(SRC_ROOT, "index.css"), "utf-8");
    expect(indexCss).toContain("zoom: var(--ui-scale)");
    expect(indexCss).toContain("--app-vh: calc(100vh / var(--ui-scale))");
    expect(indexCss).toContain("--ui-scale: 1;");
    // The table-height control's default must exist here too: a data table
    // multiplying by an undefined custom property computes to an invalid
    // length and collapses to zero height.
    expect(indexCss).toContain("--ui-table-height-scale: 1;");
  });

  it("scales the reviewer-queue floor, because min-height beats max-height", () => {
    // The bug this pins, caught end to end rather than by reading the CSS:
    // `.dt-table-wrap` inside «صور الأشعة المحالة» carried a flat
    // `min-height: 560px`, and CSS resolves min over max — so lowering the
    // ceiling changed the computed max-height to 336px and the rendered height
    // not at all. The floor has to follow the control too.
    const indexCss = readFileSync(join(SRC_ROOT, "index.css"), "utf-8");
    expect(indexCss).toContain("--ui-queue-floor: calc(560px * var(--ui-table-height-scale))");

    // Both columns of that page floor at the SAME value, or they disagree about
    // where the fold is. XrayReferrals.css wraps the floor in a
    // `--ew-xr-split-height` fallback (the resize grip's admin-set override —
    // see its "Resize grip" section), so its expected substring differs from
    // InspectionPanel.css's, but the floor itself — the fallback value — is
    // still `--ui-queue-floor` in both, and both still forbid a flat 560px.
    const queueFloorExpectations = new Map<string, string>([
      [
        join(SRC_ROOT, "components", "InspectionPanel", "InspectionPanel.css"),
        "min-height: var(--ui-queue-floor);",
      ],
      [
        join(
          SRC_ROOT, "components", "Sidebar", "Tabs", "EmployeeWorkspace",
          "views", "XrayReferrals", "XrayReferrals.css"
        ),
        "min-height: var(--ew-xr-split-height, var(--ui-queue-floor));",
      ],
    ]);
    for (const [file, expected] of queueFloorExpectations) {
      const css = withoutComments(readFileSync(file, "utf-8"));
      expect(css).toContain(expected);
      expect(css).not.toMatch(/min-height:\s*560px/);
    }
  });

  it("multiplies every data-table viewport by the table-height control", () => {
    const dataTableCss = readFileSync(
      join(SRC_ROOT, "components", "DataTable", "DataTable.css"),
      "utf-8"
    );
    const maxHeights = dataTableCss
      .split("\n")
      .filter((line) => line.includes("max-height") && line.includes("--app-vh"));
    expect(maxHeights.length).toBeGreaterThan(0);
    for (const line of maxHeights) {
      expect(line).toContain("var(--ui-table-height-scale)");
    }
  });
});
