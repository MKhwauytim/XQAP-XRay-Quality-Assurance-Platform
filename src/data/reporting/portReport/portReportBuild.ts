// The port business report from the raw workbook's figures: model, slides
// (HTML), observations and the data workbook (XLSX). One place for the steps
// the offline script (scripts/export-port-report-static.mjs) and the port
// report tool (src/tools/portReportTool) both run, so the two can never give
// different figures for the same workbook.

import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildPortNameMap } from "../portNameCanonical";
import { portReportInputFromSheets } from "./portReportSource";
import type { PortReportInput, PortReportModel } from "./portReportModel";
import { buildPortReportModel, listReportPorts, STATUS_FALSE_SUSPICION, STATUS_MISSED } from "./portReportModel";
import { buildPortReportHtml } from "./portReportHtml";
import { buildPortObservations } from "./portObservations";
import type { PortObservation } from "./portObservations";
import { buildPortWorkloads, buildWorkloadTiers, LOAD_YEAR, outcomesByYear, outcomesFor, unratedPorts } from "./portWorkloadModel";
import type { LevelOutcomes, WorkloadTierKey } from "./portWorkloadModel";
import { groupTotals, workforceFigures } from "./portWorkloadSlides";
import type { WorkloadSlideInput } from "./portWorkloadSlides";
import type { WorkloadMonth } from "./workloadAggregate";

type Rows = unknown[][];

/** Port names the source spells two ways, mapped to the spelling the report uses. */
const PORT_ALIASES: Record<string, string> = { "الرياض - الميناء الجاف": "ميناء الرياض الجاف" };

export type PortReportOptions = {
  /** The port as it appears in the data (any spelling; it is canonicalised). */
  port: string;
  /** The name printed on the report; defaults to the canonical port name. */
  displayName?: string;
  /** «من 1 يناير 2024 إلى 30 سبتمبر 2026». */
  period: string;
  /** «YYYY-MM»: rows dated after this month are left out. */
  lastMonth?: string;
  /** Whole years left out of the report (population, workload and study rows). */
  excludeYears?: readonly string[];
};

export type PortReportData = {
  /** The study sheet rows («نتائج الدراسة»), header row first. */
  studyRows: Rows;
  /** The year / quarter population sheets, aggregated (workloadAggregate.ts). */
  workloadMonths: readonly WorkloadMonth[];
};

/** Canonical port name lookup over both sources, so «ميناء جده الاسلامي» and «ميناء جدة الإسلامي» are one port. */
function portNameLookup(data: PortReportData, input: PortReportInput): (p: string) => string {
  const nameMap = buildPortNameMap([...data.workloadMonths.map((x) => PORT_ALIASES[x.port] ?? x.port), ...input.studies.map((r) => PORT_ALIASES[r.port] ?? r.port)]);
  return (p) => nameMap.get(PORT_ALIASES[p] ?? p) ?? PORT_ALIASES[p] ?? p;
}

function studyInput(data: PortReportData, period: string): PortReportInput {
  return portReportInputFromSheets({ "نتائج الدراسة": data.studyRows as never }, period);
}

/** The ports the report can be built for, in the report's spelling. */
export function listPortsInData(data: PortReportData): string[] {
  const input = studyInput(data, "");
  const canon = portNameLookup(data, input);
  for (const r of input.studies) r.port = canon(r.port);
  return listReportPorts(input);
}

/** The first and last month present in the population sheets («YYYY-MM»). */
export function monthRange(data: PortReportData): { first: string; last: string } | null {
  const ms = data.workloadMonths.map((m) => m.month).sort();
  return ms.length ? { first: ms[0], last: ms[ms.length - 1] } : null;
}

export type PortReportBuild = {
  model: PortReportModel;
  workload: WorkloadSlideInput;
  html: string;
  observations: PortObservation[];
};

