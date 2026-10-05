import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../reporting/executiveReportTypes";
import { buildReportModel } from "../reporting/executive/model/reportModel";
import { buildExecutiveReport } from "../reporting/executive";
import { SHEET_NAMES, buildExecutiveWorkbookObject } from "../reporting/executive/workbook/workbook";
import { getLabels } from "../labels/labelsStore";
import * as XLSX from "xlsx";
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
    mk({ "معرف الأشعة": "A3", "المستوى": "SECOND_STAGE", "هل يوجد صورة؟": "نعم", "اسم المنفذ": "منفذ ب", "نوع المنفذ": "منفذ بري", "رمز المنفذ": "10" }),
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

  it("buildExecutiveReport (document) omits population/coverage sections and states its scope", async () => {
    const html = await buildExecutiveReport(input, {});
    clean(html);
    expect(buildReportModel(input, {}).scope).toBe("completed-only");
    for (const absent of [
      "مجتمع الصور في لمحة", "المجتمع حسب المنفذ", "المجتمع حسب المستوى", "العينة والإنجاز",
      "جودة البيانات والاستبعادات", "التغطية التشغيلية", "المساءلة التشغيلية", "إجمالي المجتمع",
      "الجزء الأول: النطاق والمنهجية", "الجزء السادس: التغطية والمساءلة التشغيلية", "page-p1", "page-p6", "page-exclusions",
    ]) expect(html, absent).not.toContain(absent);
    for (const present of ["الدقة والكشف", "تحليل أنواع الأخطاء", "المنهجية والملاحق", getLabels().ce_scope_note]) {
      expect(html, present).toContain(present);
    }
  });

  it("buildExecutiveWorkbookObject", async () => {
    const wb = await buildExecutiveWorkbookObject(input, {});
    expect(wb.SheetNames.length).toBeGreaterThan(0);
    for (const absent of [SHEET_NAMES.coverage, SHEET_NAMES.accountability, SHEET_NAMES.rawRisk, SHEET_NAMES.rawBi, SHEET_NAMES.exclusions]) {
      expect(wb.SheetNames, absent).not.toContain(absent);
    }
    const flat = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 }).flat().map(String);
    const kpi = flat(SHEET_NAMES.kpi);
    for (const absent of ["إجمالي المجتمع", "إجمالي العينة", "تغطية المجتمع%", "إنجاز العينة%", "متبقية"]) expect(kpi).not.toContain(absent);
    expect(kpi).toContain(getLabels().ce_completed_samples);
    expect(kpi).toContain("دقة المستوى الأول%");
    for (const sheet of [SHEET_NAMES.ports, SHEET_NAMES.stages]) {
      const cells = flat(sheet);
      for (const absent of ["المجتمع", "العينة", "التغطية%", "إنجاز%"]) expect(cells, `${sheet}:${absent}`).not.toContain(absent);
      expect(cells).toContain(getLabels().ce_completed_samples);
    }
  });
});

// Decks are intentionally NOT exercised for completed-only scope: the comprehensive page
// offers document + workbook only, and deck v2/v3 still render population/coverage
// framing from the completed-row count. Do not add deck cases here until they honour
// `model.scope === "completed-only"`.

/**
 * Completed-only scope must never print a population / coverage / target FIGURE, in
 * either narrative branch: (a) no finding fires -> the fallback line; (b) findings fire.
 */
describe("completed-only scope states no population figure", () => {
  const missed = mk({ "معرف الأشعة": "M1", "نتيجة المستوى الأول": "سليمة", "نتيجة المستوى الثاني": "سليمة", "صحة النتيجة": "اشتباه" });
  const toInput = (extra: Array<Record<string, string>>) => {
    const report = newMappingReport();
    const rows = [...workbookRows(), ...extra.map((c) => mapSampleRow(c, "Q1", report)).filter((m): m is MappedWorkbookRow => m !== null)];
    return buildComprehensiveInput(mergeCompletedRows([], rows).rows, fallbackBase);
  };
  const fixtures: Array<[string, ExecutiveReportInput]> = [
    ["no findings fire", toInput([])],
    ["findings fire", toInput([missed, missed, missed, missed, missed, missed])],
  ];
  // A population/coverage/target word directly followed by a number (either digit script).
  const FIGURE = /(المجتمع|مجتمع|التغطية|المستهدف|الهدف|المتبقي[ةه]?)[^<\d٠-٩]{0,12}[\d٠-٩]/;
  const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");

  it("fallback narrative uses the completed-samples wording when no finding fires", () => {
    const [findings, actions] = [buildReportModel(fixtures[0][1], {}).summary.findings, buildReportModel(fixtures[0][1], {}).actions];
    const expected = getLabels().ce_narrative_completed_total.replace("{n}", "6");
    expect(findings).toEqual([expected]);
    expect(actions).toEqual([expected]);
    expect(expected).not.toContain("المجتمع");
  });
  it("some finding does fire in the second fixture", () => {
    const f = buildReportModel(fixtures[1][1], {}).summary.findings;
    expect(f.join(" ")).not.toContain(getLabels().ce_narrative_completed_total.split("{n}")[0]);
  });

  it.each(fixtures)("document and workbook text carry no figure-bearing population phrase (%s)", async (_n, input) => {
    const html = text(await buildExecutiveReport(input, {}));
    expect(html).not.toMatch(FIGURE);
    const wb = await buildExecutiveWorkbookObject(input, {});
    for (const name of wb.SheetNames) {
      const cells = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 }).flat().map(String);
      for (const c of cells) expect(c, `${name}: ${c}`).not.toMatch(FIGURE);
    }
  });
});
