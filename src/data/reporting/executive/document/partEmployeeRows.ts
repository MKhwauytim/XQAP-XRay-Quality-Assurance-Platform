// Part 6b — per-employee row listing (R5, 2026-08-07 owner requirement: "the
// document version [should] show the samples itself and information port
// name level answers date etc per employee"). The executive `factTable`
// (`DecisionRecord[]`) already carries every field the owner asked for —
// port name, risk level (stage), the employee's own decision ("answer"), and
// a date — but was never rendered as a flat listing before this. Grouped by
// reviewer (`reviewerId`, workload context only — never treated as inspector
// accuracy per §3.4) and paginated/chunked with `yieldToMain()` so a large
// month's fact table (up to ~2x the population, one record per decision
// level) never locks the UI while these pages build.

import type { ReportModel } from "../model/reportModel";
import type { DecisionRecord } from "../model/decisionFactTable";
import { fmtNum } from "../primitives";
import { emptyState, page, pageHeader, panel } from "./shared";
import { paginateRows } from "./pagination";
import { yieldToMain } from "../../../storage/yieldToMain";

const TABS = ["الجزء السادس"];
const ROWS_PER_PAGE = 24;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function levelLabel(l: DecisionRecord["decisionLevel"]): string {
  return l === "LEVEL_1" ? "الأول" : l === "LEVEL_2" ? "الثاني" : String(l);
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9؀-ۿ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "emp";
}

/**
 * One (or more, if long) page per reviewer, each listing every fact-table row
 * they touched: image id, port name, risk level (stage), decision level
 * (L1/L2), the employee's answer, and a date (completed, falling back to
 * assigned). Unmapped rows (`reviewerId === null` — no app user recorded the
 * review) are excluded from the per-employee grouping; the section still
 * states the mapped/unmapped split so the gap is visible, not silent.
 */
export async function buildEmployeeRowListingPages(model: ReportModel, startPageNo: number): Promise<{ html: string[]; nextPageNo: number }> {
  const names = model.employeeOverview.reviewerDisplayNames;
  const byEmployee = new Map<string, DecisionRecord[]>();
  let unassignedCount = 0;
  for (const rec of model.factTable) {
    if (rec.reviewerId === null) { unassignedCount += 1; continue; }
    let list = byEmployee.get(rec.reviewerId);
    if (!list) { list = []; byEmployee.set(rec.reviewerId, list); }
    list.push(rec);
  }
  const employees = [...byEmployee.entries()].sort((a, b) =>
    (names[a[0]] ?? a[0]).localeCompare(names[b[0]] ?? b[0])
  );

  const html: string[] = [];
  let n = startPageNo;

  if (employees.length === 0) {
    html.push(page({
      id: "page-emp-rows", title: "قوائم الصفوف لكل موظف", pageNo: pad(n++), railTabs: TABS,
      body: `${pageHeader({ iconName: "user", eyebrow: "الجزء السادس · قوائم الصفوف", title: "قوائم الصفوف لكل موظف", subtitle: "رقم الأشعة، المنفذ، المستوى، الإجابة، والتاريخ لكل صف روجع." })}
        ${emptyState("لا توجد صفوف مرتبطة بموظف هذا الشهر.", unassignedCount > 0 ? `${fmtNum(unassignedCount)} صف بلا موظف معروف (مراجعة لم تُسجَّل بواسطة مستخدم).` : undefined)}`,
    }));
    return { html, nextPageNo: n };
  }

  for (const [reviewerId, records] of employees) {
    const displayName = names[reviewerId] ?? reviewerId;
    const sorted = [...records].sort((a, b) => (a.completedAt ?? a.assignedAt ?? "").localeCompare(b.completedAt ?? b.assignedAt ?? ""));
    const rows = sorted.map((r) => [
      r.xrayImageId, r.portName ?? "—", r.stage ?? "—", levelLabel(r.decisionLevel), r.employeeDecision, r.completedAt ?? r.assignedAt ?? "—",
    ]);
    const chunks = paginateRows({
      headers: ["رقم الأشعة", "المنفذ", "المستوى", "مرحلة القرار", "الإجابة", "التاريخ"],
      rows,
      rowsPerPage: ROWS_PER_PAGE,
    });
    for (let i = 0; i < chunks.length; i++) {
      html.push(page({
        id: `page-emp-rows-${slug(reviewerId)}-${i}`,
        title: i === 0 ? `صفوف الموظف — ${displayName}` : `صفوف الموظف — ${displayName} (${i + 1})`,
        pageNo: pad(n++),
        railTabs: TABS,
        body: `${pageHeader({ iconName: "user", eyebrow: "الجزء السادس · قوائم الصفوف", title: `صفوف الموظف — ${displayName}`, subtitle: `${fmtNum(records.length)} صف من إجمالي جدول الوقائع.` })}
          ${panel(displayName, chunks[i]!, { iconName: "user" })}`,
      }));
      await yieldToMain();
    }
  }

  return { html, nextPageNo: n };
}