export function buildPortReport(data: PortReportData, opts: PortReportOptions): PortReportBuild {
  const input = studyInput(data, opts.period);
  const canon = portNameLookup(data, input);
  for (const r of input.studies) r.port = canon(r.port);
  const excludeYears = new Set(opts.excludeYears ?? []);
  if (excludeYears.size) input.studies = input.studies.filter((r) => r.year === null || !excludeYears.has(String(r.year)));
  const months = data.workloadMonths
    .filter((x) => (!opts.lastMonth || x.month <= opts.lastMonth) && !excludeYears.has(x.month.slice(0, 4)))
    .map((x) => ({ ...x, port: canon(x.port) }));
  const portWorkloads = buildPortWorkloads(months);
  const tiers = buildWorkloadTiers(portWorkloads);
  const port = canon(opts.port);
  const outcomes = { selected: outcomesFor(input.studies, new Set([port])) } as Record<"selected" | WorkloadTierKey, LevelOutcomes>;
  for (const t of tiers) outcomes[t.key] = outcomesFor(input.studies, new Set(t.ports.map((p) => p.port).filter((p) => p !== port)));
  const workload: WorkloadSlideInput = {
    displayName: opts.displayName ?? port,
    port,
    tiers,
    outcomes,
    yearly: outcomesByYear(input.studies, port, tiers),
    loadYear: LOAD_YEAR,
    periodLabel: opts.period,
    unrated: unratedPorts(portWorkloads),
  } as WorkloadSlideInput;
  // Monthly counts for the selected port: all images received, and the studied images per error.
  const mc = new Map<string, { monthKey: string; images: number | null; missed: number; falseSuspicion: number }>();
  const mcAt = (k: string) => { let v = mc.get(k); if (!v) { v = { monthKey: k, images: null, missed: 0, falseSuspicion: 0 }; mc.set(k, v); } return v; };
  for (const x of months) if (x.port === port) { const v = mcAt(x.month); v.images = (v.images ?? 0) + x.images; }
  for (const r of input.studies) {
    if (r.port !== port || !r.monthKey || (opts.lastMonth && r.monthKey > opts.lastMonth)) continue;
    const v = mcAt(r.monthKey);
    if (r.imageStatus === STATUS_MISSED) v.missed += 1;
    else if (r.imageStatus === STATUS_FALSE_SUSPICION) v.falseSuspicion += 1;
  }
  workload.monthlyCounts = [...mc.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  // Yearly population for the appendix (images only; the source has no reliable suspicion split).
  const groupOf = new Map(input.studies.map((r) => [r.port, r.group]));
  const popRows = new Map<string, { port: string; group: string; year: number; total: number; suspicion: number }>();
  for (const x of months) {
    const k = `${x.port}|${x.month.slice(0, 4)}`;
    const v = popRows.get(k) ?? { port: x.port, group: groupOf.get(x.port) ?? x.type, year: Number(x.month.slice(0, 4)), total: 0, suspicion: 0 };
    v.total += x.images;
    popRows.set(k, v);
  }
  input.population = [...popRows.values()] as PortReportInput["population"];
  if (!listReportPorts(input).includes(port)) throw new Error(`port not in workbook: ${port}`);
  const model = buildPortReportModel(input, port, opts.displayName ? { displayName: opts.displayName } : {});
  return { model, workload, html: buildPortReportHtml(model, workload), observations: buildPortObservations(model, workload) };
}

// ── The data workbook ───────────────────────────────────────────────────────────────────────────

export type SheetSpec = [name: string, head: string[], rows: unknown[][]];

/**
 * The figures behind every report table, one sheet per table, so the report can be checked or
 * re-used in Excel. Percentages are stored as fractions with a % number format.
 */
export function portReportSheets(build: PortReportBuild): SheetSpec[] {
  const { model: m, workload, observations } = build;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
  const round = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v));
  type O = { studied: number; accuracy: number | null; trueSuspicion: number; trueClear: number; missed: number; falseSuspicion: number; matched: number };
  const outcome = (label: string | number, o: O) => [label, o.studied, pct(o.accuracy), o.trueSuspicion, o.trueClear, o.missed, o.falseSuspicion];
  const outcomeHead = ["البند", "المدروسة", "نسبة التوائم", "اشتباه صحيح", "سليمة صحيحة", "الاشتباه الفائت", "الاشتباه الخاطئ"];
  const employee = (e: PortReportModel["employees"][number]) => [e.code, e.name, e.l1Studied, e.l1Matched, e.l2Studied, e.l2Matched, e.studied, e.matched, e.missed, e.falseSuspicion, pct(e.accuracy)];
  const employeeHead = ["الكود", "الموظف", "مدروسة - المستوى الأول", "متوافقة - المستوى الأول", "مدروسة - المستوى الثاني", "متوافقة - المستوى الثاني", "إجمالي المدروسة", "إجمالي المتوافقة", "الاشتباه الفائت", "الاشتباه الخاطئ", "نسبة التوائم"];
  const tierOf = (port: string) => workload.tiers.find((t) => t.ports.some((x) => x.port === port))?.label ?? "";
  const allPorts = workload.tiers.flatMap((t) => t.ports);
  const outcomeRow = (label: string, o: LevelOutcomes) => [label, o.image.studied, pct(o.image.accuracy), pct(o.l1.accuracy), pct(o.l2.accuracy), pct(o.image.studied ? o.image.missed / o.image.studied : null), pct(o.image.studied ? o.image.falseSuspicion / o.image.studied : null)];
  const wlSheets: SheetSpec[] = [
    ["العبء التشغيلي للمنافذ", ["مستوى العبء", "المنفذ", "نوع المنفذ", "الصور الواردة", "صور/شهر", "نسبة الصور عليها كود", "الموظفون (أشخاص)", "الموظفون المكافئون/شهر", "صور/شهر للموظف", "موظفو الأول (متوسط/شهر)", "صور/شهر للموظف - الأول", "موظفو الثاني (متوسط/شهر)", "صور/شهر للموظف - الثاني"],
      [...allPorts, ...(workload.unrated ?? [])].map((p) => [tierOf(p.port) || "بلا بيانات", p.port, p.type, p.images, round(p.imagesPerMonth), pct(p.codedShare), p.employees, round(p.employeesPerMonth), round(p.perEmployeeMonth), round(p.l1Employees), round(p.l1PerMonth), round(p.l2Employees), round(p.l2PerMonth)])],
    ["حدود مستويات العبء", ["المستوى", "من (صور للموظف في الشهر)", "إلى (صور للموظف في الشهر)", "عدد المنافذ"], workload.tiers.map((t) => [t.label, round(t.from), round(t.to), t.ports.length])],
    ["العبء حسب السنة", ["المنفذ", "السنة", "الصور الواردة", "متوسط الصور في الشهر", "نسبة الصور عليها كود", "الموظفون", "متوسط الموظفين في الشهر", "صور/شهر للموظف", "صور/شهر للموظف - الأول", "صور/شهر للموظف - الثاني"],
      allPorts.flatMap((p) => p.years.map((y) => [p.port, y.year, y.images, round(y.images / Math.max(1, y.months)), pct(y.codedShare), y.employees, round(y.employeesPerMonth), round(y.perEmployeeMonth), round(y.l1PerMonth), round(y.l2PerMonth)]))],
    ["الأداء حسب مستوى العبء", ["النطاق", "المدروسة", "نسبة التوائم", "توائم الأول", "توائم الثاني", "الاشتباه الفائت", "الاشتباه الخاطئ"],
      [...workload.tiers.map((t) => outcomeRow(`المستوى ${t.label} (دون ${workload.displayName})`, workload.outcomes[t.key])), outcomeRow(workload.displayName, workload.outcomes.selected)]],
  ];
  const sheets: SheetSpec[] = [
    ...wlSheets,
    ["مجتمع الحالات الواردة", ["نوع المنفذ", "المنفذ", "إجمالي الصور"], m.ports.filter((p) => p.population > 0).map((p) => [p.group, p.label, p.population])],
    ["الحالات المدروسة حسب السنة", ["السنة", "المجتمع", "نسبة العينة", ...outcomeHead.slice(1)], [...m.years.map((y) => [y.year, y.population, y.population ? y.studied / y.population : null, ...outcome(y.year, y.image).slice(1)]), ["الإجمالي", m.selected.population, m.selected.population ? m.selected.image.studied / m.selected.population : null, ...outcome("", m.selected.image).slice(1)]]],
    ["نتائج الدراسة حسب نوع المنفذ", ["نوع المنفذ", ...outcomeHead.slice(1)], [...m.groups.map((g) => outcome(g.label, g.image)), outcome("جميع المنافذ", m.allPorts.image)]],
    ["نسبة التوائم حسب المنفذ", ["المنفذ", "نوع المنفذ", "المدروسة", "نسبة التوائم"], m.ports.filter((p) => p.image.studied > 0).map((p) => [p.label, p.group, p.image.studied, pct(p.image.accuracy)])],
    ["المستوى الأول والثاني", ["النطاق", "المستوى", ...outcomeHead.slice(1)],
      ([[m.displayName, m.selected], ["جميع المنافذ", m.allPorts]] as const).flatMap(([n, sc]) => [[n, ...outcome("المستوى الأول", sc.l1)], [n, ...outcome("المستوى الثاني", sc.l2)]])],
    ["مستويات دقة الموظفين", ["الفئة", "تبدأ من", "تنتهي عند", "عدد الموظفين", "متوسط الدقة", "متوسط الحالات لكل موظف"],
      m.distribution.tiers.map((t) => [t.label, t.from, t.to, t.count, pct(t.meanAccuracy), t.meanStudied === null ? null : Math.round(t.meanStudied)])],
    ["منسوبي المنفذ (30 فأكثر)", employeeHead, m.employees.filter((e) => e.studied >= 30).map(employee)],
    ["ملحق - أقل من 30 حالة", employeeHead, m.employees.filter((e) => e.studied < 30).map(employee)],
  ];
  const share = (n: number, o: O) => (o.studied ? n / o.studied : null);
  const sc = (label: string, o: O) => [label, o.studied, o.trueSuspicion, o.trueClear, o.missed, o.falseSuspicion, o.matched, pct(o.accuracy), share(o.trueSuspicion, o), share(o.trueClear, o), share(o.missed, o), share(o.falseSuspicion, o)];
  const scHead = ["المدروسة", "اشتباه صحيح", "سليمة صحيحة", "الاشتباه الفائت", "الاشتباه الخاطئ", "المتوافقة", "نسبة التوائم", "نسبة اشتباه صحيح", "نسبة سليمة صحيحة", "نسبة الاشتباه الفائت", "نسبة الاشتباه الخاطئ"];
  const tierLabel = (t: WorkloadSlideInput["tiers"][number]) => `المستوى ${t.label} (دون ${workload.displayName})`;
  const scopes = [...workload.tiers.map((t) => [tierLabel(t), workload.outcomes[t.key]] as const), [workload.displayName, workload.outcomes.selected] as const];
  const totals = workload.tiers.map((t) => ({ label: `المستوى ${t.label}`, ...groupTotals(t.ports) }));
  const types = Object.keys(workload.tiers[0]?.averages ?? {});
  sheets.unshift(
    ["الملاحظات والتوصيات", ["#", "الأولوية", "الملاحظة الرئيسية", "الشواهد الجوهرية", "التوصية", "مصدر الأرقام (صفحة التقرير / ورقة)"], observations.map((o, i) => [i + 1, o.priority, o.title, o.evidence.join("\n"), o.recommendations.map((r, j) => `${j + 1}. ${r}`).join("\n"), o.source])],
    ["شواهد الملاحظات", ["#", "الملاحظة الرئيسية", "الشاهد"], observations.flatMap((o, i) => o.evidence.map((e) => [i + 1, o.title, e]))],
  );
  sheets.splice(2 + wlSheets.length, 0,
    ["إجماليات مستويات العبء", ["المستوى", "إجمالي الصور", "متوسط الصور في الشهر", "إجمالي الموظفين المخصصين", "متوسط الموظفين في الشهر"], totals.map((t) => [t.label, t.images, round(t.imagesPerMonth), t.people, round(t.staffPerMonth)])],
    ["القوى العاملة حسب المستوى", ["النطاق", "متوسط الصور في الشهر", "متوسط عدد الموظفين في الشهر", "متوسط عدد الحالات المفحوصة للموظف الواحد", "متوسط الحالات للموظف في الشهر - المستوى الأول", "متوسط الحالات للموظف في الشهر - المستوى الثاني"], workforceFigures(workload).map((r) => [r.label, round(r.imagesPerMonth), round(r.staffPerMonth), round(r.perEmployeeMonth), round(r.l1PerMonth), round(r.l2PerMonth)])],
    ["متوسط العبء حسب نوع المنفذ", ["نوع المنفذ", "متوسط الحالات المفحوصة في الشهر للموظف", "المنخفض أقل من", "العالي أكثر من"], types.map((ty) => [ty, round(workload.tiers[0].averages[ty]), round(workload.tiers[0].ranges[ty][1]), round(workload.tiers[2]?.ranges[ty][0])])],
    ["المستويان حسب مستوى العبء", ["النطاق", "المستوى", ...scHead], scopes.flatMap(([n, o]) => [[n, ...sc("المستوى الأول", o.l1)], [n, ...sc("المستوى الثاني", o.l2)]])],
    ["الأداء حسب السنة", ["السنة", "النطاق", "المستوى", ...scHead],
      workload.yearly.flatMap((y) => ([[workload.displayName, y.selected], ...workload.tiers.map((t) => [tierLabel(t), y.tiers[t.key]])] as Array<[string, LevelOutcomes | undefined]>)
        .filter((e): e is [string, LevelOutcomes] => !!e[1] && e[1].image.studied > 0)
        .flatMap(([n, o]) => ([["العامة", o.image], ["المستوى الأول", o.l1], ["المستوى الثاني", o.l2]] as const).map(([lv, x]) => [y.year, n, ...sc(lv, x)])))],
  );
  sheets.push(
    ["الخط الزمني الشهري", ["الشهر", `نسبة التوائم - ${m.displayName}`, `المدروسة - ${m.displayName}`, "نسبة التوائم - جميع المنافذ", ...m.groups.filter((g) => g.label !== m.group).map((g) => `نسبة التوائم - ${g.label}`)],
      m.monthly.filter((x) => x.selected !== null || x.all !== null).map((x) => [x.monthKey, pct(x.selected), x.selectedStudied, pct(x.all), ...m.groups.filter((g) => g.label !== m.group).map((g) => pct(x.byGroup[g.label] ?? null))])],
    ["المستويان حسب نوع المنفذ", ["نوع المنفذ", "إجابات المستوى الأول", "نسبة التوائم - الأول", "إجابات المستوى الثاني", "نسبة التوائم - الثاني"], m.groups.map((g) => [g.label, g.l1.studied, pct(g.l1.accuracy), g.l2.studied, pct(g.l2.accuracy)])],
    ["ملخص دقة الموظفين", ["البند", "القيمة"], [["متوسط نسبة التوائم للموظفين", m.distribution.mean], ["الوسيط", m.distribution.median], ["الموظفون المدروسة حالاتهم", m.employees.length], ["المصنفون (30 حالة فأكثر)", m.distribution.tiered], ["المستبعدون (أقل من 30 حالة)", m.distribution.untiered]]],
    ["توزيع دقة الموظفين", ["الفئة", "تبدأ من", "تنتهي عند", "عدد الموظفين"], m.distribution.bins.map((b) => [m.distribution.tiers.find((t) => t.key === b.tier)?.label ?? b.tier, b.from, b.to, b.count])],
  );
  // Index first: every sheet.
  sheets.unshift(["الفهرس", ["#", "الورقة", "الصفوف"], sheets.map(([name, , rows], i) => [i + 1, name.slice(0, 31), rows.length])]);
  return sheets;
}

