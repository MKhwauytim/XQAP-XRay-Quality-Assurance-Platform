// Regression guard for the in-app KPI dashboard (مؤشرات الأداء).
//
// The dashboard reuses the executive-report chart primitives (charts.ts),
// whose fills/strokes are emitted as `var(--gold)`, `var(--line)`, … Those
// variables are defined by the *exported report's* theme.ts — they do NOT
// exist in the app's stylesheets by default. If Reports.css stops defining
// them for the dashboard scope, every gauge/donut/bar renders with unresolved
// colors (stroke: none → invisible arcs, transparent bar fills).
//
// This test asserts Reports.css defines every chart color-role variable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { COLOR_ROLE } from "../../../../data/reporting/executive/ui/tokens";

const css = readFileSync(
  fileURLToPath(new URL("./Reports.css", import.meta.url)),
  "utf8"
);

test("Reports.css defines every chart color-role CSS variable for the KPI dashboard", () => {
  const missing = [...new Set(Object.values(COLOR_ROLE))].filter(
    (varName) => !new RegExp(`--${varName}\\s*:`).test(css)
  );
  expect(missing, `Reports.css must define: ${missing.map((v) => `--${v}`).join(", ")}`).toEqual([]);
});
