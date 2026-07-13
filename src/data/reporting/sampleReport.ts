// Sample report (تقرير العينة) — Wave 3 rework to the consistent 3-output model
// (Document / Deck / Excel), built on the executive infrastructure (theme,
// document + deck primitives, charts, hardened `esc`) so it shares one visual
// identity with the executive editions.
//
// Story: the complete data journey of the sample —
//   received (raw rows) → processed / mapped → stratified (Hamilton by port,
//   CertScan/NonCertScan split, RNG seed, spillover) → the drawn sample.
//
// SECURITY: every interpolated value (port names, ids, results, seed, drawnBy)
// routes through the hardened `esc` primitive (via the shared render helpers).
// This builder is part of the Wave 3 XSS test set — keep it that way.

import * as XLSX from "xlsx";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { openOrDownload } from "./htmlReport";
import { fmtNum, fmtPct } from "./executive/primitives";
import {
  page,
  pageHeader,
  kpi,
  kpiStrip,
  panel,
} from "./executive/document/shared";
import { dataTable, paginateRows } from "./executive/document/pagination";
import {
  slide,
  split,
  heroNumber,
  heroChart,
  kpiTile,
  kpiBand,
  miniTable,
  numberedList,
  esc as deckEsc,
} from "./executive/deck/shared";
import { donut, rankedBar } from "./executive/ui/charts";
import { icon } from "./executive/ui/icons";
import {
  buildDocViewer,
  buildDeckViewer,
  formatMonthLabel,
  formatIssueDate,
} from "./shared/reportChrome";
import {
  sourceRevisionsFooterHtml,
  sourceRevisionsSheetAoa,
  SOURCE_REVISIONS_SHEET_NAME_AR,
  hasSourceRevisions,
  type SourceRevisions,
} from "./sourceRevisions";

export type SampleReportInput = {
  monthFolderName: string;
  manifest: MonthManifestData | null;
  populationRows: PreparedPopulationRow[];
  sample: SampleMasterData;
  /** Report-to-revision linkage (B2). Optional; footer/sheet render nothing when omitted. */
  sourceRevisions?: SourceRevisions;
};

// ─── Lineage model (pure) ─────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  first: "المرحلة الأولى",
  second: "المرحلة الثانية",
  third: "المرحلة الثالثة",
  fourth: "المرحلة الرابعة",
};

function stageLabel(key: string): string {
  return STAGE_LABELS[key] ?? key;
}

/** Percentage of n over d, or null when the denominator is empty (renders "—"). */
function ratePct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

type SamplePortStat = {
  portName: string;
  population: number;
  riskRows: number;
  biRows: number;
  certScan: number;
  nonCertScan: number;
  allocatedQuota: number | null;
  actualCertScanDrawn: number | null;
  actualNonCertScanDrawn: number | null;
  sample: number;
  coverage: number | null;
};

export type SampleLineage = {
  monthFolderName: string;
  monthLabel: string;
  rngSeed: string;
  drawnAt: string;
  drawnBy: string;
  rawRows: number;
  processedRows: number;
  removed: number;
  riskCount: number;
  biCount: number;
  certCount: number;
  nonCertCount: number;
  totalRequested: number;
  totalActual: number;
  certScanActual: number;
  nonCertScanActual: number;
  coverage: number | null;
  fulfillment: number | null;
  ports: SamplePortStat[];
  stages: SampleMasterData["stageAllocations"];
};

