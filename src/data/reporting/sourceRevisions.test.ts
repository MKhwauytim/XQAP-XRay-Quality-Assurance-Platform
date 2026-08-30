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

// NOTE (found while migrating this file off buildSampleDocument/buildSampleDeck
// for the population/report merge): unlike the retired sample builder,
// buildPopulationDocument/buildPopulationDeck do NOT render a source-revisions
// footer — `sourceRevisions` flows through into `PopulationReportModel` (see
// populationReport/model.ts) but neither builder reads
// `model.sourceRevisions` anywhere. That looks like a real gap (the Reports
// tab's TabView.tsx already computes and passes `sourceRevisions` into the
// population report input, expecting it to show up somewhere), but wiring a
// footer into the v3 document/deck chrome is a product/visual decision for
// the report owner, not something to improvise inside this test migration.
// These tests are therefore scoped down to what's actually true today: the
// field is accepted on the real `PopulationReportInput` shape, with and
// without a value, and the builders still produce well-formed output. This
// file's role here has always been "a convenient real HTML-producing
// builder" (per the population-report-merge plan), not sample-report-specific
// behavior — see the original block this replaced in git history.
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

  test("the population DOCUMENT builds with sourceRevisions set", async () => {
    const html = await buildPopulationDocument(buildInput());
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("the population DECK builds with sourceRevisions set", async () => {
    const html = await buildPopulationDeck(buildInput());
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("omitting sourceRevisions still builds (backward compatible)", async () => {
    const html = await buildPopulationDocument(buildInput({ sourceRevisions: undefined }));
    expect(html).toContain("<!DOCTYPE html>");
  });
});
