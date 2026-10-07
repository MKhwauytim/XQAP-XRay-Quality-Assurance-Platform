import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../reporting/executiveReportTypes";
import { buildReportModel } from "../reporting/executive/model/reportModel";
import { buildExecutiveReport } from "../reporting/executive";
import { buildExecutiveDeckV2 } from "../reporting/executive/deck2";
import { buildExecutiveDeckV3 } from "../reporting/executive/deck3";
import { SHEET_NAMES, buildExecutiveWorkbookObject } from "../reporting/executive/workbook/workbook";
import { getLabels } from "../labels/labelsStore";
import { formatMonthShortLabel } from "../population/monthFolder";
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
  const input = buildComprehensiveInput(merged.rows, base, merged.period);

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

  it("buildExecutiveDeckV2 omits population/coverage sections and states its scope", async () => {
    const html = await buildExecutiveDeckV2(input, {});
    clean(html);
    for (const absent of [
      "القسم الأول — مجتمع الفحص", "القسم الرابع — التغطية والمساءلة التشغيلية",
      'data-section="section1"', 'data-section="section4"',
      "تغطية العيّنة", "إجمالي مجتمع الصور", "فترة الدراسة (عيّنة شهر)", "صورة مسجّلة هذا الشهر",
    ]) expect(html, absent).not.toContain(absent);
    for (const present of ['data-section="section2"', getLabels().ce_scope_note, getLabels().ce_completed_samples]) {
      expect(html, present).toContain(present);
    }
  });

  it("deck v2 renumbers the remaining sections from 1 and drops the population tab from the side rail", async () => {
    const html = await buildExecutiveDeckV2(input, {});
    for (const present of [
      "القسم الأول — نتائج فحص الجودة", "القسم الثاني — التحاليل المتقدمة",
      'data-section-label="القسم 1 — نتائج فحص الجودة"', 'data-section-label="القسم 2 — التحاليل المتقدمة"',
      '<div class="v2-sep-eyebrow">القسم 1</div>', '<div class="v2-sep-eyebrow">القسم 2</div>',
    ]) expect(html, present).toContain(present);
    for (const absent of [
      "القسم الثاني — نتائج فحص الجودة", "القسم الثالث — التحاليل المتقدمة",
      '<div class="v2-rail-tab" data-edit="مجتمع الفحص">مجتمع الفحص</div>',
      '<div class="v2-rail-tab active" data-edit="مجتمع الفحص">مجتمع الفحص</div>',
    ]) expect(html, absent).not.toContain(absent);
    // Visible text and attributes only (the theme CSS carries «القسم 3 · …» comments).
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, " ");
    for (const absent of ["القسم 3", "القسم 4"]) expect(markup, absent).not.toContain(absent);
    expect(html).toContain('<div class="v2-rail-tab active" data-edit="نتائج فحص الجودة">نتائج فحص الجودة</div>');
  });

  it("buildExecutiveDeckV3 omits the population section and target figures, renumbers, and states its scope", async () => {
    const html = await buildExecutiveDeckV3(input, {});
    clean(html);
    for (const absent of [
      "القسم الأول — مجتمع الفحص", "مجتمع الفحص والعيّنة حسب المستوى", "التوزيع على المنافذ البرية والبحرية",
      "إجمالي المجتمع", "العيّنة المسحوبة", "العيّنة المستهدفة الأساسية شهريًا", "وزن السحب",
      "القسم الثالث", "مؤشرات الشهر", "عيّنة هذا الشهر", "نتائج الشهر", "فترة الدراسة (عيّنة شهر)",
    ]) expect(html, absent).not.toContain(absent);
    for (const present of [
      "القسم الأول — نتائج فحص الجودة", "القسم الثاني — التحاليل المتقدمة",
      getLabels().ce_scope_note, getLabels().ce_completed_samples,
    ]) expect(html, present).toContain(present);
    // Every slide's footer total matches the real slide count.
    const slides = html.match(/<section class="slide v3/g) ?? [];
    const totals = new Set([...html.matchAll(/v3-page-num">\d+ \/ (\d+)</g)].map((m) => m[1]));
    expect([...totals]).toEqual([String(slides.length)]);
  });

  it("every edition states the samples' study period instead of the all-months placeholder", async () => {
    // Fixture months: Excel serials 46023 (Jan 2026) and 46054 (Feb 2026).
    const label = getLabels().ce_period_range.replace("{from}", formatMonthShortLabel(1, 2026)).replace("{to}", formatMonthShortLabel(2, 2026));
    expect(input.periodLabel).toBe(label);
    const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ");
    for (const [name, html] of [
      ["document", await buildExecutiveReport(input, {})],
      ["deck v2", await buildExecutiveDeckV2(input, {})],
      ["deck v3", await buildExecutiveDeckV3(input, {})],
    ] as const) {
      expect(html, name).toContain(label);
      expect(visible(html), name).not.toContain(COMPREHENSIVE_MONTH_LABEL);
    }
    const wb = await buildExecutiveWorkbookObject(input, {});
    expect(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET_NAMES.kpi], { header: 1 }).flat().map(String)).toContain(label);
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

// Deck v2 and v3 both honour `model.scope === "completed-only"`; the comprehensive page
// opens whichever edition the workspace has chosen.

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

  it.each(fixtures)("document, deck v2 and workbook text carry no figure-bearing population phrase (%s)", async (_n, input) => {
    const html = text(await buildExecutiveReport(input, {}));
    expect(html).not.toMatch(FIGURE);
    const deck = text(await buildExecutiveDeckV2(input, {}));
    expect(deck).not.toMatch(FIGURE);
    const deck3 = text(await buildExecutiveDeckV3(input, {}));
    expect(deck3).not.toMatch(FIGURE);
    const wb = await buildExecutiveWorkbookObject(input, {});
    for (const name of wb.SheetNames) {
      const cells = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 }).flat().map(String);
      for (const c of cells) expect(c, `${name}: ${c}`).not.toMatch(FIGURE);
    }
  });
});
