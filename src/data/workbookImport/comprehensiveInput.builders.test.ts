import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../reporting/executiveReportTypes";
import { buildReportModel } from "../reporting/executive/model/reportModel";
import { buildExecutiveReport } from "../reporting/executive";
import { buildExecutiveDeckV2 } from "../reporting/executive/deck2";
import { buildExecutiveDeckV3 } from "../reporting/executive/deck3";
import { buildExecutiveWorkbookObject } from "../reporting/executive/workbook/workbook";
import { makeProcessingSummary, makeSampleMaster } from "../reporting/reportTestFixtures";
import { COMPREHENSIVE_MONTH_LABEL, buildComprehensiveInput, mergeCompletedRows } from "./mergeWithSystem";
import { mapSampleRow, newMappingReport } from "./workbookColumnMap";
import type { MappedWorkbookRow } from "./workbookColumnMap";

/**
 * The comprehensive page feeds the REAL report builders a `rowsOverride` input
 * (no population/sample/distribution). These tests run every builder on such an
 * input, built exactly as the page builds it, and check the output is sane.
 */
const mk = (over: Record<string, string>): Record<string, string> => ({
  "معرف الأشعة": "A1", "الشهر": "46023", "المستوى": "FORTH_STAGE",
  "نتيجة المستوى الأول": "اشتباه", "نتيجة المستوى الثاني": "سليمة", "صحة النتيجة": "سليمة",
  "الاكتمال": "مكتمل", "هل يوجد صورة؟": "نعم", "هل يوجد تحديد؟": "لا", "مستوى جودة الصورة": "عالي",
  "اسم المنفذ": "ميناء أ", "نوع المنفذ": "منفذ بحري", "رمز المنفذ": "30",
  ...over,
});

function workbookRows(): MappedWorkbookRow[] {
  const report = newMappingReport();
  const cases = [
    mk({}),
    mk({ "معرف الأشعة": "A2", "المستوى": "FIRST_STAGE", "نتيجة المستوى الأول": "سليمة", "صحة النتيجة": "" }),
    mk({ "معرف الأشعة": "A3", "المستوى": "SECOND_STAGE", "هل يوجد صورة؟": "لا", "اسم المنفذ": "منفذ ب", "نوع المنفذ": "منفذ بري", "رمز المنفذ": "10" }),
    mk({ "معرف الأشعة": "A4", "المستوى": "THIRD_STAGE", "هل يوجد صورة؟": "", "مستوى جودة الصورة": "منخفض", "نتيجة المستوى الثاني": "اشتباه", "صحة النتيجة": "اشتباه" }),
    // Same id, a different month: must survive as its own row.
    mk({ "معرف الأشعة": "A1", "الشهر": "46054", "نتيجة المستوى الأول": "سليمة", "مستوى جودة الصورة": "متوسط" }),
    mk({ "معرف الأشعة": "A5", "الشهر": "46054", "اسم المنفذ": "مطار", "نوع المنفذ": "مطار", "رمز المنفذ": "50" }),
  ];
  return cases.map((c) => mapSampleRow(c, "Q1", report)).filter((m): m is MappedWorkbookRow => m !== null);
}

const fallbackBase: ExecutiveReportInput = {
  monthFolderName: COMPREHENSIVE_MONTH_LABEL,
  populationRows: [], sample: null, distribution: null, employeeFiles: [],
  template: null, config: DEFAULT_EXEC_CONFIG,
};
const systemBase: ExecutiveReportInput = {
  monthFolderName: "5-May-2026",
  populationRows: [], employeeFiles: [], distribution: null,
  sample: makeSampleMaster([]),
  template: null, config: DEFAULT_EXEC_CONFIG,
  processingSummary: makeProcessingSummary() as never,
  sourceRevisions: [{ file: "population.final.json", revision: 7 }] as never,
};

const bases: Array<[string, ExecutiveReportInput]> = [["system base", systemBase], ["fallback base", fallbackBase]];

describe.each(bases)("real builders on a combined input (%s)", (_name, base) => {
  const merged = mergeCompletedRows([], workbookRows());
  const input = buildComprehensiveInput(merged.rows, base);

  const clean = (html: string) => {
    expect(html.length).toBeGreaterThan(1000);
    // Word boundaries: the embedded base64 fonts legitimately contain "NaN" inside longer runs.
    expect(html).not.toMatch(/\bNaN\b|\bundefined\b/);
  };

  it("keeps the repeated id across months as separate rows and leaks nothing from the base", () => {
    expect(merged.rows).toHaveLength(6);
    expect(new Set(merged.rows.map((r) => r.xrayImageId)).size).toBe(6);
    expect(input.processingSummary).toBeNull();
    expect(input.sample).toBeNull();
  });

  it("buildReportModel", () => {
    const model = buildReportModel(input, {});
    expect(JSON.stringify(model)).not.toMatch(/NaN/);
    const kpis = (model as unknown as { kpis: Record<string, unknown> }).kpis;
    for (const [k, v] of Object.entries(kpis)) if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
  });

  it("buildExecutiveReport (document)", async () => {
    const html = await buildExecutiveReport(input, {});
    clean(html);
  });

  it("buildExecutiveDeckV2", async () => {
    clean(await buildExecutiveDeckV2(input, {}));
  });

  it("buildExecutiveDeckV3", async () => {
    clean(await buildExecutiveDeckV3(input, {}));
  });

  it("buildExecutiveWorkbookObject", async () => {
    const wb = await buildExecutiveWorkbookObject(input, {});
    expect(wb.SheetNames.length).toBeGreaterThan(0);
  });
});
