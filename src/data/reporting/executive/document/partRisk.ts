// Part 5 — Risk, Priorities & Actions + Exclusions + Appendix.
// Error-type analysis, priority inspectors & actions, executive findings,
// exclusions page, and methodology / data-quality limitations appendix.
// Driven from ReportModel.

import type { ReportModel } from "../model/reportModel";
import { heatmap, stackedBars } from "../ui/charts";
import { icon } from "../ui/icons";
import type { Matrix } from "../ui/charts";
import { isRankable } from "../model/dataSufficiency";
import { fmtNum, fmtPct } from "../primitives";
import {
  executiveClose,
  figure,
  kpi,
  kpiStrip,
  noteBox,
  page,
  pageHeader,
  panel,
} from "./shared";
import { dataTable } from "./pagination";
import { errorClose } from "./narrative";

const TABS = ["الجزء الخامس", "الجزء الأول", "الجزء الثاني", "الجزء الثالث", "الجزء الرابع"];

export function buildErrorAnalysis(model: ReportModel, pageNo: string): string {
  const t = model.errorAnalysis.totals;
  const byPort = model.errorAnalysis.byPort;
  const stacked = stackedBars(
    {
      groups: ["النتائج"],
      series: [
        { label: "سليمة صحيحة", values: [t.correctClean] },
        { label: "اشتباه صحيح", values: [t.correctSuspicion] },
        { label: "اشتباه فائت", values: [t.missedSuspicion] },
        { label: "اشتباه خاطئ", values: [t.falseSuspicion] },
      ],
    },
    { width: 220, height: 200 },
  );

  // heatmap: port × error type (counts)
  const topPorts = [...byPort].sort((a, b) => b.evaluable - a.evaluable).slice(0, 6);
  const matrix: Matrix = {
    rows: topPorts.map((p) => p.key),
    cols: ["سليمة صحيحة", "اشتباه صحيح", "فائت", "خاطئ"],
    values: topPorts.map((p) => [p.correctClean, p.correctSuspicion, p.missedSuspicion, p.falseSuspicion]),
  };

  const body = `${pageHeader({ iconName: "alert", eyebrow: "الجزء الخامس · المخاطر", title: "تحليل أنواع الأخطاء", subtitle: "أين تتركّز الأخطاء" })}
    ${kpiStrip([
      kpi({ label: "سليمة صحيحة", value: fmtNum(t.correctClean), tone: "green" }),
      kpi({ label: "اشتباه صحيح", value: fmtNum(t.correctSuspicion), tone: "blue" }),
      kpi({ label: "اشتباه فائت", value: fmtNum(t.missedSuspicion), tone: "coral" }),
      kpi({ label: "اشتباه خاطئ", value: fmtNum(t.falseSuspicion), tone: "gold" }),
    ], 4)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("مزيج النتائج", figure(stacked, { height: 210 }), { iconName: "chart" })}
      ${panel("الأخطاء حسب المنفذ", figure(heatmap(matrix, { width: 360, height: 220 }), { height: 240 }), { iconName: "chart" })}
    </div>
    ${executiveClose(errorClose(t.missedSuspicion, t.falseSuspicion, t.evaluable))}`;
  return page({ id: "page-error", title: "تحليل أنواع الأخطاء", pageNo, railTabs: TABS, body });
}

export function buildPriorityActions(model: ReportModel, pageNo: string): string {
  const ports = model.portAccuracy
    .filter((p) => isRankable(p.band))
    .sort((a, b) => (b.missedSuspicionRate ?? -1) - (a.missedSuspicionRate ?? -1));
  const rows = ports.slice(0, 10).map((p) => [
    p.key,
    fmtPct(p.missedSuspicionRate),
    fmtPct(p.accuracy),
    p.missedSuspicionRate !== null && p.missedSuspicionRate > 5 ? "إجراء فوري" : "متابعة",
  ]);

  const actionCards = model.actions
    .slice(0, 6)
    .map((a) => `<div class="card doc-action"><span class="doc-close-icon">${icon("flag", 14)}</span><div>${escapeText(a)}</div></div>`)
    .join("");

  const body = `${pageHeader({ iconName: "flag", eyebrow: "الجزء الخامس · الإجراءات", title: "الأولويات والإجراءات", subtitle: "ما يحتاج قرارًا من القيادة" })}
    ${kpiStrip([
      kpi({ label: "منافذ تحتاج إجراء", value: fmtNum(ports.filter((p) => (p.missedSuspicionRate ?? 0) > 5).length), tone: "coral" }),
      kpi({ label: "منافذ للمتابعة", value: fmtNum(ports.filter((p) => (p.missedSuspicionRate ?? 0) <= 5).length), tone: "blue" }),
      kpi({ label: "اشتباه فائت إجمالي", value: fmtNum(model.errorAnalysis.totals.missedSuspicion), tone: "gold" }),
    ], 3)}
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      ${panel("أولوية المنافذ (حسب الاشتباه الفائت)", dataTable({ headers: ["المنفذ", "فائت", "الدقة", "الإجراء"], rows }), { iconName: "alert" })}
      ${panel("التوصيات", `<div class="doc-actions">${actionCards}</div>`, { iconName: "flag" })}
    </div>
    ${executiveClose({
      shows: `${fmtNum(model.errorAnalysis.totals.missedSuspicion)} اشتباه فائت موزّع على المنافذ.`,
      matters: "الاشتباه الفائت هو الخطر الأمني الذي يستوجب أولوية المعالجة.",
      action: "اعتماد الإجراءات الفورية للمنافذ ذات أعلى اشتباه فائت.",
    })}`;
  return page({ id: "page-priority", title: "الأولويات والإجراءات", pageNo, railTabs: TABS, body });
}