/** Fold the raw inputs into the lineage model consumed by all three renderers. */
export function computeSampleLineage(input: SampleReportInput): SampleLineage {
  const { monthFolderName, manifest, populationRows, sample } = input;
  const sampledIds = new Set(sample.rows.map((r) => r.xrayImageId));

  type Acc = { population: number; risk: number; bi: number; cert: number; nonCert: number; sample: number };
  const portMap = new Map<string, Acc>();
  for (const r of populationRows) {
    const port = r.portName ?? "غير محدد";
    let a = portMap.get(port);
    if (!a) { a = { population: 0, risk: 0, bi: 0, cert: 0, nonCert: 0, sample: 0 }; portMap.set(port, a); }
    a.population++;
    if (r.biEnrichmentStatus === "BI Matched") a.bi++; else a.risk++;
    if (r.certScanStatus === "Certscan") a.cert++; else a.nonCert++;
    if (sampledIds.has(r.xrayImageId)) a.sample++;
  }

  const allocMap = new Map(sample.portAllocations.map((p) => [p.portName, p]));
  const ports: SamplePortStat[] = [...portMap.entries()]
    .sort((a, b) => b[1].population - a[1].population)
    .map(([portName, a]) => {
      const alloc = allocMap.get(portName);
      return {
        portName,
        population: a.population,
        riskRows: a.risk,
        biRows: a.bi,
        certScan: a.cert,
        nonCertScan: a.nonCert,
        allocatedQuota: alloc ? alloc.allocatedQuota : null,
        actualCertScanDrawn: alloc ? alloc.actualCertScanDrawn : null,
        actualNonCertScanDrawn: alloc ? alloc.actualNonCertScanDrawn : null,
        sample: a.sample,
        coverage: ratePct(a.sample, a.population),
      };
    });

  const rawRows = manifest?.totalRawRows ?? populationRows.length;
  const processedRows = manifest?.totalProcessedRows ?? populationRows.length;
  const biCount = populationRows.filter((r) => r.biEnrichmentStatus === "BI Matched").length;
  const certCount = populationRows.filter((r) => r.certScanStatus === "Certscan").length;

  return {
    monthFolderName,
    monthLabel: formatMonthLabel(monthFolderName),
    rngSeed: sample.rngSeed,
    drawnAt: sample.drawnAt,
    drawnBy: sample.drawnBy,
    rawRows,
    processedRows,
    removed: Math.max(0, rawRows - processedRows),
    riskCount: populationRows.length - biCount,
    biCount,
    certCount,
    nonCertCount: populationRows.length - certCount,
    totalRequested: sample.totalRequested,
    totalActual: sample.totalActual,
    certScanActual: sample.certScanActual,
    nonCertScanActual: sample.nonCertScanActual,
    coverage: ratePct(sample.totalActual, processedRows),
    fulfillment: ratePct(sample.totalActual, sample.totalRequested),
    ports,
    stages: sample.stageAllocations,
  };
}

// ─── Document (A4 portrait) ───────────────────────────────────────────────────

const SAMPLE_RAILS = ["الاستلام", "المعالجة", "الطبقات", "العينة"];

