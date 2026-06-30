// Part 3 — Corroboration (cross-team). A reviewer-focused page (each team vs the
// QA reviewer) and a full N×N agreement-matrix page. Other teams shown by answer
// only — no employee breakdown. The Employee Agreement Matrix is intentionally
// removed (master §12). Driven from ReportModel.resultComparison.

import type { ReportModel } from "../model/reportModel";
import type { ResultSource } from "../model/decisionFactTable";
import type { Matrix } from "../ui/charts";
import { heatmap, rankedBar } from "../ui/charts";
import { fmtNum, fmtPct } from "../primitives";
import {
  executiveClose,
  emptyState,
  figure,
  kpi,
  kpiStrip,
  noteBox,
  page,
  pageHeader,
  panel,
} from "./shared";
import { dataTable } from "./pagination";
import { corroborationClose } from "./narrative";

const TABS = ["الجزء الثالث", "الجزء الأول", "الجزء الثاني", "الجزء الرابع", "الجزء الخامس"];

const SOURCE_LABEL: Record<ResultSource, string> = {
  levelOne: "المستوى الأول",
  levelTwo: "المستوى الثاني",
  manual: "اليدوي",
  opposite: "المعاكس",
  liveMeans: "الوسائل الحية",
  review: "المراجع",
};

export function buildReviewerAgreement(model: ReportModel, pageNo: string): string {
  const rows = model.resultComparison.reviewerAgreement;
  const reporting = rows.filter((r) => r.comparable > 0);
  const ranked = [...reporting].sort((a, b) => (b.agreementRate ?? -1) - (a.agreementRate ?? -1));
  const topTeam = ranked[0] ? SOURCE_LABEL[ranked[0].source] : null;
  const topRate = ranked[0]?.agreementRate ?? null;

  const bars = reporting.map((r) => ({ label: SOURCE_LABEL[r.source], value: r.agreementRate ?? 0 }));

  const tableRows = rows.map((r) => [
    SOURCE_LABEL[r.source],
    r.comparable === 0 ? null : fmtNum(r.comparable),
    r.comparable === 0 ? null : fmtNum(r.agree),
    r.comparable === 0 ? null : fmtPct(r.agreementRate),
    r.comparable === 0 ? null : fmtNum(r.teamClearedReviewerFlagged),
  ]);

  const body = `${pageHeader({ iconName: "users", eyebrow: "الجزء الثالث · التطابق", title: "كل فريق مقابل المراجع", subtitle: "الفرق الأخرى دليل مساند لا محل تدقيق" })}
    ${kpiStrip([
      kpi({ label: "فرق قدّمت نتائج", value: fmtNum(reporting.length), tone: "gold" }),
      kpi({ label: "أعلى توافق", value: topTeam ?? "—", tone: "green" }),
      kpi({ label: "نسبة أعلى توافق", value: fmtPct(topRate), tone: "blue" }),
    ], 3)}
    ${reporting.length === 0
      ? emptyState("لا توجد مقارنة كافية", "لم تقدّم الفرق الأخرى نتائج قابلة للمقارنة مع المراجع هذه الفترة.")
      : `<div class="grid grid-2" style="margin-top:14px">
          ${panel("توافق الفرق مع المراجع", figure(rankedBar(bars, { width: 360 }), { height: 220 }), { iconName: "chart" })}
          ${panel("حيث اختلفت المستويات عن المراجع", dataTable({
            headers: ["الفريق", "قابل للمقارنة", "متفق", "نسبة التوافق", "فاتها الاشتباه"],
            rows: tableRows,
          }))}
        </div>`}
    ${executiveClose(corroborationClose(reporting.length, topTeam, topRate))}`;
  return page({ id: "page-corrob", title: "كل فريق مقابل المراجع", pageNo, railTabs: TABS, body });
}

export function buildAgreementMatrix(model: ReportModel, pageNo: string): string {
  const cells = model.resultComparison.crossTeamMatrix;
  const SOURCES: ResultSource[] = ["levelOne", "levelTwo", "manual", "opposite", "liveMeans", "review"];
  const labels = SOURCES.map((s) => SOURCE_LABEL[s]);

  // Symmetric matrix of agreement rates; diagonal null (self vs self omitted).
  const values: (number | null)[][] = SOURCES.map((a, i) =>
    SOURCES.map((b, j) => {
      if (i === j) return null;
      const cell = cells.find(
        (c) =>
          (c.sourceA === a && c.sourceB === b) || (c.sourceA === b && c.sourceB === a),
      );
      return cell ? cell.agreementRate : null;
    }),
  );

  const matrix: Matrix = { rows: labels, cols: labels, values };
  const any = cells.some((c) => c.comparable > 0);

  // strongest / weakest comparable pair
  const comparablePairs = cells.filter((c) => c.comparable > 0 && c.agreementRate !== null);
  const strongest = [...comparablePairs].sort((a, b) => (b.agreementRate as number) - (a.agreementRate as number))[0];
  const weakest = [...comparablePairs].sort((a, b) => (a.agreementRate as number) - (b.agreementRate as number))[0];
  const pairLabel = (c: typeof strongest): string =>
    c ? `${SOURCE_LABEL[c.sourceA]} ↔ ${SOURCE_LABEL[c.sourceB]}` : "—";

  const body = `${pageHeader({ iconName: "chart", eyebrow: "الجزء الثالث · التطابق", title: "مصفوفة التطابق الكاملة", subtitle: "كل مصدر مقابل الآخر (تشمل الأول مقابل الثاني)" })}
    ${kpiStrip([
      kpi({ label: "أقوى تطابق", value: pairLabel(strongest), tone: "green" }),
      kpi({ label: "أضعف تطابق", value: pairLabel(weakest), tone: "coral" }),
    ], 2)}
    <div class="page-fill" style="margin-top:14px">
      ${any
        ? panel("مصفوفة نسب التطابق (N×N)", figure(heatmap(matrix, { width: 460, height: 280 }), { height: 300 }), { fill: true, iconName: "chart" })
        : emptyState("لا تتوفر بيانات تطابق", "لم تتوفر نتائج كافية لبناء مصفوفة المقارنة هذه الفترة.")}
    </div>
    ${noteBox('الخلايا تعرض نسبة التطابق فقط حين تتوفر نتيجة لكلا المصدرين؛ غير ذلك تُعرض "—".')}
    ${executiveClose({
      shows: strongest ? `أقوى تطابق بين ${pairLabel(strongest)} وأضعفه بين ${pairLabel(weakest)}.` : "لا توجد أزواج قابلة للمقارنة هذه الفترة.",
      matters: "مواضع تفرّد قرارات المستويين عن بقية المصادر تستحق مراجعة أدق.",
      action: "مراجعة الحالات التي تنفرد فيها قرارات المستويين عن جميع الفرق الأخرى.",
    })}`;
  return page({ id: "page-matrix", title: "مصفوفة التطابق الكاملة", pageNo, railTabs: TABS, body });
}
