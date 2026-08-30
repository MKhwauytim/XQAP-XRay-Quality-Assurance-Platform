import { describe, expect, test } from "vitest";

import {
  formatSourceRevisionsInline,
  hasSourceRevisions,
  sourceRevisionEntries,
  sourceRevisionsFooterHtml,
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_LABEL_AR,
  SOURCE_REVISIONS_SHEET_HEADERS_AR,
} from "./sourceRevisions";
import { esc } from "./executive/primitives";
import { makeRow } from "./reportTestFixtures";
import { buildPopulationDocument, buildPopulationDeck } from "./populationReport";
import type { PopulationReportInput } from "./populationReport/model";

describe("sourceRevisions helper (B2)", () => {
  const revisions = { "sample.master.json": 3, "population.final.json": 7 };

  test("hasSourceRevisions distinguishes empty from non-empty", () => {
    expect(hasSourceRevisions(undefined)).toBe(false);
    expect(hasSourceRevisions({})).toBe(false);
    expect(hasSourceRevisions(revisions)).toBe(true);
  });

  test("entries are name-sorted for deterministic rendering", () => {
    expect(sourceRevisionEntries(revisions)).toEqual([
      ["population.final.json", 7],
      ["sample.master.json", 3],
    ]);
  });

  test("inline summary lists file → revision", () => {
    expect(formatSourceRevisionsInline(revisions)).toContain("population.final.json");
    expect(formatSourceRevisionsInline(revisions)).toContain("مراجعة 7");
    expect(formatSourceRevisionsInline({})).toBe("");
  });

  test("footer HTML escapes file names and carries the revisions + label", () => {
    const html = sourceRevisionsFooterHtml({ "a<b>.json": 2 }, esc);
    expect(html).toContain(SOURCE_REVISIONS_LABEL_AR);
    expect(html).toContain("مراجعة 2");
    // The angle brackets in the file name are escaped (no raw injection).
    expect(html).not.toContain("<b>");
    expect(html).toContain("a&lt;b&gt;.json");
    // Empty map → nothing rendered.
    expect(sourceRevisionsFooterHtml({}, esc)).toBe("");
  });

  test("Excel AOA has the header plus one row per file", () => {
    const aoa = sourceRevisionsSheetAoa(revisions);
    expect(aoa[0]).toEqual([...SOURCE_REVISIONS_SHEET_HEADERS_AR]);
    expect(aoa).toContainEqual(["sample.master.json", 3]);
    expect(aoa).toContainEqual(["population.final.json", 7]);
  });
});

// NOTE: originally (Task 11 era) buildPopulationDocument/buildPopulationDeck
// did NOT render a source-revisions footer — `sourceRevisions` flowed through
// into `PopulationReportModel` (see populationReport/model.ts) but neither
// builder read `model.sourceRevisions` anywhere. That tracked gap (the
// Reports tab's TabView.tsx already computed and passed `sourceRevisions`
// into the population report input, expecting it to show up somewhere) is
// closed by Task 11b: both builders now render `sourceRevisionsFooterHtml`
// via `buildDeckV3Html`'s `footerNote` parameter / document.ts's own footer
// concatenation. The tests below assert the new real (positive) behavior
// instead of the old no-op — see git history for the original block.
describe("sourceRevisions field on PopulationReportInput (B2)", () => {
  const rows = [makeRow("A1", "بري"), makeRow("A2", "بري")];
  function buildInput(overrides: Partial<PopulationReportInput> = {}): PopulationReportInput {
    return {
      monthFolderName: "5-may-2026",
      manifest: null,
      processingSummary: null,
      riskRawRowCount: rows.length,
      biRawRowCount: null,
      populationRows: rows,
      sampleRows: rows,
      distributionEntries: [],
      employeeDisplayNames: {},
      sourceRevisions: { "sample.master.json": 5, "population.final.json": 9 },
      ...overrides,
    };
  }

  test("sourceRevisions now renders as a footer on the document (tracked gap from Task 11 closed by Task 11b)", async () => {
    const withRevisions = await buildPopulationDocument(
      buildInput({ sourceRevisions: { "population.final.json": 3, "sample.master.json": 1 } })
    );
    const withoutRevisions = await buildPopulationDocument(buildInput({ sourceRevisions: undefined }));
    expect(withRevisions).not.toBe(withoutRevisions);
    expect(withRevisions).toContain("population.final.json");
    // The base CSS (shared with deck3) carries a `.source-revisions`
    // fullscreen display:none guard unconditionally, so the bare class name
    // legitimately appears even with no revisions — what must stay absent is
    // the actual footer block.
    expect(withoutRevisions).not.toContain('<section class="source-revisions"');
  });

  test("sourceRevisions now renders as a footer on the deck (tracked gap from Task 11 closed by Task 11b)", async () => {
    const withRevisions = await buildPopulationDeck(
      buildInput({ sourceRevisions: { "population.final.json": 3, "sample.master.json": 1 } })
    );
    const withoutRevisions = await buildPopulationDeck(buildInput({ sourceRevisions: undefined }));
    expect(withRevisions).not.toBe(withoutRevisions);
    expect(withRevisions).toContain("population.final.json");
    expect(withoutRevisions).not.toContain('<section class="source-revisions"');
  });
});