function sampleDocPages(m: SampleLineage, issueDate: string, previewRows: (string | number | null)[][]): string {
  const pages: string[] = [];

  // Page 1 — lineage overview.
  pages.push(page({
    id: "s-overview", title: "لمحة المسار", pageNo: "01", railTabs: SAMPLE_RAILS,
    body: `${pageHeader({ iconName: "layers", eyebrow: "تقرير العينة", title: `المسار الكامل للعينة — ${m.monthLabel}`, subtitle: `البذرة: ${m.rngSeed} — سُحبت بواسطة: ${m.drawnBy} — تاريخ الإصدار: ${issueDate}` })}
      ${kpiStrip([
        kpi({ label: "البيانات الخام", value: fmtNum(m.rawRows), sub: "قبل المعالجة", tone: "slate" }),
        kpi({ label: "بعد المعالجة", value: fmtNum(m.processedRows), sub: m.removed > 0 ? `${fmtNum(m.removed)} محذوف` : "بدون حذف", tone: "blue" }),
        kpi({ label: "العينة المسحوبة", value: fmtNum(m.totalActual), sub: `${fmtPct(m.coverage)} تغطية`, tone: "gold" }),
        kpi({ label: "نسبة الإنجاز", value: fmtPct(m.fulfillment), sub: `${fmtNum(m.totalRequested)} مطلوب`, tone: "green" }),
      ])}
      ${panel("مراحل المسار", dataTable({
        headers: ["المرحلة", "الوصف", "العدد"],
        rows: [
          ["1 · الاستلام", "الصفوف الخام كما وردت من ملفات Risk/BI", fmtNum(m.rawRows)],
          ["2 · المعالجة", "بعد التصفية والمطابقة والتخطيط", fmtNum(m.processedRows)],
          ["3 · التصنيف", "مصدر Risk / BI مطابق", `${fmtNum(m.riskCount)} / ${fmtNum(m.biCount)}`],
          ["4 · CertScan", "CertScan / NonCertScan", `${fmtNum(m.certCount)} / ${fmtNum(m.nonCertCount)}`],
          ["5 · السحب", "العينة النهائية المسحوبة للدراسة", fmtNum(m.totalActual)],
        ],
      }), { iconName: "arrow" })}`,
  }));

  // Page 2 — received vs processed.
  pages.push(page({
    id: "s-processing", title: "الاستلام والمعالجة", pageNo: "02", railTabs: rotate(SAMPLE_RAILS, 1),
    body: `${pageHeader({ iconName: "scan", eyebrow: "المرحلة 1–2", title: "من الخام إلى المعالج", subtitle: "ما الذي استُلم، وكيف تمت معالجته وتصنيف مصدره." })}
      ${kpiStrip([
        kpi({ label: "خام", value: fmtNum(m.rawRows), tone: "slate" }),
        kpi({ label: "معالج", value: fmtNum(m.processedRows), tone: "blue" }),
        kpi({ label: "محذوف", value: fmtNum(m.removed), tone: "coral" }),
      ])}
      ${panel("التصنيف حسب المصدر ونوع الفحص", dataTable({
        headers: ["التصنيف", "الفئة", "العدد", "النسبة"],
        rows: [
          ["المصدر", "Risk", fmtNum(m.riskCount), fmtPct(ratePct(m.riskCount, m.processedRows))],
          ["المصدر", "BI مطابق", fmtNum(m.biCount), fmtPct(ratePct(m.biCount, m.processedRows))],
          ["نوع الفحص", "CertScan", fmtNum(m.certCount), fmtPct(ratePct(m.certCount, m.processedRows))],
          ["نوع الفحص", "NonCertScan", fmtNum(m.nonCertCount), fmtPct(ratePct(m.nonCertCount, m.processedRows))],
        ],
      }))}`,
  }));

  // Page 3+ — stratification by port (paginated).
  const portHeaders = ["المنفذ", "المجتمع", "Risk", "BI", "Cert", "NonCert", "المخصص", "Cert مسحوب", "NonCert مسحوب", "العينة", "التغطية"];
  const portRows = m.ports.map((p) => [
    p.portName, fmtNum(p.population), fmtNum(p.riskRows), fmtNum(p.biRows),
    fmtNum(p.certScan), fmtNum(p.nonCertScan),
    p.allocatedQuota === null ? null : fmtNum(p.allocatedQuota),
    p.actualCertScanDrawn === null ? null : fmtNum(p.actualCertScanDrawn),
    p.actualNonCertScanDrawn === null ? null : fmtNum(p.actualNonCertScanDrawn),
    fmtNum(p.sample), fmtPct(p.coverage),
  ]);
  const portTotal = [
    "المجموع", fmtNum(m.processedRows), fmtNum(m.riskCount), fmtNum(m.biCount),
    fmtNum(m.certCount), fmtNum(m.nonCertCount), fmtNum(m.totalRequested),
    fmtNum(m.certScanActual), fmtNum(m.nonCertScanActual), fmtNum(m.totalActual), fmtPct(m.coverage),
  ];
  const portChunks = paginateRows({ headers: portHeaders, rows: portRows, rowsPerPage: 18, totalRow: portTotal });
  let pageNo = 3;
  portChunks.forEach((chunk, i) => {
    pages.push(page({
      id: `s-ports-${i}`, title: i === 0 ? "التصنيف حسب المنفذ" : `التصنيف حسب المنفذ (${i + 1})`,
      pageNo: pad(pageNo++), railTabs: rotate(SAMPLE_RAILS, 2),
      body: `${pageHeader({ iconName: "port", eyebrow: "المرحلة 3", title: "التصنيف الطبقي حسب المنفذ", subtitle: "توزيع Hamilton بالحصص، وتقسيم CertScan/NonCertScan، والصفوف المسحوبة فعلياً لكل منفذ." })}
        ${panel(`المنافذ (${fmtNum(m.ports.length)} منفذ)`, chunk, { iconName: "port" })}`,
    }));
  });

  // Stage allocation page.
  pages.push(page({
    id: "s-stages", title: "التوزيع على المستويات", pageNo: pad(pageNo++), railTabs: rotate(SAMPLE_RAILS, 2),
    body: `${pageHeader({ iconName: "layers", eyebrow: "المرحلة 3", title: "توزيع العينة على المستويات", subtitle: "حصة كل مستوى من المجتمع والمسحوب فعلياً." })}
      ${panel("المستويات", dataTable({
        headers: ["المستوى", "المجتمع", "المستهدف", "المسحوب", "Cert", "NonCert", "التغطية"],
        rows: m.stages.map((s) => [
          stageLabel(s.stageKey), fmtNum(s.populationSize),
          s.targetQuota > 0 ? fmtNum(s.targetQuota) : null,
          fmtNum(s.actualDrawn), fmtNum(s.certScanDrawn), fmtNum(s.nonCertScanDrawn),
          fmtPct(ratePct(s.actualDrawn, s.populationSize)),
        ]),
        totalRow: [
          "المجموع", fmtNum(m.stages.reduce((s, r) => s + r.populationSize, 0)),
          fmtNum(m.totalRequested), fmtNum(m.totalActual),
          fmtNum(m.certScanActual), fmtNum(m.nonCertScanActual), fmtPct(m.coverage),
        ],
      }))}`,
  }));

  // Drawn sample preview (paginated).
  const sampleHeaders = ["رقم الأشعة", "المنفذ", "المستوى", "CertScan", "مصدر BI", "م.أول", "م.ثاني"];
  const sampleChunks = paginateRows({ headers: sampleHeaders, rows: previewRows, rowsPerPage: 20 });
  sampleChunks.forEach((chunk, i) => {
    pages.push(page({
      id: `s-drawn-${i}`, title: i === 0 ? "الصفوف المسحوبة" : `الصفوف المسحوبة (${i + 1})`,
      pageNo: pad(pageNo++), railTabs: rotate(SAMPLE_RAILS, 3),
      body: `${pageHeader({ iconName: "check", eyebrow: "المرحلة 4", title: "الصفوف المسحوبة للدراسة", subtitle: `عرض ${fmtNum(previewRows.length)} صف من العينة النهائية.` })}
        ${panel("العينة النهائية", chunk, { iconName: "check" })}`,
    }));
  });

  return pages.join("\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Rotate the rail labels so the "active" (first) tab tracks the current section. */
function rotate<T>(arr: T[], by: number): T[] {
  const n = arr.length;
  const k = ((by % n) + n) % n;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// ─── Deck (16:9 landscape) ────────────────────────────────────────────────────

function titleSlide(m: SampleLineage): string {
  return `<section class="slide title-slide" id="s-deck-title" data-title="الغلاف">
  <div class="slide-art"></div>
  <div class="slide-inner">
    <div class="title-mark">${icon("layers", 64)}</div>
    <div class="title-kicker">تقرير العينة</div>
    <h1>المسار الكامل للعينة</h1>
    <div class="title-sub">${deckEsc(m.monthLabel)}</div>
    <div class="title-rule"></div>
    <div class="title-meta">البذرة ${deckEsc(m.rngSeed)} — سُحبت بواسطة ${deckEsc(m.drawnBy)}</div>
  </div>
</section>`;
}

function sampleDeckSlides(m: SampleLineage): string {
  const slides: string[] = [];
  const total = 5;

  slides.push(titleSlide(m));

  // 1 — lineage overview.
  slides.push(slide({
    id: "s-deck-overview", title: "لمحة المسار", num: 1, total,
    eyebrow: "من الاستلام إلى السحب", iconName: "arrow",
    headline: "أربع مراحل من البيانات الخام إلى العينة",
    body: kpiBand([
      kpiTile({ label: "مُستلم", value: fmtNum(m.rawRows), sub: "صفوف خام", tone: "slate" }),
      kpiTile({ label: "مُعالج", value: fmtNum(m.processedRows), sub: `${fmtNum(m.removed)} محذوف`, tone: "blue" }),
      kpiTile({ label: "مسحوب", value: fmtNum(m.totalActual), sub: `${fmtPct(m.coverage)} تغطية`, tone: "gold" }),
      kpiTile({ label: "الإنجاز", value: fmtPct(m.fulfillment), sub: `${fmtNum(m.totalRequested)} مطلوب`, tone: "green" }),
    ]),
    decision: "يؤكد اكتمال سلسلة العينة من المصدر حتى السحب النهائي.",
  }));

  // 2 — received vs processed + source donut.
  slides.push(slide({
    id: "s-deck-proc", title: "الاستلام والمعالجة", num: 2, total,
    eyebrow: "المرحلة 1–2", iconName: "scan",
    headline: "التصفية والتصنيف حسب المصدر",
    body: split(
      heroNumber({ value: fmtNum(m.processedRows), caption: "صف بعد المعالجة", sub: `${fmtNum(m.removed)} صف محذوف أثناء التصفية والمطابقة`, tone: "blue" }),
      heroChart(donut([
        { label: "Risk", value: m.riskCount },
        { label: "BI مطابق", value: m.biCount },
      ], { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "المصدر: Risk مقابل BI" }),
    ),
    decision: "يوضح جاهزية البيانات ونسبة الإثراء من BI قبل السحب.",
  }));

  // 3 — stratification by port.
  const topPorts = m.ports.slice(0, 8);
  slides.push(slide({
    id: "s-deck-ports", title: "التصنيف حسب المنفذ", num: 3, total,
    eyebrow: "المرحلة 3", iconName: "port",
    headline: "التوزيع الطبقي حسب المنفذ (Hamilton)",
    body: topPorts.length === 0
      ? emptyBody()
      : split(
          miniTable({
            headers: ["المنفذ", "المجتمع", "المخصص", "العينة", "التغطية"],
            rows: topPorts.map((p) => [p.portName, fmtNum(p.population), p.allocatedQuota === null ? null : fmtNum(p.allocatedQuota), fmtNum(p.sample), fmtPct(p.coverage)]),
          }),
          heroChart(rankedBar(topPorts.map((p) => ({ label: p.portName, value: Math.round(p.coverage ?? 0) })), { height: 300, emptyNote: "لا توجد بيانات" }), { height: 300, caption: "التغطية٪ لكل منفذ (الأعلى)" }),
          "wide-left",
        ),
    decision: "يبرز المنافذ الأعلى تغطيةً وتلك التي تحتاج مراجعة الحصص.",
  }));

  // 4 — stages.
  slides.push(slide({
    id: "s-deck-stages", title: "المستويات", num: 4, total,
    eyebrow: "المرحلة 3", iconName: "layers",
    headline: "توزيع العينة على المستويات",
    body: miniTable({
      headers: ["المستوى", "المجتمع", "المستهدف", "المسحوب", "التغطية"],
      rows: m.stages.map((s) => [stageLabel(s.stageKey), fmtNum(s.populationSize), s.targetQuota > 0 ? fmtNum(s.targetQuota) : null, fmtNum(s.actualDrawn), fmtPct(ratePct(s.actualDrawn, s.populationSize))]),
    }),
    decision: "يضمن تمثيل كل مستوى وفق حصته المستهدفة.",
  }));

  // 5 — drawn result.
  slides.push(slide({
    id: "s-deck-drawn", title: "العينة المسحوبة", num: 5, total,
    eyebrow: "المرحلة 4", iconName: "check",
    headline: "العينة النهائية المختارة للدراسة",
    body: kpiBand([
      kpiTile({ label: "الإجمالي", value: fmtNum(m.totalActual), tone: "gold" }),
      kpiTile({ label: "CertScan", value: fmtNum(m.certScanActual), tone: "blue" }),
      kpiTile({ label: "NonCertScan", value: fmtNum(m.nonCertScanActual), tone: "cyan" }),
      kpiTile({ label: "التغطية", value: fmtPct(m.coverage), tone: "green" }),
    ]) + numberedList([
      `سُحبت ${fmtNum(m.totalActual)} صورة من مجتمع ${fmtNum(m.processedRows)} بتغطية ${fmtPct(m.coverage)}.`,
      `نسبة إنجاز الحصة المطلوبة ${fmtPct(m.fulfillment)} (${fmtNum(m.totalRequested)} مطلوب).`,
      `البذرة العشوائية المستخدمة للسحب: ${m.rngSeed}.`,
    ]),
    decision: "يعتمد العينة النهائية أساساً للتوزيع والدراسة.",
  }));

  return slides.join("\n");
}

function emptyBody(): string {
  return `<div class="deck-empty"><span class="deck-empty-icon">${icon("alert", 36)}</span><b>لا توجد بيانات منافذ</b><span>لم تُسجَّل مخصصات منافذ لهذه العينة.</span></div>`;
}

// ─── Public string builders ───────────────────────────────────────────────────

export function buildSampleDocument(input: SampleReportInput): string {
  const m = computeSampleLineage(input);
  const preview: (string | number | null)[][] = input.sample.rows.slice(0, 60).map((r) => [
    r.xrayImageId, r.portName ?? "—", r.stage ?? "—", r.certScanStatus,
    r.biEnrichmentStatus, r.xrayLevelOneResult, r.xrayLevelTwoResult,
  ]);
  return buildDocViewer({
    slides: sampleDocPages(m, formatIssueDate(), preview),
    docTitle: `تقرير العينة — ${m.monthLabel}`,
    brandTitle: "تقرير العينة",
    brandSub: `ضمان جودة الأشعة — ${m.monthLabel}`,
    iconName: "layers",
    footerNote: sourceRevisionsFooterHtml(input.sourceRevisions, deckEsc),
  });
}

export function buildSampleDeck(input: SampleReportInput): string {
  const m = computeSampleLineage(input);
  return buildDeckViewer({
    slides: sampleDeckSlides(m),
    docTitle: `عرض العينة — ${m.monthLabel}`,
    brandTitle: "عرض العينة",
    brandSub: `ضمان جودة الأشعة — ${m.monthLabel}`,
    iconName: "layers",
    footerNote: sourceRevisionsFooterHtml(input.sourceRevisions, deckEsc),
  });
}

export function buildSampleXlsx(input: SampleReportInput): void {
  const m = computeSampleLineage(input);
  const { populationRows, sample } = input;
  const sampledIds = new Set(sample.rows.map((r) => r.xrayImageId));

  // Sheet 1 — Lineage summary (received → processed → strata → drawn).
  const summary: (string | number)[][] = [
    ["التقرير", "تقرير العينة — المسار الكامل"],
    ["الشهر", m.monthLabel],
    ["تاريخ السحب", m.drawnAt],
    ["بواسطة", m.drawnBy],
    ["البذرة العشوائية", m.rngSeed],
    [],
    ["— 1 · الاستلام —", ""],
    ["البيانات الخام", m.rawRows],
    ["— 2 · المعالجة —", ""],
    ["بعد المعالجة", m.processedRows],
    ["محذوف", m.removed],
    ["مصدر Risk", m.riskCount],
    ["مصدر BI مطابق", m.biCount],
    ["CertScan", m.certCount],
    ["NonCertScan", m.nonCertCount],
    ["— 3 · التصنيف الطبقي —", ""],
    ["عدد المنافذ", m.ports.length],
    ["إجمالي المطلوب (الحصص)", m.totalRequested],
    ["— 4 · السحب —", ""],
    ["إجمالي العينة المسحوبة", m.totalActual],
    ["CertScan المسحوب", m.certScanActual],
    ["NonCertScan المسحوب", m.nonCertScanActual],
    ["التغطية٪", m.coverage === null ? "" : +m.coverage.toFixed(2)],
    ["الإنجاز٪", m.fulfillment === null ? "" : +m.fulfillment.toFixed(2)],
  ];

  // Sheet 2 — Received (full population as ingested markers).
  const received: (string | number)[][] = [
    ["رقم الأشعة", "المنفذ", "المستوى", "CertScan", "مصدر BI", "م.أول", "م.ثاني", "في العينة", "تاريخ الدخول", "رقم البيان"],
    ...populationRows.map((r) => [
      r.xrayImageId, r.portName ?? "", r.stage ?? "", r.certScanStatus, r.biEnrichmentStatus,
      r.xrayLevelOneResult, r.xrayLevelTwoResult, sampledIds.has(r.xrayImageId) ? "نعم" : "لا",
      r.xrayEntryDate ?? "", r.declarationNumber ?? "",
    ]),
  ];

  // Sheet 3 — Processed classification.
  const processed: (string | number)[][] = [
    ["التصنيف", "الفئة", "العدد", "النسبة٪"],
    ["المصدر", "Risk", m.riskCount, pctCell(ratePct(m.riskCount, m.processedRows))],
    ["المصدر", "BI مطابق", m.biCount, pctCell(ratePct(m.biCount, m.processedRows))],
    ["نوع الفحص", "CertScan", m.certCount, pctCell(ratePct(m.certCount, m.processedRows))],
    ["نوع الفحص", "NonCertScan", m.nonCertCount, pctCell(ratePct(m.nonCertCount, m.processedRows))],
  ];

  // Sheet 4 — Strata / quotas by port.
  const strata: (string | number)[][] = [
    ["المنفذ", "المجتمع", "Risk", "BI", "CertScan", "NonCertScan", "المخصص", "Cert مسحوب", "NonCert مسحوب", "العينة", "التغطية٪"],
    ...m.ports.map((p) => [
      p.portName, p.population, p.riskRows, p.biRows, p.certScan, p.nonCertScan,
      p.allocatedQuota ?? 0, p.actualCertScanDrawn ?? 0, p.actualNonCertScanDrawn ?? 0,
      p.sample, pctCell(p.coverage),
    ]),
  ];

  // Sheet 5 — Stage allocation.
  const stages: (string | number)[][] = [
    ["المستوى", "المجتمع", "المستهدف", "المسحوب", "CertScan", "NonCertScan", "التغطية٪"],
    ...m.stages.map((s) => [
      stageLabel(s.stageKey), s.populationSize, s.targetQuota, s.actualDrawn,
      s.certScanDrawn, s.nonCertScanDrawn, pctCell(ratePct(s.actualDrawn, s.populationSize)),
    ]),
  ];

  // Sheet 6 — Drawn sample (the final chosen rows, full detail).
  const drawn: (string | number)[][] = [
    ["رقم الأشعة", "المنفذ", "المستوى", "CertScan", "مصدر BI", "م.أول", "م.ثاني", "تاريخ الدخول", "رقم البيان", "نوع الحركة", "رسالة Risk"],
    ...sample.rows.map((r) => [
      r.xrayImageId, r.portName ?? "", r.stage ?? "", r.certScanStatus, r.biEnrichmentStatus,
      r.xrayLevelOneResult, r.xrayLevelTwoResult, r.xrayEntryDate ?? "", r.declarationNumber ?? "",
      r.movementType ?? "", r.riskMessage ?? "",
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "المسار — ملخص");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(received), "1 · الاستلام");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(processed), "2 · المعالجة");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(strata), "3 · الطبقات");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stages), "3 · المستويات");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drawn), "4 · العينة المسحوبة");
  if (hasSourceRevisions(input.sourceRevisions)) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(sourceRevisionsSheetAoa(input.sourceRevisions)),
      SOURCE_REVISIONS_SHEET_NAME_AR
    );
  }

  XLSX.writeFile(wb, `تقرير_العينة_${input.monthFolderName}.xlsx`);
}

/** Percentage cell for the workbook: blank on empty denominator, never `0%`. */
function pctCell(value: number | null): string | number {
  return value === null ? "" : +value.toFixed(2);
}

// ─── Open / download helpers ──────────────────────────────────────────────────

export function openSampleReport(input: SampleReportInput): void {
  openOrDownload(buildSampleDocument(input), `تقرير_العينة_${input.monthFolderName}.html`);
}

export function openSampleDeck(input: SampleReportInput): void {
  openOrDownload(buildSampleDeck(input), `عرض_العينة_${input.monthFolderName}.html`);
}