/** The sheets as an .xlsx file, right-to-left, with rate columns as percentages and Somar as the cell font. */
export async function portReportWorkbookBytes(sheets: readonly SheetSpec[]): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new();
  for (const [name, head, rows] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    head.forEach((h, c) => {
      if (!/نسبة|الدقة|تبدأ|تنتهي/.test(h)) return;
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = "0.0%";
      }
    });
    ws["!cols"] = head.map((h) => ({ wch: Math.max(12, h.length + 4) }));
    if (name === "ملخص دقة الموظفين") for (let r = 1; r <= 2; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (c) c.z = "0.0%"; }
    if (name === "الفهرس") for (let r = 1; r <= rows.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; if (c) c.l = { Target: `#'${String(c.v)}'!A1` }; }
    if (/الملاحظات/.test(name)) ws["!cols"] = head.map((h, c) => ({ wch: c === 0 ? 5 : /الملاحظة|التوصية|الشواهد|الشاهد/.test(h) ? 70 : 24 }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  wb.Workbook = { Views: [{ RTL: true }] };
  // Somar for every cell: SheetJS writes Calibri as the default font in styles.xml.
  const zip = await JSZip.loadAsync(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  const stylesFile = zip.file("xl/styles.xml");
  if (stylesFile) {
    const styles = (await stylesFile.async("string")).replace(/<name val="[^"]*"\/>/g, '<name val="Somar"/>').replace(/<family val="[^"]*"\/>/g, "").replace(/<scheme val="[^"]*"\/>/g, "");
    zip.file("xl/styles.xml", styles);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
