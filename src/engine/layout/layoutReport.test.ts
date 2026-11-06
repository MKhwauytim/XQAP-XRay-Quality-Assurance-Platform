import { describe, expect, it } from "vitest";
import { layoutFixture, layoutOf, run, withText } from "../__fixtures__/helpers";
import type { Case } from "../__fixtures__/helpers";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import { LIMITS } from "../limits";
import { gridToPx, LAYOUT } from "./layoutReport";
import type { BarChartBox, LayoutBox, LayoutDoc, TableBox, TextBox } from "./types";

/** `n` distinct ports as table rows; the table frame is rows 1..11 (77..926 px, 849 px high), rowH 50, header 60. */
function withTableRows(n: number, opts: { columns?: number; label?: string } = {}): Case {
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
      id: `m${i}`, label: opts.label ?? `م${i}`, datasetId: "studies", formula: "count([الحالة])",
      format: { kind: "int" as const, digits: 0 },
    }));
    f.spec.model.measures.push(...extra);
    table.wells.values = extra.map((m) => ({ measure: m.id }));
  }
  return { f, files };
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
    expect(doc.slides[0].boxes[0]).toMatchObject({ kind: "text", id: "s1-title", x: LAYOUT.margin, y: LAYOUT.margin, w: 1920 - 2 * LAYOUT.margin });
    expect(doc.slides[1].boxes[0]).toMatchObject({ kind: "text", id: "s2-title" });
    expect(textOf(doc, "s2-title")).toBe("التفصيل");
  });

  it("records param and static digit text as non-figure spans, and none on the plain fixture", () => {
    expect(layoutFixture().nonFigureSpans).toEqual([]);
    const doc = layoutOf(withText("تقرير {{param:port}} 2026 المستوى 1: {{measure:matchRate}}"));
    expect(doc.nonFigureSpans).toHaveLength(1);
    expect(doc.nonFigureSpans[0]).toMatchObject({ slide: 1, boxId: "s1-p1text-0" });
    expect(doc.nonFigureSpans[0].text).toContain("2026 المستوى 1");
    expect(doc.nonFigureSpans[0].text).not.toContain("70.00%");
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
    expect(t.colW.reduce((a, b) => a + b, 0)).toBe(1920 - 2 * LAYOUT.margin);
    expect(t.rows[0][0].groupKey).toBe("portType=بحري");
    expect(t.rows[1][0].groupKey).toBe("portType=بري");
    expect(t.rows[0][0].valueKey).toBeUndefined();
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
    const bodyRows = (t: TableBox) => t.rows.filter((row) => row[0].groupKey !== undefined).length;
    expect(tables.map(bodyRows)).toEqual([15, 15, 10]);
    expect(tables.map((t) => t.rows.length)).toEqual([15, 15, 11]);
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

  it("the totals row closes the last page only, with re-evaluated totals", () => {
    const fixture = layoutFixture();
    const t = tableOf(fixture, 1);
    const total = t.rows[t.rows.length - 1];
    expect(total[0].lines.flat().map((r) => r.text).join("")).toBe("الإجمالي");
    expect(total.map((c) => c.valueKey)).toEqual([undefined, "studied", "matchRate"]);
    expect(total[2].id).toBe(`${t.id}-r3c2`);
    expect(fixture.figures).toContainEqual({ slide: 2, boxId: `${t.id}-r3c2`, valueKey: "matchRate", display: "70.00%" });
    expect(fixture.figures).toContainEqual({ slide: 2, boxId: `${t.id}-r3c1`, valueKey: "studied", display: "10" });

    const doc = layoutOf(withTableRows(40));
    const pages = doc.slides.slice(1).map((s) => s.boxes.find((b) => b.kind === "table") as TableBox);
    const hasTotal = pages.map((p) => p.rows.some((row) => row[0].lines.flat().some((r) => r.text === "الإجمالي")));
    expect(hasTotal).toEqual([false, false, true]);
    const totalFigs = doc.figures.filter((f) => f.boxId.startsWith("s4-") && f.valueKey === "studied");
    expect(totalFigs).toEqual([{ slide: 4, boxId: "s4-p2table-0-r11c1", valueKey: "studied", display: "40" }]);
  });

  it("a narrow-column header gives fit.tooLong for the table, reported once on its first slide", () => {
    const doc = layoutOf(withTableRows(40, { columns: 24, label: "مقياس طويل جدا لا يتسع في العمود" }));
    const header = doc.issues.filter((i) => i.rule === "fit.tooLong" && i.visual === "p2table" && i.detail?.startsWith("header"));
    expect(header.length).toBeGreaterThanOrEqual(23); // every long measure header; «المنفذ» may also miss at 62px
    expect(new Set(header.map((i) => i.page))).toEqual(new Set([2]));
  });

  it("no two boxes intersect and every box sits inside the margins", () => {
    const crowded = withTableRows(40, { columns: 24 });
    const kpi = crowded.f.spec.pages[0].visuals[1];
    kpi.wells.values = ["studied", "matchRate", "m0", "m1", "m2", "m3"].map((measure) => ({ measure }));
    for (const doc of [layoutFixture(), layoutOf(crowded)]) {
      for (const s of doc.slides) {
        const rects = s.boxes.map((b) => ({ b, r: rectOf(b) }));
        for (const { b, r } of rects) {
          expect(r.x, b.id).toBeGreaterThanOrEqual(LAYOUT.margin);
          expect(r.y, b.id).toBeGreaterThanOrEqual(LAYOUT.margin);
          expect(r.x + r.w, b.id).toBeLessThanOrEqual(1920 - LAYOUT.margin);
          expect(r.y + r.h, b.id).toBeLessThanOrEqual(1080 - LAYOUT.margin);
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            // A panel (rect) may hold the boxes drawn on it; any other overlap is a defect.
            if ((a.b.kind === "rect" && contains(a.r, b.r)) || (b.b.kind === "rect" && contains(b.r, a.r))) continue;
            expect(intersects(a.r, b.r), `${a.b.id} x ${b.b.id}`).toBe(false);
          }
        }
      }
    }
  });
});

type R = { x: number; y: number; w: number; h: number };
function rectOf(b: LayoutBox): R {
  if (b.kind === "rule") return { x: b.x, y: b.y, w: b.w, h: LAYOUT.ruleH };
  if (b.kind === "table") {
    return { x: b.x, y: b.y, w: b.colW.reduce((a, c) => a + c, 0), h: LAYOUT.headerH + b.rows.length * b.rowH };
  }
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}
function intersects(a: R, b: R): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function contains(o: R, i: R): boolean {
  return i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
}
