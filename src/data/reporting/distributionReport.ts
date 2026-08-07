// Distribution report (تقرير التوزيع) — Wave 3 rework to the consistent 3-output
// model (Document / Deck / Excel), built on the executive infrastructure so it
// shares one visual identity with the executive editions.
//
// Story: from the drawn sample → who was assigned what (per-employee quotas,
// daily quota) → current status (pending / completed / replacement-requested /
// replaced) → event-log history highlights (the replacement/replaced entries
// present in the current snapshot).
//
// SECURITY: every interpolated value (image ids, employee names, port names,
// results, statuses) routes through the hardened `esc` primitive via the shared
// render helpers. This builder is part of the Wave 3 XSS test set.

import * as XLSX from "xlsx";

import type { DistributionCurrentData } from "../distribution/distributionTypes";
import { openReportWindow, writeOrCloseOnFailure } from "./htmlReport";
import { yieldToMain } from "../storage/yieldToMain";
import { esc, fmtNum, fmtPct } from "./executive/primitives";
import { page, pageHeader, kpi, kpiStrip, panel } from "./executive/document/shared";
import { dataTable, paginateRows } from "./executive/document/pagination";
import { slide, split, heroNumber, heroChart, kpiTile, kpiBand, miniTable, numberedList } from "./executive/deck/shared";
import { donut, rankedBar } from "./executive/ui/charts";
import { icon } from "./executive/ui/icons";
import { buildDocViewer, buildDeckViewer, formatMonthLabel, formatIssueDate } from "./shared/reportChrome";
import {
  sourceRevisionsFooterHtml,
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_SHEET_NAME_AR,
  hasSourceRevisions,
  type SourceRevisions,
} from "./sourceRevisions";

const STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  completed: "مكتمل",
  replaced: "مستبدل",
  "replacement-requested": "طلب استبدال",
};

function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

/** Percentage of n over d, or null when the denominator is empty (renders "—"). */
function ratePct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

// ─── Distribution model (pure) ────────────────────────────────────────────────

type EmployeeStat = {
  username: string;
  displayName: string;
  total: number;
  pending: number;
  completed: number;
  requested: number;
  replaced: number;
  dailyQuota: number | null;
  completionRate: number | null;
};

/** Per-employee counts within one grouping bucket (a stage/level or a port). */
type BucketEmployeeStat = {
  username: string;
  displayName: string;
  assigned: number;
  completed: number;
  completionRate: number | null;
};

/** A grouping bucket (per-stage/level or per-port) listing every employee who
 *  took samples in it and how many (R2: "section 1 per stage, section 2 per port"). */
export type DistributionBucket = {
  key: string;
  label: string;
  totalAssigned: number;
  totalCompleted: number;
  completionRate: number | null;
  employees: BucketEmployeeStat[];
};

export type DistributionModel = {
  monthFolderName: string;
  monthLabel: string;
  derivedAt: string;
  totalAssigned: number;
  totalPending: number;
  totalCompleted: number;
  totalReplaced: number;
  totalRequested: number;
  completionRate: number | null;
  employees: EmployeeStat[];
  /** Section 1 — per stage/level, each listing all employees and their sample counts. */
  byStage: DistributionBucket[];
  /** Section 2 — per port, each listing all employees and their sample counts. */
  byPort: DistributionBucket[];
  /** Replacement/replaced entries surfaced as event-log highlights. */
  highlights: Array<{ xrayImageId: string; assignedTo: string; displayName: string; status: string; portName: string; lastEventAt: string; replacedById: string | null }>;
};

/** Group distribution entries into per-key buckets (stage or port), each with
 *  a per-employee breakdown. Bucket order: highest total first (ties → key
 *  ascending, for deterministic output). Employee order within a bucket:
 *  highest assigned first (ties → username ascending). */
