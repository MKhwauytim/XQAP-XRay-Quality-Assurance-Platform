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
import { makeRow, makeSampleMaster } from "./reportTestFixtures";
import { buildSampleDocument, buildSampleDeck } from "./sampleReport";

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

describe("source revisions appear in sample builder output (B2)", () => {
  const rows = [makeRow("A1", "بري"), makeRow("A2", "بري")];
  const sample = makeSampleMaster(rows);
  const input = {
    monthFolderName: "5-may-2026",
    manifest: null,
    populationRows: rows,
    sample,
    sourceRevisions: { "sample.master.json": 5, "population.final.json": 9 },
  };

  test("the sample DOCUMENT prints the source-revision block", () => {
    const html = buildSampleDocument(input);
    expect(html).toContain(SOURCE_REVISIONS_LABEL_AR);
    expect(html).toContain("sample.master.json");
    expect(html).toContain("مراجعة 5");
    expect(html).toContain("مراجعة 9");
  });

  test("the sample DECK prints the source-revision block", () => {
    const html = buildSampleDeck(input);
    expect(html).toContain(SOURCE_REVISIONS_LABEL_AR);
    expect(html).toContain("population.final.json");
  });

  test("omitting sourceRevisions renders no footer (backward compatible)", () => {
    const html = buildSampleDocument({ ...input, sourceRevisions: undefined });
    expect(html).not.toContain(SOURCE_REVISIONS_LABEL_AR);
  });
});
