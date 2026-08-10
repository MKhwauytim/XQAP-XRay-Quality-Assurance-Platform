import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { POPULATION_AGGREGATE_PREVIEW_FIELDS } from "./populationAggregate";

const here = dirname(fileURLToPath(import.meta.url));
const reportComponentPath = resolve(
  here,
  "../../components/Sidebar/Tabs/Population/components/PopulationProcessingReport.tsx"
);

/**
 * Mechanical enforcement for `POPULATION_AGGREGATE_PREVIEW_FIELDS` -- mirrors
 * `employeeMirrorFields.contract.test.ts`'s pattern for
 * `EMPLOYEE_MIRROR_STUB_FIELDS`. Scans the real preview-table JSX for every
 * `PopulationReportPreviewRow`-typed `row.<field>` access and fails if one
 * isn't listed in the aggregate's preview-row field set -- the same failure
 * mode the owner's requirement warns about: a missing field silently forces
 * a fallback to reading rows.
 *
 * W11 (2026-08-10): the owner asked for the "معاينة المجتمع النهائي" preview
 * table itself to be removed from PopulationProcessingReport (it read
 * already-in-memory rows just to show a handful of samples nobody needed) --
 * `PopulationReportPreviewRow`/`previewRows` stay in the component's prop
 * type for API compatibility with callers still building `reportData`, but
 * nothing in the component destructures or renders `previewRows` anymore, so
 * this scan is expected to find zero `row.<field>` accesses. The pattern is
 * kept (rather than deleted) so a FUTURE preview table reintroduced here
 * still gets the same missing-field enforcement.
 */
describe("POPULATION_AGGREGATE_PREVIEW_FIELDS contract", () => {
  it("covers every `row.<field>` access in PopulationProcessingReport (none currently — W11 removed the preview table)", () => {
    const source = readFileSync(reportComponentPath, "utf-8");
    const accessed = new Set<string>();
    const pattern = /\brow\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      accessed.add(match[1]);
    }
    const known = new Set<string>(POPULATION_AGGREGATE_PREVIEW_FIELDS);
    const missing = [...accessed].filter((field) => !known.has(field));
    expect(missing).toEqual([]);
  });

  it("has no duplicate fields", () => {
    const unique = new Set(POPULATION_AGGREGATE_PREVIEW_FIELDS);
    expect(unique.size).toBe(POPULATION_AGGREGATE_PREVIEW_FIELDS.length);
  });
});