export function buildExclusions(model: ReportModel, pageNo: string): string {
  const body = `${pageHeader({ iconName: "document", eyebrow: "الجزء الخامس · الصدق", title: "الاستبعادات", subtitle: "الصفوف المستبعدة وأسبابها" })}
    ${kpiStrip([
      kpi({ label: "صور معالجة", value: fmtNum(model.population.total), tone: "green" }),
      kpi({ label: "قرارات قابلة للتقييم", value: fmtNum(model.dataQuality.evaluableDecisionRecords), tone: "gold" }),
      kpi({ label: "إجمالي القرارات", value: fmtNum(model.dataQuality.totalDecisionRecords), tone: "slate" }),
    ], 3)}
    <div class="page-fill" style="margin-top:14px">
      ${panel("ملاحظات الاستبعاد", `
        <ul class="doc-list">
          <li>${escapeText(model.exclusions.note)}</li>
          <li>القرارات غير القابلة للتقييم تُستبعد من حساب الدقة (لا صورة، أو لا نتيجة مراجع، أو لا هوية مفتش).</li>
          <li>نتائج الفرق الأخرى اختيارية؛ غيابها لا يستبعد الصورة، ويُعرض "—".</li>
        </ul>`, { fill: true, iconName: "document" })}
    </div>
    ${noteBox("تُوثَّق الصفوف المستبعدة بالتفصيل في تقرير معالجة المجتمع (processing.summary.json).")}`;
  return page({ id: "page-exclusions", title: "الاستبعادات", pageNo, railTabs: TABS, body });
}

export function buildAppendix(model: ReportModel, pageNo: string): string {
  const dq = model.dataQuality;
  const limitations = [
    dq.inspectorIdentityMapped ? "هوية المفتش مرتبطة عبر BI." : "هوية المفتش غير مرتبطة (لم تتم مطابقة BI) لهذه الفترة.",
    "تعدد المراجعين لم تُطبَّق له قاعدة تحكيم بعد (يُعرض كقيد).",
    "تصنيف النصوص الحرة معياري وصفي وليس تصنيفًا آليًا.",
    `النطاق الإجمالي لكفاية البيانات: ${bandLabel(dq.overallBand)}.`,
  ];

  const formulaRows = [
    ["دقة الفحص", "(سليمة صحيحة + اشتباه صحيح) ÷ القابل للتقييم"],
    ["معدل اكتشاف الاشتباه", "اشتباه صحيح ÷ (صحيح + فائت)"],
    ["الاشتباه الفائت", "فائت ÷ (صحيح + فائت)"],
    ["دقة قرار الاشتباه", "اشتباه صحيح ÷ (صحيح + خاطئ)"],
    ["الاشتباه الخاطئ", "خاطئ ÷ (سليمة صحيحة + خاطئ)"],
  ];

  const body = `${pageHeader({ iconName: "document", eyebrow: "الملحق", title: "المنهجية وجودة البيانات", subtitle: "القواعد الحسابية والقيود" })}
    <div class="grid grid-2 page-fill" style="margin-top:12px">
      ${panel("القواعد الحسابية", dataTable({ headers: ["المؤشر", "طريقة الحساب"], rows: formulaRows }), { iconName: "chart" })}
      ${panel("القيود وجودة البيانات", `<ul class="doc-list">${limitations.map((l) => `<li>${escapeText(l)}</li>`).join("")}</ul>`, { iconName: "alert" })}
    </div>
    ${noteBox("تُحتسب نسب التطابق فقط حيث تتوفر نتيجة لكلا المصدرين؛ القيم الناقصة تُعرض \"—\".")}`;
  return page({ id: "page-appendix", title: "المنهجية وجودة البيانات", pageNo, railTabs: TABS, body });
}

function bandLabel(b: string): string {
  return b === "sufficient" ? "كافٍ" : b === "limited" ? "محدود" : b === "insufficient" ? "غير كافٍ" : "لا توجد بيانات";
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