function groupEntries(
  entries: DistributionCurrentData["entries"],
  keyOf: (e: DistributionCurrentData["entries"][number]) => string,
  nameOf: (u: string) => string,
): DistributionBucket[] {
  const buckets = new Map<string, Map<string, BucketEmployeeStat>>();
  for (const e of entries) {
    const key = keyOf(e) || "غير محدد";
    let empMap = buckets.get(key);
    if (!empMap) { empMap = new Map(); buckets.set(key, empMap); }
    let stat = empMap.get(e.assignedTo);
    if (!stat) {
      stat = { username: e.assignedTo, displayName: nameOf(e.assignedTo), assigned: 0, completed: 0, completionRate: null };
      empMap.set(e.assignedTo, stat);
    }
    stat.assigned++;
    if (e.status === "completed") stat.completed++;
  }
  return [...buckets.entries()]
    .map(([key, empMap]) => {
      const employees = [...empMap.values()]
        .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.assigned) }))
        .sort((a, b) => b.assigned - a.assigned || a.username.localeCompare(b.username));
      const totalAssigned = employees.reduce((s, e) => s + e.assigned, 0);
      const totalCompleted = employees.reduce((s, e) => s + e.completed, 0);
      return { key, label: key, totalAssigned, totalCompleted, completionRate: ratePct(totalCompleted, totalAssigned), employees };
    })
    .sort((a, b) => b.totalAssigned - a.totalAssigned || a.key.localeCompare(b.key));
}

export function computeDistributionModel(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
): DistributionModel {
  const nameOf = (u: string): string => employeeDisplayNames[u] ?? u;

  const byEmp = new Map<string, EmployeeStat>();
  for (const e of data.entries) {
    let s = byEmp.get(e.assignedTo);
    if (!s) {
      s = {
        username: e.assignedTo, displayName: nameOf(e.assignedTo),
        total: 0, pending: 0, completed: 0, requested: 0, replaced: 0,
        dailyQuota: data.quotas?.[e.assignedTo]?.dailyQuota ?? null,
        completionRate: null,
      };
      byEmp.set(e.assignedTo, s);
    }
    s.total++;
    if (e.status === "pending") s.pending++;
    else if (e.status === "completed") s.completed++;
    else if (e.status === "replaced") s.replaced++;
    else if (e.status === "replacement-requested") s.requested++;
  }
  const employees = [...byEmp.values()]
    .map((s) => ({ ...s, completionRate: ratePct(s.completed, s.total) }))
    .sort((a, b) => b.total - a.total);

  const totalRequested = data.entries.filter((e) => e.status === "replacement-requested").length;

  const highlights = data.entries
    .filter((e) => e.status === "replacement-requested" || e.status === "replaced")
    .slice(0, 40)
    .map((e) => ({
      xrayImageId: e.xrayImageId,
      assignedTo: e.assignedTo,
      displayName: nameOf(e.assignedTo),
      status: e.status,
      portName: e.row.portName ?? "—",
      lastEventAt: e.lastEventAt,
      replacedById: e.replacedById,
    }));

  return {
    monthFolderName,
    monthLabel: formatMonthLabel(monthFolderName),
    derivedAt: data.derivedAt,
    totalAssigned: data.totalAssigned,
    totalPending: data.totalPending,
    totalCompleted: data.totalCompleted,
    totalReplaced: data.totalReplaced,
    totalRequested,
    completionRate: ratePct(data.totalCompleted, data.totalAssigned),
    employees,
    byStage: groupEntries(data.entries, (e) => e.row.stage ?? "غير محدد", nameOf),
    byPort: groupEntries(data.entries, (e) => e.row.portName ?? "غير محدد", nameOf),
    highlights,
  };
}

// ─── Document (A4 portrait) ───────────────────────────────────────────────────

const DIST_RAILS = ["الأساس", "التعيينات", "الموظفون", "الحالة"];

