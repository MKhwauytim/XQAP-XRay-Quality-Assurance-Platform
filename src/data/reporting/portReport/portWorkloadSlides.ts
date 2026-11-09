// The four main slides of the port business report, in the deck3 kit:
// (1) the impact of workload — ports in three workload tiers, (2) the workforce
// distribution per tier, (3) level 1 and level 2 results per tier, and (4) the
// selected port against the other ports, year by year.
//
// Tier figures on slides 2–3 leave the selected port out, so it is compared
// with the other ports of each tier rather than with itself.

import { chartTitleRow, contentHead, dataTable, legendRow, slideShell, tintedPanel } from "../executive/deck3/slideKit";
import type { LegendItem, SlideMeta, TableCell } from "../executive/deck3/slideKit";
import { groupedBarChart } from "../executive/deck3/chartKit";
import { yearBlocksChart } from "./portYearChart";
import type { ChartTone } from "../executive/deck3/chartKit";
import { esc, fmtNum } from "../executive/primitives";
import type { OutcomeStats } from "./portReportModel";
import type { LevelOutcomes, PortWorkload, WorkloadTier, WorkloadTierKey } from "./portWorkloadModel";
import { POOL_SHARE } from "./portWorkloadModel";

export type WorkloadSlideInput = {
  displayName: string;
  /** Canonical name of the selected port inside `tiers`. */
  port: string;
  tiers: WorkloadTier[];
  /** Study outcomes per tier (selected port excluded) and for the selected port. */
  outcomes: Record<WorkloadTierKey | "selected", LevelOutcomes>;
  /** Study outcomes per year: the selected port and each workload tier (selected port excluded). */
  yearly: Array<{ year: number; selected: LevelOutcomes; tiers: Partial<Record<WorkloadTierKey, LevelOutcomes>> }>;
  /** The year the workload (examinations and staff) is measured on. */
  loadYear: string;
  periodLabel: string;
  /** Ports with no employee data, left out of the tiers. */
  unrated: PortWorkload[];
  /** The same ports tiered by images received per month instead of the workload per employee (thirds). */
  imageTiers?: WorkloadTier[];
  /** Ports grouped by نسبة التوائم (thirds, selected port excluded), for the level-results slide. */
  accuracyGroups?: Array<{ key: WorkloadTierKey; label: string; ports: string[]; from: number | null; to: number | null; outcomes: LevelOutcomes }>;
  /** Per month for the selected port: images received (all shipments), and the studied images that were a missed or a false suspicion. */
  monthlyCounts?: Array<{ monthKey: string; images: number | null; missed: number; falseSuspicion: number }>;
};

const SEC = "تأثير عبء العمل على النتائج";
/** Page eyebrows: w1/w2 open القسم الأول, w3 closes القسم الثاني, and the year comparison (w5) is in ملحق ب. */
const EYEBROW = { w1: "القسم الأول - أثر العبء التشغيلي على المنفذ", w2: "القسم الأول - أثر العبء التشغيلي على المنفذ", w3: "القسم الثاني - نتائج الدراسة", w5: "ملحق ب - نتائج الدراسة" } as const;
const TONE: Record<WorkloadTierKey, ChartTone> = { low: "green", mid: "gold", high: "red" };
const pct = (v: number | null, d = 1) => (v === null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null) => (v === null ? "—" : fmtNum(Math.round(v)));
const RULE = "border-inline-start:3px solid var(--v3-navy);padding-inline-start:28px;";
const typeShort = (t: string) => t.replace("منفذ ", "");

// Shared labels, so every slide names the same figure the same way.
const L = {
  images: "إجمالي الصور",
  imagesMonth: "متوسط الصور في الشهر",
  staff: "إجمالي الموظفين المخصصين",
  staffMonth: "متوسط عدد الموظفين في الشهر",
  examsMonth: "متوسط عدد الحالات المفحوصة للموظف الواحد",
  l1Month: "متوسط الحالات للموظف في الشهر - المستوى الأول",
  l2Month: "متوسط الحالات للموظف في الشهر - المستوى الثاني",
};

