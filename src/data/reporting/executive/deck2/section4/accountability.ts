// Executive deck v2 — القسم 4 · صفحة: المساءلة التشغيلية.
//
// R4 deck parity (2026-08-08, owner requirement — see `coverage.ts`'s doc
// comment for the section's shared rationale). Reuses
// `model.accountabilityProgress` (built ONCE by `computeManagementModel`, the
// R3 management report's own pure model function) VERBATIM — this file never
// refolds `DistributionCurrentData`/`DistributionEvent[]` or recomputes a
// completion rate itself. Mirrors `document/partCoverageAccountability.ts`'s
// `buildAccountabilitySection`, restyled for the deck's fixed-height slide.
//
// ── Per-employee progress, aggregated across buckets ────────────────────────
// The document edition only ever shows accountability at BUCKET grain (top
// ports). The deck task explicitly asks for "per-employee progress" — the
// owner's own example was "this employee finished X% of the sample in this
// bucket" (see `managementModel.ts`'s doc comment), but a single flat
// per-employee row is the more useful deck-level summary: one figure per
// person, not one per (person, port) pair. `ManagementBucket.employees` is
// keyed per-bucket, so this page folds every port bucket's employee entries
// into ONE per-username total (assigned/completed summed across all ports) —
// this is a re-aggregation of numbers `computeManagementModel` already
// computed (summing its own output), not a re-derivation of progress logic
// from the raw distribution data, so it stays honest to the "one fold"
// discipline: the source of truth for what counts as assigned/completed per
// (employee, port) pair is still `computeManagementModel` alone.
//
// ── Caps, never silent ───────────────────────────────────────────────────
// Employee count is normally small (organization headcount, not image
// count), but is not bounded by this model, so both the per-employee table
// and the replacement-reasons table cap their rows with an honest folded
// remainder row — same discipline as `coverage.ts`'s port-bucket cap.

import type { ReportModel } from "../../model/reportModel";
import type { ManagementBucket } from "../../../management/managementModel";
import { esc, fmtNum } from "../../primitives";
import { icon } from "../../ui/icons";
import { briefingSupport, ledgerIdx, ledgerPortCard, pctCell, v2Slide } from "../slideKit";
import type { SlideBuilder } from "../slideKit";

const EMPLOYEE_TABLE_SPAN = 4;
const REASON_TABLE_SPAN = 2;

/** Employee rows beyond this rank (by assigned, desc) fold into one
 *  remainder row — mirrors `coverage.ts`'s `PORT_BUCKET_CAP`. */
export const EMPLOYEE_ROW_CAP = 10;
const REASON_ROW_CAP = 8;

type EmployeeTotal = { username: string; displayName: string; assigned: number; completed: number };

/** Sums every port bucket's per-employee entries into one row per username.
 *  Ties → username ascending, matching `computeManagementModel`'s own
 *  within-bucket tie-break so ordering stays deterministic. */
function aggregateEmployees(byPort: ManagementBucket[]): EmployeeTotal[] {
  const byUser = new Map<string, EmployeeTotal>();
  for (const bucket of byPort) {
    for (const e of bucket.employees) {
      let t = byUser.get(e.username);
      if (!t) {
        t = { username: e.username, displayName: e.displayName, assigned: 0, completed: 0 };
        byUser.set(e.username, t);
      }
      t.assigned += e.assigned;
      t.completed += e.completed;
    }
  }
  return [...byUser.values()].sort(
    (a, b) => b.assigned - a.assigned || a.username.localeCompare(b.username),
  );
}

function rateOf(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null;
}

function employeeRow(e: EmployeeTotal, i: number): string {
  return (
    `<tr><td>${ledgerIdx(i)}${esc(e.displayName)}</td>` +
    `<td>${fmtNum(e.assigned)}</td><td>${fmtNum(e.completed)}</td><td>${pctCell(rateOf(e.completed, e.assigned))}</td></tr>`
  );
}

function foldedEmployeeRow(folded: EmployeeTotal[], rowIdx: number): string {
  const assigned = folded.reduce((s, e) => s + e.assigned, 0);
  const completed = folded.reduce((s, e) => s + e.completed, 0);
  return (
    `<tr class="v2-acc-fold-row"><td>${ledgerIdx(rowIdx)}الباقي (${fmtNum(folded.length)} موظف)</td>` +
    `<td>${fmtNum(assigned)}</td><td>${fmtNum(completed)}</td><td>${pctCell(rateOf(completed, assigned))}</td></tr>`
  );
}

function employeeTable(byPort: ManagementBucket[]): string {
  const all = aggregateEmployees(byPort);
  const shown = all.slice(0, EMPLOYEE_ROW_CAP);
  const folded = all.slice(EMPLOYEE_ROW_CAP);
  const totalAssigned = all.reduce((s, e) => s + e.assigned, 0);
  const totalCompleted = all.reduce((s, e) => s + e.completed, 0);
  const bodyRowsHtml =
    shown.map((e, i) => employeeRow(e, i)).join("") +
    (folded.length > 0 ? foldedEmployeeRow(folded, shown.length) : "");
  return ledgerPortCard({
    title: "تقدّم الموظفين",
    theadCells: `<th>الموظف</th><th>المعيّنة</th><th>المكتملة</th><th>الإنجاز</th>`,
    bodyRowsHtml,
    totalsRowHtml: `<tr><td>الإجمالي</td><td>${fmtNum(totalAssigned)}</td><td>${fmtNum(totalCompleted)}</td><td>${pctCell(rateOf(totalCompleted, totalAssigned))}</td></tr>`,
    span: EMPLOYEE_TABLE_SPAN,
    rowCount: 0,
    compact: false,
    extraClass: "acc-employee",
    emptyText: "لا يوجد موظفون مُعيَّنون بعد.",
  });
}

