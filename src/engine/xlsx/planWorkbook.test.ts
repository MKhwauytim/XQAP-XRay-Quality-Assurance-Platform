import { describe, expect, it } from "vitest";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import { pipeline } from "../__fixtures__/xlsxKit";
import type { RawFile } from "../data/types";
import { validateSpec } from "../spec/validate";
import { SOURCE_TABLE, excelNameKey, planWorkbook } from "./planWorkbook";

function plan(p = pipeline()) {
  return planWorkbook(p.files, p.f.spec, p.processed, p.values, p.doc);
}

function twoFilesSameLongSheet(): RawFile[] {
  const sheet = { sheetName: "ورقة بيانات طويلة الاسم جدا جدا", headers: ["أ"], rows: [[1]] };
  return [
    { fileName: "ملف التقرير الشهري للمنافذ.xlsx", bytesSha256: "a".repeat(64), sheets: [sheet, { ...sheet }] },
    { fileName: "ملف التقرير الشهري للمنافذ.xlsx", bytesSha256: "b".repeat(64), sheets: [{ ...sheet }] },
    ...FIXTURE_FILES,
  ];
}

describe("planWorkbook", () => {
  it("report order follows M3 round 2 with the raw section moved to the companion", () => {
    const p = plan();
    expect(p.sheets.map((s) => s.kind)).toEqual(["index", "separator", "step", "step", "separator", "processed", "separator", "stats", "separator", "source"]);
    expect(p.sheets.filter((s) => s.kind === "separator").map((s) => s.name)).toEqual(["|", "||", "|||", "||||"]);
    expect(p.companion.sheets.map((s) => [s.kind, s.name])).toEqual([["index", "الفهرس"], ["separator", "|"], ["raw", "studies.xlsx نتائج الدراسة"]]);
    expect(p.issues).toEqual([]);
  });

  it("names processing sheets by what they do, in the order applied, never by number", () => {
    const p = plan();
    expect(p.sheets.filter((s) => s.kind === "step").map((s) => s.name)).toEqual(["استبعاد الحالة الفارغة", "حذف التكرار"]);
    expect(p.sheets.map((s) => s.name).some((n) => /خطوة|\d/.test(n))).toBe(false);
  });

  it("every non-raw, non-separator sheet carries the header block with counts", () => {
    const p = plan();
    const s1 = p.sheets.find((s) => s.stepId === "s1");
    expect(s1?.header).toMatchObject({ before: 12, removed: 1, after: 11, readsFrom: "studies.xlsx نتائج الدراسة (مصنف البيانات الخام)" });
    expect(s1?.header?.rule).toBe("يبقي الصفوف التي يكون فيها «الحالة» غير فارغ، ويستبعد غيرها");
    expect(p.sheets.find((s) => s.stepId === "s2")?.header?.readsFrom).toBe("استبعاد الحالة الفارغة");
    expect(p.sheets.find((s) => s.kind === "processed")?.header).toMatchObject({ before: 12, removed: 2, after: 10 });
    for (const s of [...p.sheets, ...p.companion.sheets]) {
      if (s.kind !== "raw" && s.kind !== "separator") expect(s.header?.title.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("uses readable Arabic table names: the dataset's and the source's", () => {
    expect(plan().tables.map((t) => t.name)).toEqual(["جدول_الدراسات", SOURCE_TABLE]);
  });

  it("plans one pivot on the processed set and one per statistic group, each on a real column", () => {
    const p = plan();
    const pivots = p.sheets.flatMap((s) => s.pivots ?? []);
    expect(pivots.map((x) => [x.name, x.rowField, x.dataField, x.agg, x.feedsSlide])).toEqual([
      ["المدروس حسب نوع المنفذ", "نوع المنفذ", "الحالة", "count", 2],
      ["المدروس حسب نوع المنفذ", "نوع المنفذ", "الحالة", "count", 2],
      ["عدد الصفوف حسب المنفذ", "المنفذ", "المنفذ", "count", 2],
    ]);
    expect(pivots[1].valueKeys).toContain("studied@portType=بري");
  });

  it("long or duplicate raw sheet names are made unique and kept within 31 characters", () => {
    const p = pipeline();
    const wp = planWorkbook(twoFilesSameLongSheet(), p.f.spec, p.processed, p.values, p.doc);
    const raw = wp.companion.sheets.filter((s) => s.kind === "raw").map((s) => s.name);
    expect(raw).toHaveLength(4);
    expect(new Set(raw.map(excelNameKey)).size).toBe(raw.length);
    raw.forEach((n) => expect(n.length).toBeLessThanOrEqual(31));
    expect(raw[1].endsWith(" 2")).toBe(true);
  });

  it("a dataset whose table name collides with tblSource is rejected by validateSpec", () => {
    const f = twoSlideFixture();
    f.spec.datasets[0].id = "source";
    expect(validateSpec(f.spec)).toContainEqual(expect.objectContaining({ rule: "schema.invalid", path: "datasets[0].id" }));
  });

  it("two columns that differ only by the hamza on alef are an Excel clash", () => {
    const f = twoSlideFixture();
    f.spec.datasets[0].columns[1].label = "الأشعة";
    f.spec.datasets[0].columns[2].label = "الاشعة";
    const p = pipeline(f);
    expect(planWorkbook(p.files, f.spec, p.processed, p.values, p.doc).issues).toContainEqual(
      expect.objectContaining({ rule: "xlsx.columnClash", path: "datasets[0].columns[2].label" }),
    );
  });

  it("refuses id-like and numbered-step visible names (M15)", () => {
    const f = twoSlideFixture();
    f.spec.datasets[0].steps[0].label = "خطوة 1 تنظيف";
    f.spec.datasets[0].columns[0].label = "portType";
    f.spec.datasets[0].steps[1].label = "s2";
    const p = pipeline(f);
    const issues = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc).issues.filter((i) => i.rule === "xlsx.names");
    const names = issues.map((i) => i.detail);
    expect(names).toContain("خطوة 1 تنظيف");
    expect(names).toContain("portType");
    expect(names).toContain("s2");
  });

  it("the fixture's visible names pass the M15 check", () => {
    expect(plan().issues.filter((i) => i.rule === "xlsx.names")).toEqual([]);
  });
});
