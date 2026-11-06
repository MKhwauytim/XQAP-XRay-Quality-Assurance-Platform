import { describe, expect, it } from "vitest";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import { LIMITS } from "../limits";
import { resolveVisuals } from "../resolve/resolve";
import { gridToPx, layoutReport } from "./layoutReport";
import { createFixedAdvanceMeasurer } from "./measure";
import type { BarChartBox, LayoutDoc, TableBox, TextBox } from "./types";

interface Case { f: Fixture; files: RawFile[] }

function run({ f, files }: Case) {
  const data = new Map<string, ProcessedDataset>();
  const profiles = new Map<string, ColumnProfile[]>();
  f.spec.datasets.forEach((def, i) => {
    const { data: typed } = typeDataset(def, files);
    profiles.set(def.id, profileColumns(typed, def));
    data.set(def.id, applySteps(typed, def, f.params, i));
  });
  const r = resolveVisuals(f.spec, data, profiles, f.params);
  const doc = layoutReport(f.spec, r.visuals, r.values, f.params, f.theme, createFixedAdvanceMeasurer());
  return { doc, values: r.values };
}

const layoutOf = (c: Case): LayoutDoc => run(c).doc;
const layoutFixture = (): LayoutDoc => layoutOf({ f: twoSlideFixture(), files: FIXTURE_FILES });

/** `n` distinct ports as table rows; the table frame is rows 1..11 (77..926 px, 849 px high), rowH 50, header 60. */
function withTableRows(n: number, opts: { columns?: number } = {}): Case {
  const f = twoSlideFixture();
  const files = structuredClone(FIXTURE_FILES);
  files[0].sheets[0].rows = Array.from({ length: n }, (_, i) => [`منفذ ${String(i).padStart(4, "0")}`, "بري", "مطابق", i]);
  const page = f.spec.pages[1];
  page.visuals = page.visuals.filter((v) => v.visualId === "p2table");
  const table = page.visuals[0];
  table.frame = { col: 0, row: 1, w: 24, h: 11, z: 1 };
  table.wells.rows = [{ field: "port" }];
  if (opts.columns !== undefined) {
    const extra = Array.from({ length: opts.columns - 1 }, (_, i) => ({
      id: `m${i}`, label: `م${i}`, datasetId: "studies", formula: "count([الحالة])",
      format: { kind: "int" as const, digits: 0 },
    }));
    f.spec.model.measures.push(...extra);
    table.wells.values = extra.map((m) => ({ measure: m.id }));
  }
  return { f, files };
}

function withText(s: string): Case {
  const f = twoSlideFixture();
  f.spec.pages[0].visuals[0].text = s;
  return { f, files: FIXTURE_FILES };
}

function textOf(doc: LayoutDoc, boxId: string): string {
  const box = doc.slides.flatMap((s) => s.boxes).find((b) => b.id === boxId) as TextBox | undefined;
  if (!box) throw new Error(`no box ${boxId}`);
  return box.lines.map((l) => l.map((r) => r.text).join("")).join(" ");
}

const tableOf = (doc: LayoutDoc, slide: number) =>
  doc.slides[slide].boxes.find((b) => b.kind === "table") as TableBox;

