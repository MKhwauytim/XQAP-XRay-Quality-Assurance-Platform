import { beforeAll, describe, expect, it } from "vitest";
import { buildOutputs, dropPart, editPart, editPptxText, paramDigitFixture } from "../__fixtures__/gateKit";
import type { Outputs } from "../__fixtures__/gateKit";
import { runGates } from "./runGates";

let good: Outputs;
beforeAll(async () => { good = await buildOutputs(); });
const gateOn = (x: Outputs & { recipe?: string }) => runGates(x);

describe("runGates", () => {
  it("passes the fixture with every count from checkOoxml", async () => {
    const r = await gateOn(good);
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.counts).toMatchObject({ slides: 2, pptxTables: 1, pptxCharts: 1, xlsxTables: 2, rawDigitHitsSkipped: 0, rawLintHitsSkipped: 0 });
  });

  it("figure parity fails when one PPTX number is edited", async () => {
    const bad = await editPptxText(good.pptx, "70.00%", "71.00%");
    expect((await gateOn({ ...good, pptx: bad })).issues).toContainEqual(expect.objectContaining({ rule: "gate.figureParity", page: 1 }));
  });

  it("reports every failing gate, never short-circuits", async () => {
    const bad = { ...good, pptx: await editPptxText(good.pptx, "70.00%", "71.00%"), xlsx: await dropPart(good.xlsx, "xl/tables/table1.xml") };
    const r = await gateOn(bad);
    const rules = r.issues.map((i) => i.rule);
    expect(rules).toContain("gate.figureParity");
    expect(rules).toContain("gate.ooxml");
    expect(r.passed).toBe(false);
  });

  it("lint errors are blocking issues and kept separately for the lint report", async () => {
    const html = good.html.replace("الملخص", "الملخص \u2014 عام");
    const r = await gateOn({ ...good, html });
    expect(r.lint.errors).toContainEqual(expect.objectContaining({ rule: "gate.lint", path: "html", detail: "T3: U+2014" }));
    expect(r.issues).toEqual(expect.arrayContaining(r.lint.errors));
    expect(r.passed).toBe(false);
  });

  it("scans the recipe for T6", async () => {
    const r = await gateOn({ ...good, recipe: '{"title":"\u2705"}' });
    expect(r.lint.errors).toContainEqual(expect.objectContaining({ path: "recipe", detail: "T6: U+2705" }));
  });

  it("a gate that throws on unreadable bytes becomes an issue, not a crash", async () => {
    const r = await gateOn({ ...good, xlsx: new Uint8Array([1, 2, 3]) });
    expect(r.passed).toBe(false);
    expect(r.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(["gate.ooxml", "gate.figureParity", "gate.reconcile"]));
  });

  it("passes a param value with digits and static digit text, recorded as non-figure spans", async () => {
    const o = await buildOutputs(paramDigitFixture());
    const spans = o.doc.nonFigureSpans.map((s) => s.text).join(" ");
    expect(spans).toContain("2026-05");
    expect(spans).toContain("المستوى 1");
    const r = await gateOn(o);
    expect(r.issues).toEqual([]);
  });

  it("lints every companion part, such as docProps, outside the raw worksheets", async () => {
    const companion = await editPart(good.companion, "docProps/app.xml", (x) => x.replace("</Properties>", "<Company>a\u2014b</Company></Properties>"));
    const r = await gateOn({ ...good, companion });
    expect(r.lint.errors).toContainEqual(expect.objectContaining({ path: "companion: docProps/app.xml", detail: "T3: U+2014" }));
  });

  it("scans the recipe and the HTML for Arabic-Indic digits, and HTML aria-label text for T3", async () => {
    const html = good.html.replace('<section class="slide"', '<section aria-label="\u2013" class="slide"').replace("</body>", "<!-- --></body>");
    const r = await gateOn({ ...good, html, recipe: '{"n":"\u0663"}' });
    expect(r.lint.errors).toContainEqual(expect.objectContaining({ path: "recipe", detail: "decision 4: 1 Arabic-Indic digits" }));
    expect(r.lint.errors).toContainEqual(expect.objectContaining({ path: "html", detail: "T3: U+2013" }));
    const h = await gateOn({ ...good, html: good.html.replace("<title>", "<title>\u0661") });
    expect(h.lint.errors).toContainEqual(expect.objectContaining({ path: "html", detail: "decision 4: 1 Arabic-Indic digits" }));
  });
});