function rotate<T>(arr: T[], by: number): T[] {
  const n = arr.length;
  const k = ((by % n) + n) % n;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Render one grouping bucket (a stage/level or a port) as a panel: bucket
 *  totals in the panel title, then a per-employee table. Used by both the
 *  R2 "section 1 per stage" and "section 2 per port" document pages. */
function bucketPanel(bucket: DistributionBucket, iconName: string): string {
  return panel(
    `${bucket.label} — ${fmtNum(bucket.totalAssigned)} صورة، ${fmtPct(bucket.completionRate)} إنجاز`,
    dataTable({
      headers: ["الموظف", "المعيّنة", "المكتملة", "الإنجاز"],
      rows: bucket.employees.map((e) => [e.displayName, fmtNum(e.assigned), fmtNum(e.completed), fmtPct(e.completionRate)]),
      totalRow: ["المجموع", fmtNum(bucket.totalAssigned), fmtNum(bucket.totalCompleted), fmtPct(bucket.completionRate)],
    }),
    { iconName },
  );
}

function bucketSectionBody(buckets: DistributionBucket[], emptyNote: string): string {
  if (buckets.length === 0) return `<div class="d-empty">${emptyNote}</div>`;
  return buckets.map((b) => bucketPanel(b, "layers")).join("\n");
}

async function distributionDocPages(m: DistributionModel, issueDate: string, detailRows: (string | number | null)[][]): Promise<string> {
  const pages: string[] = [];

  // Page 1 — overview / baseline.
  pages.push(page({
    id: "d-overview", title: "لمحة التوزيع", pageNo: "01", railTabs: DIST_RAILS,
    body: `${pageHeader({ iconName: "users", eyebrow: "تقرير التوزيع", title: `توزيع العينة — ${m.monthLabel}`, subtitle: `تم التوليد: ${m.derivedAt} — تاريخ الإصدار: ${issueDate}` })}
      ${kpiStrip([
        kpi({ label: "إجمالي المعيّنة", value: fmtNum(m.totalAssigned), sub: "من العينة المسحوبة", tone: "slate" }),
        kpi({ label: "مكتملة", value: fmtNum(m.totalCompleted), sub: `${fmtPct(m.completionRate)} إنجاز`, tone: "green" }),
        kpi({ label: "قيد الانتظار", value: fmtNum(m.totalPending), tone: "blue" }),
        kpi({ label: "طلبات/استبدال", value: `${fmtNum(m.totalRequested)} / ${fmtNum(m.totalReplaced)}`, tone: "coral" }),
      ])}
      ${panel("مسار التوزيع", dataTable({
        headers: ["المرحلة", "الوصف", "العدد"],
        rows: [
          ["1 · الأساس", "العينة المسحوبة الموزّعة على الموظفين", fmtNum(m.totalAssigned)],
          ["2 · التعيينات", "عدد الموظفين المكلَّفين", fmtNum(m.employees.length)],
          ["3 · الإنجاز", "الصور المكتملة", fmtNum(m.totalCompleted)],
          ["4 · قيد الانتظار", "صور لم تُدرَس بعد", fmtNum(m.totalPending)],
          ["5 · الاستبدال", "طلبات استبدال / تم استبدالها", `${fmtNum(m.totalRequested)} / ${fmtNum(m.totalReplaced)}`],
        ],
      }), { iconName: "arrow" })}`,
  }));
  await yieldToMain();

  // Section 1 — per stage/level (R2): each level lists every employee and
  // how many samples they took in it.
  pages.push(page({
    id: "d-by-stage", title: "القسم 1 — حسب المستوى", pageNo: "02", railTabs: rotate(DIST_RAILS, 1),
    body: `${pageHeader({ iconName: "layers", eyebrow: "القسم 1", title: "التوزيع حسب المستوى", subtitle: "لكل مستوى: الموظفون الذين أخذوا صوراً منه وعددها وحالة الإنجاز." })}
      ${bucketSectionBody(m.byStage, "لا توجد بيانات توزيع بعد.")}`,
  }));
  await yieldToMain();

  // Section 2 — per port (R2): each port lists every employee and how many
  // samples they took in it.
  pages.push(page({
    id: "d-by-port", title: "القسم 2 — حسب المنفذ", pageNo: "03", railTabs: rotate(DIST_RAILS, 1),
    body: `${pageHeader({ iconName: "port", eyebrow: "القسم 2", title: "التوزيع حسب المنفذ", subtitle: "لكل منفذ: الموظفون الذين أخذوا صوراً منه وعددها وحالة الإنجاز." })}
      ${bucketSectionBody(m.byPort, "لا توجد بيانات توزيع بعد.")}`,
  }));
  await yieldToMain();

  // Per-employee breakdown across the whole month (paginated).
  const empHeaders = ["الموظف", "الحصة اليومية", "الإجمالي", "قيد الانتظار", "مكتمل", "طلب استبدال", "مستبدل", "الإنجاز"];
  const empRows = m.employees.map((e) => [
    e.displayName, e.dailyQuota === null ? null : fmtNum(e.dailyQuota), fmtNum(e.total),
    fmtNum(e.pending), fmtNum(e.completed), fmtNum(e.requested), fmtNum(e.replaced), fmtPct(e.completionRate),
  ]);
  const empTotal = [
    "المجموع", null, fmtNum(m.totalAssigned), fmtNum(m.totalPending), fmtNum(m.totalCompleted),
    fmtNum(m.totalRequested), fmtNum(m.totalReplaced), fmtPct(m.completionRate),
  ];
  const empChunks = paginateRows({ headers: empHeaders, rows: empRows, rowsPerPage: 18, totalRow: empTotal });
  let pageNo = 4;
  for (let i = 0; i < empChunks.length; i++) {
    const chunk = empChunks[i];
    pages.push(page({
      id: `d-emp-${i}`, title: i === 0 ? "توزيع الموظفين" : `توزيع الموظفين (${i + 1})`,
      pageNo: pad(pageNo++), railTabs: rotate(DIST_RAILS, 2),
      body: `${pageHeader({ iconName: "user", eyebrow: "المرحلة 2–3", title: "التعيينات لكل موظف", subtitle: "الحصة اليومية، والإجمالي المكلَّف، وحالة الإنجاز لكل موظف." })}
        ${panel(`الموظفون (${fmtNum(m.employees.length)})`, chunk, { iconName: "users" })}`,
    }));
    await yieldToMain();
  }

  // Highlights page — replacement/replaced activity.
  if (m.highlights.length > 0) {
    pages.push(page({
      id: "d-highlights", title: "أبرز أحداث الاستبدال", pageNo: pad(pageNo++), railTabs: rotate(DIST_RAILS, 3),
      body: `${pageHeader({ iconName: "flag", eyebrow: "سجل الأحداث", title: "أبرز أحداث الاستبدال", subtitle: "الصور التي طُلب استبدالها أو استُبدلت في الحالة الحالية." })}
        ${panel("الاستبدالات", dataTable({
          headers: ["رقم الأشعة", "الموظف", "المنفذ", "الحالة", "البديل", "آخر حدث"],
          rows: m.highlights.map((h) => [h.xrayImageId, h.displayName, h.portName, statusLabel(h.status), h.replacedById ?? "—", h.lastEventAt]),
        }), { iconName: "flag" })}`,
    }));
    await yieldToMain();
  }

  // Full detail (paginated).
  const detailHeaders = ["رقم الأشعة", "الموظف", "المنفذ", "CertScan", "الحالة", "آخر حدث"];
  const detailChunks = paginateRows({ headers: detailHeaders, rows: detailRows, rowsPerPage: 22 });
  for (let i = 0; i < detailChunks.length; i++) {
    const chunk = detailChunks[i];
    pages.push(page({
      id: `d-detail-${i}`, title: i === 0 ? "تفاصيل التوزيع" : `تفاصيل التوزيع (${i + 1})`,
      pageNo: pad(pageNo++), railTabs: rotate(DIST_RAILS, 3),
      body: `${pageHeader({ iconName: "layers", eyebrow: "المرحلة 4", title: "تفاصيل التوزيع الكاملة", subtitle: `${fmtNum(detailRows.length)} صف موزَّع.` })}
        ${panel("كل الصفوف", chunk, { iconName: "layers" })}`,
    }));
    await yieldToMain();
  }

  return pages.join("\n");
}

// ─── Deck (16:9 landscape) ────────────────────────────────────────────────────

function titleSlide(m: DistributionModel): string {
  return `<section class="slide title-slide" id="d-deck-title" data-title="الغلاف">
  <div class="slide-art"></div>
  <div class="slide-inner">
    <div class="title-mark">${icon("users", 64)}</div>
    <div class="title-kicker">تقرير التوزيع</div>
    <h1>توزيع العينة ومتابعة الإنجاز</h1>
    <div class="title-sub">${esc(m.monthLabel)}</div>
    <div class="title-rule"></div>
    <div class="title-meta">تم التوليد ${esc(m.derivedAt)}</div>
  </div>
</section>`;
}

/** Top-8 bucket ranking table used by the stage/port deck slides (R2). */
function bucketMiniTable(buckets: DistributionBucket[]): string {
  return miniTable({
    headers: ["المستوى/المنفذ", "المعيّنة", "المكتملة", "الإنجاز"],
    rows: buckets.slice(0, 8).map((b) => [b.label, fmtNum(b.totalAssigned), fmtNum(b.totalCompleted), fmtPct(b.completionRate)]),
  });
}

async function distributionDeckSlides(m: DistributionModel): Promise<string> {
  const slides: string[] = [];
  const total = 6;
  slides.push(titleSlide(m));
  await yieldToMain();

  // 1 — status overview.
  slides.push(slide({
    id: "d-deck-status", title: "الحالة العامة", num: 1, total,
    eyebrow: "من العينة إلى التوزيع", iconName: "arrow",
    headline: "حالة توزيع العينة الحالية",
    body: split(
      kpiBand([
        kpiTile({ label: "المعيّنة", value: fmtNum(m.totalAssigned), tone: "slate" }),
        kpiTile({ label: "مكتملة", value: fmtNum(m.totalCompleted), sub: fmtPct(m.completionRate), tone: "green" }),
        kpiTile({ label: "قيد الانتظار", value: fmtNum(m.totalPending), tone: "blue" }),
        kpiTile({ label: "استبدال", value: `${fmtNum(m.totalRequested)}/${fmtNum(m.totalReplaced)}`, tone: "coral" }),
      ]),
      heroChart(donut([
        { label: "مكتملة", value: m.totalCompleted },
        { label: "قيد الانتظار", value: m.totalPending },
        { label: "مستبدلة", value: m.totalReplaced },
      ], { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "توزيع الحالات" }),
      "even",
    ),
    decision: "يعطي الإدارة صورة فورية عن تقدّم الدراسة اليومي.",
  }));
  await yieldToMain();

  // 2 — completion hero.
  slides.push(slide({
    id: "d-deck-completion", title: "الإنجاز", num: 2, total,
    eyebrow: "المتابعة", iconName: "gauge",
    headline: "نسبة الإنجاز الإجمالية",
    body: heroNumber({ value: fmtPct(m.completionRate), caption: `${fmtNum(m.totalCompleted)} مكتملة من ${fmtNum(m.totalAssigned)} معيّنة`, sub: `${fmtNum(m.totalPending)} صورة ما زالت قيد الانتظار`, tone: "green" }),
    decision: "يحدد ما إذا كان الإيقاع الحالي يفي بالموعد النهائي الشهري.",
  }));
  await yieldToMain();

  // 3 — section 1: per stage/level (R2).
  slides.push(slide({
    id: "d-deck-stage", title: "القسم 1 — حسب المستوى", num: 3, total,
    eyebrow: "القسم 1", iconName: "layers",
    headline: "التوزيع والإنجاز حسب المستوى",
    body: m.byStage.length === 0
      ? `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>لا توجد بيانات</b><span>لم تُوزَّع أي صور بعد.</span></div>`
      : bucketMiniTable(m.byStage),
    decision: "يوضح إنجاز كل مستوى على حدة ومدى تمثيل الموظفين فيه.",
  }));
  await yieldToMain();

  // 4 — section 2: per port (R2).
  slides.push(slide({
    id: "d-deck-port", title: "القسم 2 — حسب المنفذ", num: 4, total,
    eyebrow: "القسم 2", iconName: "port",
    headline: "التوزيع والإنجاز حسب المنفذ",
    body: m.byPort.length === 0
      ? `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>لا توجد بيانات</b><span>لم تُوزَّع أي صور بعد.</span></div>`
      : bucketMiniTable(m.byPort),
    decision: "يبرز المنافذ الأعلى حملاً ومدى تقدّم الإنجاز فيها.",
  }));
  await yieldToMain();

  // 5 — per-employee load.
  const topEmp = m.employees.slice(0, 8);
  slides.push(slide({
    id: "d-deck-emp", title: "أحمال الموظفين", num: 5, total,
    eyebrow: "التعيينات", iconName: "users",
    headline: "التوزيع والإنجاز لكل موظف",
    body: topEmp.length === 0
      ? `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>لا توجد تعيينات</b><span>لم تُوزَّع أي صور بعد.</span></div>`
      : split(
          miniTable({
            headers: ["الموظف", "الحصة", "الإجمالي", "مكتمل", "الإنجاز"],
            rows: topEmp.map((e) => [e.displayName, e.dailyQuota === null ? null : fmtNum(e.dailyQuota), fmtNum(e.total), fmtNum(e.completed), fmtPct(e.completionRate)]),
          }),
          heroChart(rankedBar(topEmp.map((e) => ({ label: e.displayName, value: Math.round(e.completionRate ?? 0) })), { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "نسبة الإنجاز٪ لكل موظف" }),
          "wide-left",
        ),
    decision: "يبرز من ينجز وفق حصته ومن يحتاج إعادة توزيع أو دعم.",
  }));
  await yieldToMain();

  // 6 — replacement activity.
  slides.push(slide({
    id: "d-deck-repl", title: "الاستبدالات", num: 6, total,
    eyebrow: "سجل الأحداث", iconName: "flag",
    headline: "نشاط الاستبدال",
    body: kpiBand([
      kpiTile({ label: "طلبات الاستبدال", value: fmtNum(m.totalRequested), tone: "coral" }),
      kpiTile({ label: "تم الاستبدال", value: fmtNum(m.totalReplaced), tone: "purple" }),
      kpiTile({ label: "قيد الانتظار", value: fmtNum(m.totalPending), tone: "blue" }),
    ]) + numberedList([
      `طُلب استبدال ${fmtNum(m.totalRequested)} صورة، وتم استبدال ${fmtNum(m.totalReplaced)}.`,
      `نسبة الإنجاز الحالية ${fmtPct(m.completionRate)} من إجمالي ${fmtNum(m.totalAssigned)} صورة معيّنة.`,
      `عدد الموظفين المكلَّفين: ${fmtNum(m.employees.length)}.`,
    ]),
    decision: "يوجّه قرارات إعادة التوزيع ومعالجة أسباب الاستبدال المتكرر.",
  }));

  return slides.join("\n");
}

// ─── Public string builders ───────────────────────────────────────────────────

function detailRowsFor(data: DistributionCurrentData, names: Record<string, string>): (string | number | null)[][] {
  return data.entries.map((e) => [
    e.xrayImageId, names[e.assignedTo] ?? e.assignedTo, e.row.portName ?? "—",
    e.row.certScanStatus, statusLabel(e.status), e.lastEventAt,
  ]);
}

export async function buildDistributionDocument(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  sourceRevisions?: SourceRevisions,
): Promise<string> {
  const m = computeDistributionModel(data, monthFolderName, employeeDisplayNames);
  return buildDocViewer({
    slides: await distributionDocPages(m, formatIssueDate(), detailRowsFor(data, employeeDisplayNames)),
    docTitle: `تقرير التوزيع — ${m.monthLabel}`,
    brandTitle: "تقرير التوزيع",
    brandSub: `ضمان جودة الأشعة — ${m.monthLabel}`,
    iconName: "users",
    footerNote: sourceRevisionsFooterHtml(sourceRevisions, esc),
  });
}

export async function buildDistributionDeck(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  sourceRevisions?: SourceRevisions,
): Promise<string> {
  const m = computeDistributionModel(data, monthFolderName, employeeDisplayNames);
  return buildDeckViewer({
    slides: await distributionDeckSlides(m),
    docTitle: `عرض التوزيع — ${m.monthLabel}`,
    brandTitle: "عرض التوزيع",
    brandSub: `ضمان جودة الأشعة — ${m.monthLabel}`,
    iconName: "users",
    footerNote: sourceRevisionsFooterHtml(sourceRevisions, esc),
  });
}

// XLSX export — Sheet 2 (assignments) row-array construction is chunked with
// a main-thread yield between chunks (same idiom as DataTable/index.tsx and
// BrowseDataView.tsx) so a large distribution doesn't block the UI thread for
// the whole build.
const EXPORT_CHUNK_SIZE = 1000;

export async function buildDistributionXlsx(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  sourceRevisions?: SourceRevisions,
): Promise<void> {
  const m = computeDistributionModel(data, monthFolderName, employeeDisplayNames);
  const nameOf = (u: string): string => employeeDisplayNames[u] ?? u;

  // Sheet 1 — Baseline (drawn sample → distribution).
  const baseline: (string | number)[][] = [
    ["التقرير", "تقرير التوزيع — المسار الكامل"],
    ["الشهر", m.monthLabel],
    ["تاريخ التوليد", m.derivedAt],
    [],
    ["— الأساس —", ""],
    ["إجمالي المعيّنة (من العينة)", m.totalAssigned],
    ["عدد الموظفين المكلَّفين", m.employees.length],
    ["— الحالة —", ""],
    ["مكتملة", m.totalCompleted],
    ["قيد الانتظار", m.totalPending],
    ["طلبات استبدال", m.totalRequested],
    ["تم استبدالها", m.totalReplaced],
    ["نسبة الإنجاز٪", m.completionRate === null ? "" : +m.completionRate.toFixed(2)],
  ];

  // Sheet 2 — Assignments (all rows).
  const assignmentRows: (string | number)[][] = [];
  for (let i = 0; i < data.entries.length; i += EXPORT_CHUNK_SIZE) {
    const chunk = data.entries.slice(i, i + EXPORT_CHUNK_SIZE);
    for (const e of chunk) {
      assignmentRows.push([
        e.xrayImageId, nameOf(e.assignedTo), statusLabel(e.status), e.lastEventAt,
        e.row.portName ?? "", e.row.stage ?? "", e.row.certScanStatus, e.row.biEnrichmentStatus,
        e.row.xrayLevelOneResult, e.row.xrayLevelTwoResult, e.replacedById ?? "",
        e.row.xrayEntryDate ?? "", e.row.declarationNumber ?? "", e.row.movementType ?? "", e.row.riskMessage ?? "",
      ]);
    }
    if (data.entries.length > EXPORT_CHUNK_SIZE) await yieldToMain();
  }
  const assignments: (string | number)[][] = [
    ["رقم الأشعة", "الموظف", "الحالة", "آخر حدث", "المنفذ", "المستوى", "CertScan", "مصدر BI", "م.أول", "م.ثاني", "رقم الإحالة", "تاريخ الدخول", "رقم البيان", "نوع الحركة", "رسالة Risk"],
    ...assignmentRows,
  ];

  // Sheet 3 — Per-employee breakdown.
  const perEmployee: (string | number)[][] = [
    ["الموظف", "الحصة اليومية", "الإجمالي", "قيد الانتظار", "مكتمل", "طلب استبدال", "مستبدل", "الإنجاز٪"],
    ...m.employees.map((e) => [
      e.displayName, e.dailyQuota ?? "", e.total, e.pending, e.completed, e.requested, e.replaced,
      e.completionRate === null ? "" : +e.completionRate.toFixed(2),
    ]),
  ];

  // Sheet 4 — Status / event summary.
  const statusSummary: (string | number)[][] = [
    ["الحالة", "العدد", "النسبة٪"],
    ["مكتملة", m.totalCompleted, pctCell(ratePct(m.totalCompleted, m.totalAssigned))],
    ["قيد الانتظار", m.totalPending, pctCell(ratePct(m.totalPending, m.totalAssigned))],
    ["طلب استبدال", m.totalRequested, pctCell(ratePct(m.totalRequested, m.totalAssigned))],
    ["مستبدلة", m.totalReplaced, pctCell(ratePct(m.totalReplaced, m.totalAssigned))],
    [],
    ["— أبرز أحداث الاستبدال —", "", ""],
    ["رقم الأشعة", "الموظف", "الحالة"],
    ...m.highlights.map((h) => [h.xrayImageId, h.displayName, statusLabel(h.status)]),
  ];

  // Sheet 5 — Section 1: per stage/level (R2).
  const byStageSheet: (string | number)[][] = [
    ["المستوى", "الموظف", "المعيّنة", "المكتملة", "الإنجاز٪"],
    ...m.byStage.flatMap((b) => b.employees.map((e) => [b.label, e.displayName, e.assigned, e.completed, pctCell(e.completionRate)])),
  ];

  // Sheet 6 — Section 2: per port (R2).
  const byPortSheet: (string | number)[][] = [
    ["المنفذ", "الموظف", "المعيّنة", "المكتملة", "الإنجاز٪"],
    ...m.byPort.flatMap((b) => b.employees.map((e) => [b.label, e.displayName, e.assigned, e.completed, pctCell(e.completionRate)])),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(baseline), "الأساس — ملخص");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assignments), "التعيينات");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perEmployee), "حسب الموظف");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statusSummary), "الحالة والأحداث");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byStageSheet), "1 · حسب المستوى");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byPortSheet), "2 · حسب المنفذ");
  if (hasSourceRevisions(sourceRevisions)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sourceRevisionsSheetAoa(sourceRevisions)),
      SOURCE_REVISIONS_SHEET_NAME_AR
    );
  }

  XLSX.writeFile(wb, `تقرير_التوزيع_${monthFolderName}.xlsx`);
}