describe("layoutReport", () => {
  it("lays out the fixture into 2 slides with every figure registered", () => {
    const { doc, values } = run({ f: twoSlideFixture(), files: FIXTURE_FILES });
    expect(doc.slides.map((s) => s.index)).toEqual([1, 2]);
    expect(doc.issues).toEqual([]);
    expect(doc.figures.length).toBeGreaterThan(0);
    expect(doc.figures.every((f) => values.has(f.valueKey))).toBe(true);
    expect(doc.figures.every((f) => values.get(f.valueKey)!.display === f.display)).toBe(true);
    expect(doc.slides[0].boxes[0]).toMatchObject({ kind: "text", id: "s1-title", x: 0, y: 0, w: 1920 });
    expect(doc.slides[1].boxes[0]).toMatchObject({ kind: "text", id: "s2-title" });
    expect(textOf(doc, "s2-title")).toBe("التفصيل");
  });

  it("{{measure:matchRate}} and {{param:port}} in text render the resolved values", () => {
    const doc = layoutFixture();
    const t = textOf(doc, "s1-p1text-0");
    expect(t).toContain("70.00%");
    expect(t).toContain("جدة");
    expect(t).not.toContain("{{");
    const box = doc.slides[0].boxes.find((b) => b.id === "s1-p1text-0") as TextBox;
    expect(box.valueKeys).toEqual(["matchRate"]);
    expect(box.lines[0].find((r) => r.text === "70.00%")!.ltr).toBe(true);
  });

  it("gridToPx maps col 0..24 to 0..1920", () => {
    expect(gridToPx({ col: 0, row: 0, w: 24, h: 14, z: 0 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(gridToPx({ col: 3, row: 1, w: 2, h: 1, z: 0 })).toEqual({ x: 240, y: 77, w: 160, h: 77 });
  });

  it("table cells carry ids {boxId}-r{row}c{col}", () => {
    const t = tableOf(layoutFixture(), 1);
    expect(t.id).toBe("s2-p2table-0");
    expect(t.header[0].id).toBe(`${t.id}-r0c0`);
    expect(t.rows[0][1].id).toBe(`${t.id}-r1c1`);
    expect(t.rows[0][1].valueKey).toBe("studied@portType=بحري");
    expect(t.colW.reduce((a, b) => a + b, 0)).toBe(1920);
  });

  it("bar chart values and keys follow the resolved categories", () => {
    const bar = layoutFixture().slides[1].boxes.find((b) => b.kind === "bar") as BarChartBox;
    expect(bar.categories).toEqual(["البطحاء", "الحديثة", "جدة"]);
    expect(bar.valueKeys).toEqual(["matchRate@port=البطحاء", "matchRate@port=الحديثة", "matchRate@port=جدة"]);
    expect(bar.color).toBe(twoSlideFixture().theme.tones.primary);
  });

  it("a 40-row table paginates 15/15/10 with a repeated header and «(يتبع)» titles", () => {
    const doc = layoutOf(withTableRows(40)); // rowH 50, header 60: floor((849 - 60) / 50) = 15
    const tables = doc.slides.map((s) => s.boxes.find((b) => b.kind === "table") as TableBox).filter(Boolean);
    expect(tables.map((t) => t.rows.length)).toEqual([15, 15, 10]);
    expect(tables.every((t) => t.header.length === tables[0].header.length)).toBe(true);
    expect(tables.map((t) => t.continued)).toEqual([false, true, true]);
    expect(doc.slides.slice(-2).every((s) => s.title.endsWith(" (يتبع)"))).toBe(true);
    expect(textOf(doc, "s4-title")).toBe("التفصيل (يتبع)");
    expect(doc.slides.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("the cells limit caps rows per page", () => {
    const doc = layoutOf(withTableRows(40, { columns: 24 })); // 240 / 24 = 10 rows
    expect(tableOf(doc, 1).header.length).toBe(24);
    expect(tableOf(doc, 1).rows.length).toBe(10);
  });

  it("pagination past maxSlides gives limit.slides", () => {
    const doc = layoutOf(withTableRows(15 * LIMITS.maxSlides + 1));
    expect(doc.slides.length).toBeGreaterThan(LIMITS.maxSlides);
    expect(doc.issues.map((i) => i.rule)).toContain("limit.slides");
  });

  it("a text failing the ladder is in issues with page, visual and fit.tooLong", () => {
    const doc = layoutOf(withText("س".repeat(400)));
    expect(doc.issues).toContainEqual(expect.objectContaining({ rule: "fit.tooLong", page: 1, visual: "p1text" }));
    expect(textOf(doc, "s1-p1text-0")).toBe("س".repeat(400));
  });

  it("is deterministic", () => {
    expect(layoutFixture()).toEqual(layoutFixture());
  });
});
