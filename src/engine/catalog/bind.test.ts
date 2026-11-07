import { describe, expect, it } from "vitest";
import { twoDatasetsFixture } from "../__fixtures__/twoDatasets";
import { formatIssue } from "../messages";
import { validateSpec } from "../spec/validate";
import { buildSpecFromPicks, type PickBinding, type PicksBase } from "./bind";
import type { CatalogDesign } from "./types";

const fx = twoDatasetsFixture();
const base: PicksBase = {
  reportId: "r1",
  title: "تقرير",
  datasets: fx.spec.datasets,
  model: fx.spec.model,
  params: fx.spec.params,
};

const design = (number: number, extra: Partial<CatalogDesign> = {}): CatalogDesign => ({
  number,
  nameAr: `تصميم ${number}`,
  descriptionAr: "وصف",
  deck3Source: "test",
  status: "active",
  slots: [
    { id: "cat", nameAr: "الفئة", kind: "dimension", required: true },
    { id: "val", nameAr: "القيمة", kind: "measure", required: true },
    { id: "note", nameAr: "الملاحظة", kind: "text", required: false },
  ],
  page: {
    grid: { cols: 24, rows: 14 },
    visuals: [
      {
        visualId: "bar", type: "barChart", frame: { col: 0, row: 4, w: 24, h: 10, z: 1 },
        wells: { axis: [{ slot: "cat" }], values: [{ slot: "val" }] },
      },
      {
        visualId: "txt", type: "text", frame: { col: 0, row: 1, w: 24, h: 3, z: 1 }, wells: {},
        text: "الإجمالي {{slot:val}} {{slot:note}}",
      },
    ],
  },
  ...extra,
});
const cat = [design(1), design(5)];
const pick = (number: number, over: Partial<PickBinding> = {}): PickBinding => ({
  number,
  title: "بلغ الإجمالي {{measure:totalWeight}}",
  slots: { cat: { field: "shipPort" }, val: { measure: "totalWeight" }, note: { text: "ملاحظة" } },
  ...over,
});

function fail(r: ReturnType<typeof buildSpecFromPicks>) {
  if (r.ok) throw new Error("expected failure");
  return r.issues;
}

describe("buildSpecFromPicks", () => {
  it("keeps pick order and builds page ids", () => {
    const r = buildSpecFromPicks([5, 1], [pick(1), pick(5)], base, cat);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.spec.pages.map((p) => p.pageId)).toEqual(["p1-d5", "p2-d1"]);
    expect(r.spec.pages[0].size).toBe("16:9");
  });
  it("replaces slots in wells and text", () => {
    const r = buildSpecFromPicks([1], [pick(1)], base, cat);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const [bar, txt] = r.spec.pages[0].visuals;
    expect(bar.wells).toEqual({ axis: [{ field: "shipPort" }], values: [{ measure: "totalWeight" }] });
    expect(txt.text).toBe("الإجمالي {{measure:totalWeight}} ملاحظة");
  });
  it("returns a spec that validates", () => {
    const r = buildSpecFromPicks([1], [pick(1)], base, cat);
    if (!r.ok) throw new Error("fail");
    expect(validateSpec(r.spec, undefined, fx.params)).toEqual([]);
  });
  it("names the design and the slot for a missing required slot", () => {
    const i = fail(buildSpecFromPicks([1], [pick(1, { slots: { cat: { field: "shipPort" } } })], base, cat));
    expect(i[0].rule).toBe("bind.missingSlot");
    expect(i[0].detail).toContain("1");
    expect(i[0].detail).toContain("القيمة");
    expect(i[0].detail).not.toContain("val");
  });
  it("refuses a measure slot bound to a field", () => {
    const i = fail(buildSpecFromPicks([1], [pick(1, { slots: { cat: { field: "shipPort" }, val: { field: "weight" } } })], base, cat));
    expect(i[0].rule).toBe("bind.wrongKind");
    expect(i[0].detail).toContain("القيمة");
  });
  it("refuses a field missing from the dataset through validateSpec", () => {
    const r = buildSpecFromPicks([1], [pick(1, { slots: { cat: { field: "nope" }, val: { measure: "totalWeight" } } })], base, cat);
    expect(r.ok).toBe(false);
  });
  it("reports a number with no binding", () => {
    const i = fail(buildSpecFromPicks([1, 5], [pick(1)], base, cat));
    expect(i).toEqual([{ rule: "bind.missingPick", detail: "5 تصميم 5" }]);
  });
  it("requires a figure placeholder in the title", () => {
    const i = fail(buildSpecFromPicks([1], [pick(1, { title: "عنوان بلا رقم" })], base, cat));
    expect(i[0].rule).toBe("bind.titleNoFigure");
    expect(formatIssue(i[0])).toContain("تصميم 1");
  });
  it("exempts a design that overrules R8", () => {
    const c = [design(1, { overrules: [{ rule: "R8", reasonAr: "غلاف" }] })];
    const r = buildSpecFromPicks([1], [pick(1, { title: "عنوان بلا رقم" })], base, c);
    expect(r.ok).toBe(true);
  });
  it("collects issues across all picks", () => {
    const i = fail(buildSpecFromPicks([1, 5], [pick(1, { slots: {} }), pick(5, { title: "x" })], base, cat));
    expect(i.map((x) => x.rule)).toEqual(["bind.missingSlot", "bind.missingSlot", "bind.titleNoFigure"]);
  });
});
