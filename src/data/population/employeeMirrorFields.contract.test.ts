import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EMPLOYEE_MIRROR_STUB_FIELDS } from "./populationTypes";

/**
 * Mechanical enforcement for EMPLOYEE_MIRROR_STUB_FIELDS (B5, employee-mirror
 * disk-bloat fix). Static enumeration of "every field an employee view reads"
 * erodes the moment someone adds a new column to one of these views without
 * remembering to also update the manifest in populationTypes.ts — this test
 * closes that gap by scanning the views' own source for `.row.<field>`
 * accesses (the shape `DistributionEntry.row` — an `EmployeeMirrorRowStub` for
 * new writes — is read through) and failing if a field shows up that the
 * manifest doesn't know about.
 *
 * This deliberately reads real component source text rather than importing
 * the components: EMPLOYEE_MIRROR_STUB_FIELDS lives in src/data/population
 * (owned independently of src/components), and static text scanning avoids
 * needing a full React/JSX test-render harness just to catch a missing field.
 *
 * NOTE: this only guards employee-facing SAMPLE views (rows sourced from
 * DistributionEntry / the employee sample mirror). Population-scale browse
 * views and views built on independently-loaded full PreparedPopulationRow
 * data (e.g. the replacement-candidate list, which never goes through the
 * mirror) are out of scope by design — see the exclusions below.
 */

const EMPLOYEE_FACING_SAMPLE_VIEWS = [
  "../../components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx",
  "../../components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals/subComponents.tsx",
  "../../components/Sidebar/Tabs/EmployeeWorkspace/views/XrayInspectionResults.tsx",
];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Matches `.row.<field>` accesses -- e.g. `entry.row.stage`,
 * `e.row.plateOrContainerNumber`, `row.entry.row.stage` -- regardless of what
 * precedes `.row.` (entry/e/etc.), since across these three files `.row` is
 * only ever the `DistributionEntry.row` property. A loop variable that IS
 * itself a full `PreparedPopulationRow` (e.g. the replacement-candidate rows
 * in `ReplacementDialog`, accessed as bare `row.stage` with no leading dot)
 * does not match this pattern and is correctly out of scope -- those rows come
 * from a live population/sample lookup, never through the mirror.
 */
const ROW_FIELD_ACCESS = /\.row\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

function extractRowFieldAccesses(source: string): Set<string> {
  const fields = new Set<string>();
  for (const match of source.matchAll(ROW_FIELD_ACCESS)) {
    fields.add(match[1]);
  }
  return fields;
}

describe("EMPLOYEE_MIRROR_STUB_FIELDS contract", () => {
  const knownFields = new Set<string>(EMPLOYEE_MIRROR_STUB_FIELDS);

  for (const relativePath of EMPLOYEE_FACING_SAMPLE_VIEWS) {
    test(`every .row.<field> access in ${relativePath} is in EMPLOYEE_MIRROR_STUB_FIELDS`, () => {
      const absolutePath = path.join(here, relativePath);
      const source = readFileSync(absolutePath, "utf8");
      const accessed = extractRowFieldAccesses(source);
      const unlisted = [...accessed].filter((field) => !knownFields.has(field));
      expect(
        unlisted,
        `${relativePath} reads row field(s) [${unlisted.join(", ")}] not present in ` +
          "EMPLOYEE_MIRROR_STUB_FIELDS (src/data/population/populationTypes.ts). " +
          "An employee's own sample mirror must stay fully self-contained -- add the " +
          "field to EMPLOYEE_MIRROR_STUB_FIELDS or stop reading it from `.row` here."
      ).toEqual([]);
    });
  }

  test("manifest is non-empty and has no duplicate fields", () => {
    expect(EMPLOYEE_MIRROR_STUB_FIELDS.length).toBeGreaterThan(0);
    expect(new Set(EMPLOYEE_MIRROR_STUB_FIELDS).size).toBe(EMPLOYEE_MIRROR_STUB_FIELDS.length);
  });
});