const meanOf = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * A group of ports summed: images, distinct people, the sum of their monthly
 * staff, and the examinations per employee weighted by each port's monthly
 * staff (= the group's examinations ÷ its staff), overall and for each level.
 */
export function groupTotals(ps: readonly PortWorkload[]) {
  const sum = (g: (p: PortWorkload) => number | null) => ps.reduce((a, p) => a + (g(p) ?? 0), 0);
  const people = new Set<string>();
  ps.forEach((p) => (p.peopleCodes ?? []).forEach((c) => people.add(c)));
  const staff = sum((p) => (p.perEmployeeMonth === null ? null : p.employeesPerMonth));
  const weighted = (g: (p: PortWorkload) => number | null) => (staff > 0 ? sum((p) => (g(p) ?? 0) * (p.employeesPerMonth ?? 0)) / staff : null);
  const levelWeighted = (g: (p: PortWorkload) => number | null, w: (p: PortWorkload) => number | null) => {
    const ws = sum((p) => (g(p) === null ? null : w(p)));
    return ws > 0 ? sum((p) => (g(p) ?? 0) * (w(p) ?? 0)) / ws : null;
  };
  const pooled = (k: "all" | "l1" | "l2") => {
    const ps2 = ps.filter((p) => p.pool && p.perEmployeeMonth !== null);
    const eq = ps2.reduce((a, p) => a + (p.pool?.[k].eq ?? 0), 0);
    return ps2.length && eq > 0 ? ps2.reduce((a, p) => a + (p.pool?.[k].n ?? 0), 0) / eq : null;
  };
  return {
    images: sum((p) => p.images),
    imagesPerMonth: sum((p) => p.imagesPerMonth),
    people: people.size,
    staffPerMonth: sum((p) => p.employeesPerMonth),
    // The group's examinations ÷ its equivalent employees, for all and per level, so the overall
    // figure always sits with its two levels.
    perEmployeeMonth: pooled("all") ?? weighted((p) => p.perEmployeeMonth),
    l1PerMonth: pooled("l1") ?? levelWeighted((p) => p.l1PerMonth, (p) => p.l1Employees),
    l2PerMonth: pooled("l2") ?? levelWeighted((p) => p.l2PerMonth, (p) => p.l2Employees),
  };
}

/**
 * The workforce table of the second main slide as numbers: each tier (selected port left out) with the
 * mean images per month (load year) and mean staff per month of its ports, and its examinations per
 * employee per month (overall and per level) weighted by staff; the selected port is inserted after its own tier.
 */
export function workforceFigures(w: WorkloadSlideInput, tiers: readonly WorkloadTier[] = w.tiers): Array<{ label: string; key?: WorkloadTierKey; selected: boolean; imagesPerMonth: number | null; staffPerMonth: number | null; perEmployeeMonth: number | null; l1PerMonth: number | null; l2PerMonth: number | null }> {
  // The same figures, defined the same way, as the tier pages (tierFigures): every port of the tier,
  // the selected one included, then the selected port on its own after its tier.
  const rows: ReturnType<typeof workforceFigures> = tiers.map((t) => ({ label: `المستوى ${t.label}`, key: t.key, selected: false, ...tierFigures(t.ports) }));
  const selTier = tiers.findIndex((t) => t.ports.some((p) => p.port === w.port));
  const sel = tiers.flatMap((t) => t.ports).find((p) => p.port === w.port);
  if (sel) rows.splice(selTier + 1, 0, { label: w.displayName, selected: true, imagesPerMonth: sel.imagesPerMonth, staffPerMonth: sel.employeesPerMonth, perEmployeeMonth: sel.perEmployeeMonth, l1PerMonth: sel.l1PerMonth, l2PerMonth: sel.l2PerMonth });
  return rows;
}

/** A tier's figures as both the tier page and the workforce page show them: means per port, and cases per employee as Σ examinations ÷ Σ equivalent employees. */
export function tierFigures(ps: readonly PortWorkload[]) {
  const g = groupTotals(ps);
  return { images: g.images, imagesPerMonth: meanOf(ps.map((p) => p.imagesPerMonth)), people: g.people, staffPerMonth: meanOf(ps.map((p) => p.employeesPerMonth)), perEmployeeMonth: g.perEmployeeMonth, l1PerMonth: g.l1PerMonth, l2PerMonth: g.l2PerMonth };
}

/** Appendix page: every port's workload figures in one table, grouped by tier. */
export function workloadAppendixSlide(w: WorkloadSlideInput, meta: (key: string, label: string) => SlideMeta): string {
  const unratedRows: TableCell[][] = w.unrated.map((p) => [{ html: "بلا بيانات", cls: "v-muted" }, { html: esc(typeShort(p.type)), cls: "v-muted" }, { html: esc(p.port) }, { html: "—", cls: "v-muted" }, { html: fmtNum(p.images), cls: "v-navy" }, { html: num(p.imagesPerMonth), cls: "v-navy" }, { html: "—", cls: "v-muted" }, { html: "—", cls: "v-muted" }]);
  const rows: TableCell[][] = w.tiers.flatMap((t) =>
    t.ports.map((p) => {
      const hl = p.port === w.port;
      const c = (html: string, cls = "v-navy"): TableCell => ({ html: hl ? `<b>${html}</b>` : html, cls: hl ? "v-gold" : cls });
      return [c(esc(t.label), `v-${TONE[t.key]}`), c(esc(typeShort(p.type)), "v-muted"), c(esc(hl ? w.displayName : p.port), ""), c(num(p.perEmployeeMonth)), c(fmtNum(p.images)), c(num(p.imagesPerMonth)), c(num(p.employees)), c(num(p.employeesPerMonth))];
    }),
  ).concat(unratedRows);
  return slideShell(
    meta("appendix", "الملاحق"),
    "",
    `${contentHead({ eyebrow: "الملاحق", title: "العبء التشغيلي لكل المنافذ", note: "مرتبة حسب مستوى العبء" })}
${dataTable({ headers: ["مستوى العبء", "نوع المنفذ", "المنفذ", L.examsMonth, L.images, L.imagesMonth, L.staff, L.staffMonth], rows, compactHeaders: true, rowPx: 28, firstColWidth: 14 }).replace('<table class="v3-table', '<table class="pr-pop pr-dense pr-wrap pr-apx v3-table').replace("<thead>", '<colgroup><col style="width:9%"/><col style="width:8%"/><col style="width:23%"/><col/><col/><col/><col/><col/></colgroup><thead>')}`,
  );
}

export function workloadSlides(w: WorkloadSlideInput, meta: (key: string, label: string) => SlideMeta): string[] {
  const parts: string[] = [];
  const sel = w.tiers.flatMap((t) => t.ports).find((p) => p.port === w.port);
  if (!sel) return parts;
  const tierName = (t: WorkloadTier) => `المستوى ${t.label}`;

  // 1 — Workload tiers: each tier's totals, then its ports. 1b — the same page on the images-per-month tiers.
  const tierPage = (tiers: WorkloadTier[], key: string, title: string, basis: string, note: string, prefix: string, unit: string) => {
    const stat = (label: string, value: string) =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--v3-hair)"><div style="font-size:18px;color:var(--v3-muted);white-space:nowrap">${esc(label)}</div><div style="font-size:36px;font-weight:700;color:var(--v3-navy);line-height:1.15">${esc(value)}</div></div>`;
    const padRows = Math.max(...tiers.map((x) => x.ports.length));
    const cols = tiers
      .map((t, i) => {
        const rows: TableCell[][] = t.ports.map((p) => {
          const hl = p.port === w.port;
          const cell = (html: string, cls = "v-navy"): TableCell => ({ html: hl ? `<b>${html}</b>` : html, cls: hl ? "v-gold" : cls });
          return [cell(esc(typeShort(p.type)), "v-muted"), cell(esc(hl ? w.displayName : p.port), ""), cell(fmtNum(p.images)), cell(num(p.imagesPerMonth)), cell(num(p.employeesPerMonth)), cell(num(p.perEmployeeMonth))];
        });
        const a = tierFigures(t.ports);
        return `<div style="display:flex;flex-direction:column;min-width:0;${i > 0 ? RULE : ""}">
  ${chartTitleRow({ title: `${prefix} ${t.label}` })}
  <div style="margin:-6px 0 8px;font-size:17px;color:var(--v3-muted);white-space:nowrap">من ${num(t.from)} إلى ${num(t.to)} ${unit}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;column-gap:24px;border-top:4px solid var(--v3-${TONE[t.key]});margin-bottom:14px">
    ${stat(L.images, num(a.images))}${stat("متوسط الصور في الشهر للمنفذ", num(a.imagesPerMonth))}${stat(L.staff, num(a.people))}${stat("متوسط الموظفين في الشهر للمنفذ", num(a.staffPerMonth))}
  </div>
  ${dataTable({ headers: ["النوع", "المنفذ", "إجمالي الصور", "الصور شهرياً", "الموظفون شهرياً", "حالات الموظف شهرياً"], rows, firstColWidth: 14, compactHeaders: true, rowPx: 40, padToRows: padRows }).replace('<table class="v3-table', '<table class="pr-pop pr-dense pr-tier v3-table').replace("<thead>", '<colgroup><col style="width:7%"/><col style="width:30%"/><col style="width:19%"/><col style="width:15%"/><col style="width:14%"/><col style="width:15%"/></colgroup><thead>')}
</div>`;
      })
      .join("");
    parts.push(
      slideShell(
        meta(key, SEC),
        "",
        `${contentHead({ eyebrow: EYEBROW.w1, title })}
<p style="margin:-14px 0 14px;font-size:24px;font-weight:700;color:var(--v3-muted)">(${esc(basis)})</p>
<div class="v3-two-col" style="grid-template-columns:repeat(3,1fr);gap:22px">${cols}</div>
<p class="v3-note" style="margin-top:10px;font-size:19px">${note}</p>`,
      ),
    );
  };
  const staffNote = `الموظفون: كل من فحص حالة واحدة على الأقل في المنفذ، ومتوسطهم عددهم في كل شهر. متوسط حالات الموظف: الموظفون الذين فحصوا أقل من ${Math.round(POOL_SHARE * 100)}% من متوسط الشهر تُجمع حالاتهم وتُحسب موظفين مكافئين. الصور من كامل الفترة، والموظفون والعبء من سنة ${esc(w.loadYear)}.`;
  tierPage(w.tiers, "w1", "تأثير عبء التشغيل على نتائج العمل", "بناءً على متوسط فحص الموظف في الشهر", `<b>العبء التشغيلي:</b> ${L.examsMonth} في المنفذ في الشهر. المنافذ البرية والبحرية معاً مرتبة حسبه ومقسومة ثلاثة أثلاث متساوية العدد: منخفض ومتوسط وعالي. ${staffNote}`, "عبء", "حالة للموظف في الشهر");
  if (w.imageTiers?.length) tierPage(w.imageTiers, "w1b", "تأثير عبء التشغيل على نتائج العمل", "بناءً على عدد الصور في المنافذ", `<b>حجم الصور:</b> ${L.imagesMonth} في المنفذ. المنافذ البرية والبحرية معاً مرتبة حسبه ومقسومة ثلاثة أثلاث متساوية العدد: منخفض ومتوسط وعالي. ${staffNote}`, "حجم", "صورة في الشهر");

  // 2 — Workforce distribution: images, staff and each employee's output per tier.
  const workforcePage = (tiers: WorkloadTier[], key: string, basis: string) => {
    // Same figures as the tier pages and the workbook's sheet (workforceFigures), so they cannot drift.
    const rowsT: TableCell[][] = workforceFigures(w, tiers).map((r) => {
      const b = (h: string) => (r.selected ? `<b>${h}</b>` : h);
      const cls = (c: string) => (r.selected ? "v-gold" : c);
      return [
        { html: b(esc(r.label)) },
        { html: b(num(r.imagesPerMonth)), cls: cls("v-navy") },
        { html: b(num(r.staffPerMonth)), cls: cls("v-navy") },
        { html: b(num(r.perEmployeeMonth)), cls: cls("v-navy") },
        { html: b(num(r.l1PerMonth)), cls: cls(r.key ? `v-${TONE[r.key]}` : "v-navy") },
        { html: b(num(r.l2PerMonth)), cls: cls(r.key ? `v-${TONE[r.key]}` : "v-navy") },
      ];
    });
    const rowsY: TableCell[][] = sel.years.map((y) => [
      { html: String(y.year) },
      { html: fmtNum(y.images), cls: "v-navy" },
      { html: num(y.images / Math.max(1, y.months)), cls: "v-navy" },
      { html: num(y.employees), cls: "v-navy" },
      { html: num(y.employeesPerMonth), cls: "v-navy" },
      { html: num(y.perEmployeeMonth), cls: "v-navy" },
      { html: num(y.l1PerMonth), cls: "v-gold" },
      { html: num(y.l2PerMonth), cls: "v-blue" },
    ]);
    // Level 1 against level 2 for each tier (selected port left out) and the port itself, on the
    // same tier split as the rest of the page.
    const levelGroups = [
      ...tiers.map((t) => { const g = tierFigures(t.ports); return { label: tierName(t), a: { label: "المستوى الأول", value: g.l1PerMonth }, b: { label: "المستوى الثاني", value: g.l2PerMonth } }; }),
      { label: w.displayName, a: { label: "المستوى الأول", value: sel.l1PerMonth }, b: { label: "المستوى الثاني", value: sel.l2PerMonth } },
    ];
    const maxV = Math.max(1, ...levelGroups.flatMap((g) => [g.a.value ?? 0, g.b.value ?? 0]));
    parts.push(
      slideShell(
        meta(key, SEC),
        "",
        `${contentHead({ eyebrow: EYEBROW.w2, title: "أثر توزيع القوى العاملة على الفحص بالأشعة" })}
<p style="margin:-14px 0 14px;font-size:24px;font-weight:700;color:var(--v3-muted)">(${esc(basis)})</p>
${dataTable({ headers: ["النطاق", L.imagesMonth, L.staffMonth, L.examsMonth, L.l1Month, L.l2Month], rows: rowsT, compactHeaders: true, rowPx: 50, firstColWidth: 26 })}
<div class="v3-two-col" style="grid-template-columns:1.2fr .8fr;gap:40px;margin-top:20px">
  ${tintedPanel({ variant: "all", title: `${w.displayName} حسب السنة`, body: dataTable({ headers: ["السنة", L.images, L.imagesMonth, L.staff, L.staffMonth, L.examsMonth, "المستوى الأول", "المستوى الثاني"], rows: rowsY, compactHeaders: true, rowPx: 44, firstColWidth: 14 }) })}
  <div class="v3-chart-col">${chartTitleRow({ title: "متوسط الحالات للموظف في الشهر حسب المستوى" })}${groupedBarChart({ groups: levelGroups, min: 0, max: maxV * 1.25, plotHeight: 230, barMaxWidth: 46, toneA: "gold", toneB: "blue", valueFormat: (v) => fmtNum(Math.round(v)) })}${legendRow([{ swatch: "gold", text: "المستوى الأول" }, { swatch: "blue", text: "المستوى الثاني" }])}</div>
</div>
`,
      ),
    );
  };
  workforcePage(w.tiers, "w2", "بناءً على متوسط فحص الموظف في الشهر");
  if (w.imageTiers?.length) workforcePage(w.imageTiers, "w2b", "بناءً على عدد الصور في المنافذ");

  // 3 — Level 1 and level 2 results by workload tier
  {
    // Each count with its share of that level's studied answers, small and grey beside it.
    const withShare = (n: number, of: number) => `${fmtNum(n)}<br><span class="v3-sub" style="font-size:15px;color:var(--v3-muted)">(${pct(of ? n / of : null)})</span>`;
    const levelTable = (o: { l1: OutcomeStats; l2: OutcomeStats }) =>
      dataTable({
        headers: ["البند", "المستوى الأول", "المستوى الثاني"],
        rows: [
          [{ html: "المدروسة" }, { html: fmtNum(o.l1.studied), cls: "v-navy" }, { html: fmtNum(o.l2.studied), cls: "v-navy" }],
          [{ html: "الاشتباه الفائت" }, { html: withShare(o.l1.missed, o.l1.studied), cls: "v-red" }, { html: withShare(o.l2.missed, o.l2.studied), cls: "v-red" }],
          [{ html: "الاشتباه الخاطئ" }, { html: withShare(o.l1.falseSuspicion, o.l1.studied), cls: "v-gold" }, { html: withShare(o.l2.falseSuspicion, o.l2.studied), cls: "v-gold" }],
        ],
        totals: [{ html: "نسبة التوائم" }, { html: pct(o.l1.accuracy), cls: "v-navy" }, { html: pct(o.l2.accuracy), cls: "v-navy" }],
        firstColWidth: 36,
        compactHeaders: true,
        rowPx: 72,
      }).replace('<table class="v3-table', '<table class="pr-lv v3-table').replace("<thead>", '<colgroup><col style="width:40%"/><col/><col/></colgroup><thead>');
    // Ports grouped by their own نسبة التوائم (thirds), compared with the selected port.
    const groups = w.accuracyGroups ?? [];
    const panels = [
      ...groups.map((g) => ({ title: `دقة ${g.label}`, note: `${pct(g.from, 0)} - ${pct(g.to, 0)}` as string | undefined, o: g.outcomes, variant: "all" as const })),
      { title: w.displayName, note: pct(w.outcomes.selected.image.accuracy, 0) as string | undefined, o: w.outcomes.selected, variant: "land" as const },
    ];
    parts.push(
      slideShell(
        meta("w3", SEC),
        "",
        `${contentHead({ eyebrow: EYEBROW.w3, title: "المستوى الأول والثاني حسب مستوى الدقة", note: "المنافذ مقسومة أثلاثاً حسب نسبة التوائم" })}
<div class="v3-two-col pr-eq" style="grid-template-columns:repeat(4,1fr);gap:22px;align-items:stretch">${panels.map((p) => tintedPanel({ variant: p.variant, title: p.title, note: p.note, body: levelTable(p.o) })).join("")}</div>`,
      ),
    );
  }

  // 4 — The selected port against each workload tier, by year. With only two study years
  // (e.g. --exclude-years=2024) slide 5 below shows the same years with more measures, so this one is left out.
  const studyYears = w.yearly.filter((y) => y.selected.image.studied > 0).length;
  if (studyYears > 2) {
    const p100 = (v: number | null) => (v === null ? null : v * 100);
    const scopes = (y: (typeof w.yearly)[number]) => [
      { label: w.displayName, short: "جدة", o: y.selected, tone: "blue" as ChartTone, sel: true },
      ...w.tiers.map((t) => ({ label: `عبء ${t.label}`, short: t.label, o: y.tiers[t.key], tone: TONE[t.key], sel: false })),
    ].filter((s): s is { label: string; short: string; o: LevelOutcomes; tone: ChartTone; sel: boolean } => !!s.o && s.o.image.studied > 0);
    const ys = w.yearly.filter((y) => scopes(y).length > 0);
    // Chart review: one block per year, divided by a black line, on a zero-based axis (it started at 50%,
    // which made a 72% bar look a third of a 96% one); the year sits under its own bars and the legend under the years.
    const chart = yearBlocksChart(
      ys.map((y) => ({ year: String(y.year), groups: [{ label: "", bars: seriesOf(w).map((s) => ({ value: p100(s.pick(y)?.image.accuracy ?? null), tone: s.tone })) }] })),
      { min: 0, max: PCT_MAX, plotHeight: 470, barWidth: 30, legend: legendOf(w) },
    );
    // Matched count with its rate underneath.
    const rate = (o: OutcomeStats, strong: boolean) => { const v = `${fmtNum(o.matched)}<br><span class="v3-sub" style="font-size:15px">(${pct(o.accuracy)})</span>`; return strong ? `<b>${v}</b>` : v; };
    const rows: TableCell[][] = ys.flatMap((y) =>
      scopes(y).map((s, i) => {
        const b = (h: string) => (s.sel ? `<b>${h}</b>` : h);
        return [
          { html: i === 0 ? `<b>${y.year}</b>` : "" },
          { html: b(esc(s.label)), cls: s.sel ? "v-gold" : `v-${s.tone}` },
          { html: b(fmtNum(s.o.image.studied)), cls: "v-navy" },
          { html: rate(s.o.image, s.sel), cls: s.sel ? "v-gold" : "v-navy" },
          { html: rate(s.o.l1, s.sel), cls: "v-navy" },
          { html: rate(s.o.l2, s.sel), cls: "v-navy" },
        ];
      }),
    );
    parts.push(
      slideShell(
        meta("w4", SEC),
        "",
        `${contentHead({ eyebrow: SEC, title: `أداء ${w.displayName} مقارنة بمستويات العبء` })}
<div class="v3-two-col" style="grid-template-columns:1fr 1fr;gap:36px">
  <div class="v3-chart-col">${chartTitleRow({ title: "نسبة التوائم العامة" })}${chart}</div>
  <div style="${RULE}">${dataTable({ headers: ["السنة", "النطاق", "المدروسة", "نسبة التوائم العامة", "نسبة التوائم - المستوى الأول", "نسبة التوائم - المستوى الثاني"], rows, groupStart: 3, compactHeaders: true, rowPx: 50, firstColWidth: 14 }).replace('<table class="v3-table', '<table class="pr-pop v3-table').replace("<thead>", '<colgroup><col style="width:9%"/><col style="width:27%"/><col style="width:13%"/><col/><col/><col/></colgroup><thead>')}</div>
</div>
`,
      ),
    );
  }

  // 5 — The last two study years side by side (2025 and 2026 in this data): overall, level 1 and
  // level 2 نسبة التوائم for the port and each workload tier, with every rate's count in the table.
  {
    const ys = w.yearly.filter((y) => y.selected.image.studied > 0).slice(-2);
    if (ys.length === 2) {
      const measures = [
        { label: "العامة", pick: (o: LevelOutcomes) => o.image },
        { label: "المستوى الأول", pick: (o: LevelOutcomes) => o.l1 },
        { label: "المستوى الثاني", pick: (o: LevelOutcomes) => o.l2 },
      ];
      const series = seriesOf(w);
      const p100 = (v: number | null) => (v === null ? null : v * 100);
      const chart = yearBlocksChart(
        ys.map((y) => ({ year: String(y.year), groups: measures.map((ms) => ({ label: ms.label, bars: series.map((s) => { const o = s.pick(y); return { value: o && ms.pick(o).studied > 0 ? p100(ms.pick(o).accuracy) : null, tone: s.tone }; }) })) })),
        { min: 0, max: PCT_MAX, plotHeight: 300, barWidth: 52, legend: legendOf(w) },
      );
      const cell = (o: OutcomeStats | undefined, strong: boolean): TableCell => {
        if (!o || o.studied === 0) return { html: "-", cls: "v-muted" };
        const v = `${fmtNum(o.matched)} <span class="v3-sub" style="font-size:17px;color:var(--v3-muted)">(${pct(o.accuracy)})</span>`;
        return { html: strong ? `<b>${v}</b>` : v, cls: strong ? "v-gold" : "v-navy" };
      };
      const rows: TableCell[][] = series.map((s) => [
        { html: s.sel ? `<b>${esc(s.label)}</b>` : esc(s.label), cls: s.sel ? "v-gold" : `v-${s.tone}` },
        ...ys.flatMap((y) => { const o = s.pick(y); return [{ html: o ? fmtNum(o.image.studied) : "-", cls: "v-navy" } as TableCell, ...measures.map((ms) => cell(o ? ms.pick(o) : undefined, s.sel))]; }),
      ]);
      const headers = ["النطاق", ...ys.flatMap((y) => [`المدروسة ${y.year}`, ...measures.map((ms) => `${ms.label} ${y.year}`)])];
      parts.push(
        slideShell(
          meta("w5", SEC),
          "",
          `${contentHead({ eyebrow: EYEBROW.w5, title: `مقارنة ${ys[0].year} و${ys[1].year}: ${w.displayName} ومستويات العبء` })}
${chart}
<div style="margin-top:14px">${dataTable({ headers, rows, groupStart: [1, 5], compactHeaders: true, rowPx: 50, firstColWidth: 14 }).replace('<table class="v3-table', '<table class="pr-cmp v3-table').replace("<thead>", '<colgroup><col style="width:16%"/><col/><col/><col/><col/><col/><col/><col/><col/></colgroup><thead>')}</div>
`,
        ),
      );
    }
  }
  return parts;
}

/** Bars, in the same order on every year chart: the port, then the low, medium and high tiers. */
const PCT_MAX = 110; // 0–100% plus headroom for the value label above a full bar
function seriesOf(w: WorkloadSlideInput) {
  return [
    { label: w.displayName, tone: "blue" as ChartTone, sel: true, pick: (y: WorkloadSlideInput["yearly"][number]): LevelOutcomes | undefined => y.selected },
    ...w.tiers.map((t) => ({ label: `عبء ${t.label}`, tone: TONE[t.key], sel: false, pick: (y: WorkloadSlideInput["yearly"][number]): LevelOutcomes | undefined => y.tiers[t.key] })),
  ];
}
function legendOf(w: WorkloadSlideInput): LegendItem[] {
  return seriesOf(w).map((s) => ({ swatch: s.tone === "navy" ? "blue" : s.tone, text: s.label }) as LegendItem);
}