function reasonRows(byReason: Array<{ reason: string; count: number }>): { bodyRowsHtml: string; totalsRowHtml: string } {
  const shown = byReason.slice(0, REASON_ROW_CAP);
  const folded = byReason.slice(REASON_ROW_CAP);
  const total = byReason.reduce((s, r) => s + r.count, 0);
  const bodyRowsHtml =
    shown.map((r) => `<tr><td>${esc(r.reason)}</td><td>${fmtNum(r.count)}</td></tr>`).join("") +
    (folded.length > 0
      ? `<tr class="v2-acc-fold-row"><td>أسباب أخرى (${fmtNum(folded.length)})</td><td>${fmtNum(folded.reduce((s, r) => s + r.count, 0))}</td></tr>`
      : "");
  return {
    bodyRowsHtml,
    totalsRowHtml: `<tr><td>الإجمالي</td><td>${fmtNum(total)}</td></tr>`,
  };
}

function reasonsTable(byReason: Array<{ reason: string; count: number }>): string {
  const { bodyRowsHtml, totalsRowHtml } = reasonRows(byReason);
  return ledgerPortCard({
    title: "أسباب الاستبدال",
    theadCells: `<th>السبب</th><th>العدد</th>`,
    bodyRowsHtml,
    totalsRowHtml,
    span: REASON_TABLE_SPAN,
    rowCount: 0,
    compact: false,
    extraClass: "acc-reasons",
    emptyText: "لا توجد استبدالات موثّقة بسبب هذا الشهر.",
  });
}

/** No distribution exists yet for the month — same honest empty state family
 *  as `coverage.ts`'s. */
function emptyAccountabilityBody(): string {
  return `<div class="v2-cov-empty">
    <span class="v2-cov-empty-icon">${icon("flag", 24)}</span>
    <b>لا يوجد توزيع لهذا الشهر بعد</b>
    <p>يُبنى هذا القسم من بيانات تقرير الإدارة — وزّع العيّنة على الموظفين أولاً ليظهر هنا.</p>
  </div>`;
}

/**
 * Page: المساءلة التشغيلية (R3 reuse) — per-employee progress (aggregated
 * across every port bucket), replacement counts with their recorded reasons,
 * and the reassignment count. Single variant, same rationale as
 * `coverage.ts`'s `coverageSlide`.
 */
export function accountabilitySlide(
  model: ReportModel,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const acc = model.accountabilityProgress;
  const body =
    acc === null
      ? emptyAccountabilityBody()
      : `${briefingSupport([
          { iconName: "flag", value: fmtNum(acc.replacements.total), label: "إجمالي المستبدلة" },
          { iconName: "chart", value: fmtNum(acc.reassignments.total), label: "إعادة التعيين" },
          { iconName: "users", value: fmtNum(aggregateEmployees(acc.byPort).length), label: "موظف مُعيَّن" },
        ])}
        <div class="v2-acc-split">
          ${employeeTable(acc.byPort)}
          ${reasonsTable(acc.replacements.byReason)}
        </div>
        ${acc.reassignments.total === 0 && acc.replacements.total === 0
          ? `<div class="v2-acc-note"><span>${icon("alert", 13)}</span><span>لا توجد استبدالات أو إعادة تعيين مسجّلة لهذا الشهر — أو لم تُمرَّر سجلات الأحداث الخام لهذا التوليد.</span></div>`
          : ""}`;
  return v2Slide({
    id: "slide-s4-accountability",
    title: "المساءلة التشغيلية",
    eyebrow: "القسم 4 — التغطية والمساءلة التشغيلية",
    iconName: "flag",
    headline: "المساءلة التشغيلية",
    subhead:
      "تقدّم الموظفين، أسباب الاستبدال، وعدد إعادة التعيين — من تقرير الإدارة (R3)، بلا إعادة احتساب.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section4",
  });
}

export function accountabilitySlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  return [(num, total) => accountabilitySlide(model, num, total, variantPreview)];
}

export const ACCOUNTABILITY_CSS = `
/* ── القسم 4 · المساءلة التشغيلية ─────────────────────────────────────────── */
.v2-acc-split{display:grid;grid-template-columns:1.3fr 1fr;gap:14px;flex:1;min-height:0;margin-top:12px;}
.v2-acc-split .v2-lg-port-card{height:100%;min-height:0;overflow:auto;}
.v2-acc-fold-row td{color:var(--slate);font-style:italic;}

.v2-acc-note{
  display:flex;align-items:center;justify-content:center;gap:7px;text-align:center;
  margin-top:10px;font-size:.65rem;font-weight:700;line-height:1.5;color:var(--slate);
}
.v2-acc-note span:first-child{display:inline-flex;flex-shrink:0;color:var(--gold);}
.v2-acc-note span:first-child svg{display:block;}

body.theme-light .v2-acc-fold-row td{color:#607386;}

@media screen and (max-width:900px){
  .v2-acc-split{grid-template-columns:1fr;}
}
@media print{
  .v2-acc-split .v2-lg-port-card{break-inside:avoid;}
}
`;