/** Percentage cell for the workbook: blank on empty denominator, never `0%`. */
function pctCell(value: number | null): string | number {
  return value === null ? "" : +value.toFixed(2);
}

// ─── Open / download helpers ──────────────────────────────────────────────────

/**
 * Opens the target tab synchronously (still inside the click's user gesture,
 * P3-7) BEFORE the now-chunked `buildDistributionDocument` build runs, then
 * writes the finished HTML in once ready — yielding after `window.open()`
 * would let the click's transient activation lapse and risk a silently
 * blocked popup. `writeOrCloseOnFailure` closes the already-opened tab
 * instead of abandoning it blank if the build throws (see its doc comment in
 * htmlReport.ts).
 */
export async function openDistributionDocument(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  sourceRevisions?: SourceRevisions,
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildDistributionDocument(data, monthFolderName, employeeDisplayNames, sourceRevisions),
    `تقرير_التوزيع_${monthFolderName}.html`,
  );
}

export async function openDistributionDeck(
  data: DistributionCurrentData,
  monthFolderName: string,
  employeeDisplayNames: Record<string, string> = {},
  sourceRevisions?: SourceRevisions,
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildDistributionDeck(data, monthFolderName, employeeDisplayNames, sourceRevisions),
    `عرض_التوزيع_${monthFolderName}.html`,
  );
}
