import type { ExecutiveRenderContext } from "../context";
import { esc, fmtNum, fmtPct } from "../primitives";
import {
  buildPortEmployeeAnalyses,
  type PortEmployeeGroup,
  type PortEmployeeAnalysis,
} from "../portEmployeeData";

const MAX_ROWS = 12; // truncate long employee lists

function slug(_portName: string, idx: number): string {
  // stable, ascii-safe id; fall back to index because Arabic ids are awkward in URLs
  return `page-port-emp-${idx}`;
}

function levelTable(
  ctx: ExecutiveRenderContext,
  group: PortEmployeeGroup,
  accentClass: string,
): string {
  if (group.employees.length === 0) {
    return `<div class="card ${accentClass}">
      <div class="panel-title">${esc(group.levelLabel)}</div>
      <div class="notice-centered"><div>لا يوجد موظفون في هذا المستوى لهذا المنفذ</div></div>
    </div>`;
  }
  const shown = group.employees.slice(0, MAX_ROWS);
  const more  = group.employees.length > MAX_ROWS
    ? `<tr class="muted-row"><td colspan="5">... ${fmtNum(group.employees.length - MAX_ROWS)} موظف آخر</td></tr>`
    : "";
  const totStudied = group.employees.reduce((s, e) => s + e.studied, 0);
  const totSusp    = group.employees.reduce((s, e) => s + e.suspicious, 0);
  const totClean   = group.employees.reduce((s, e) => s + e.clean, 0);
  const rows = shown.map(e => `<tr>
      <td>${esc(ctx.displayName(e.employeeId))}</td>
      <td>${fmtNum(e.studied)}</td>
      <td>${fmtNum(e.suspicious)}</td>
      <td>${fmtNum(e.clean)}</td>
      <td>${fmtPct(e.accuracy)}</td>
    </tr>`).join("");
  return `<div class="card ${accentClass}">
    <div class="panel-title">${esc(group.levelLabel)} — ${fmtNum(group.employees.length)} موظف</div>
    <div class="table-wrap"><table>
      <thead><tr><th>الموظف</th><th>المدروسة</th><th>اشتباه</th><th>سليمة</th><th>الدقة</th></tr></thead>
      <tbody>
        ${rows}${more}
        <tr class="total-row">
          <td>الإجمالي</td><td>${fmtNum(totStudied)}</td>
          <td>${fmtNum(totSusp)}</td><td>${fmtNum(totClean)}</td><td>—</td>
        </tr>
      </tbody>
    </table></div>
  </div>`;
}

function buildPortPage(
  ctx: ExecutiveRenderContext,
  a: PortEmployeeAnalysis,
  idx: number,
  total: number,
): string {
  const typeLabel = a.portType === "land" ? "بري" : "بحري";
  const typeCls   = a.portType === "land" ? "land" : "sea";
  const totalEmp  = new Set([
    ...a.levelOne.employees.map(e => e.employeeId),
    ...a.levelTwo.employees.map(e => e.employeeId),
  ]).size;
  return `<section class="page compact" id="${slug(a.portName, idx)}" data-title="أداء موظفي ${esc(a.portName)}">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>أداء الموظفين حسب المنفذ</em></div>
    <div class="rail-tab active">${esc(a.portName)}</div>
    <div class="rail-tab">${esc(typeLabel)}</div>
    <div class="rail-tab">${fmtNum(idx)}/${fmtNum(total)}</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين — ${esc(a.portName)}</h2>
    <div class="section-subtitle">موظفو المستوى الأول والثاني الذين درسوا حالات هذا المنفذ (${esc(typeLabel)})</div>
    <div class="grid grid-4">
      <div class="card ${typeCls}"><h3>نوع المنفذ</h3><div class="metric ${a.portType === "land" ? "green" : "blue"}" style="font-size:1.5rem">${esc(typeLabel)}</div></div>
      <div class="card"><h3>إجمالي حالات المنفذ</h3><div class="metric gold">${fmtNum(a.population)}</div></div>
      <div class="card"><h3>موظفو المستوى الأول</h3><div class="metric blue">${fmtNum(a.levelOne.employees.length)}</div></div>
      <div class="card"><h3>موظفو المستوى الثاني</h3><div class="metric slate">${fmtNum(a.levelTwo.employees.length)}</div></div>
    </div>
    <div class="info" style="margin:14px 0">الدقة% تُحتسب فقط على الحالات التي صدر بها رأي الخبير؛ "اشتباه/سليمة" تعكس النتيجة الأصلية للموظف في هذا المستوى. إجمالي الموظفين الفريدين: ${fmtNum(totalEmp)}.</div>
    <div class="port-split page-fill">
      ${levelTable(ctx, a.levelOne, "stage1")}
      ${levelTable(ctx, a.levelTwo, "stage2")}
    </div>
    <div class="page-no">${esc(String(16 + idx).padStart(2, "0"))}</div>
  </div>
</section>`;
}

/** Returns one page-builder closure per non-empty port (land first, then sea). */
export function buildPortEmployeeAnalysisPages(
  ctx: ExecutiveRenderContext,
): Array<(ctx: ExecutiveRenderContext) => string> {
  const analyses = buildPortEmployeeAnalyses(ctx.rows);
  if (analyses.length === 0) {
    // single graceful fallback page
    return [(_c) => `<section class="page compact" id="page-port-emp-empty" data-title="أداء الموظفين حسب المنفذ">
      <div class="right-rail">
        <div class="rail-main">الجزء الثالث <em>أداء الموظفين حسب المنفذ</em></div>
        <div class="rail-tab active">حسب المنفذ</div>
      </div>
      <div class="page-inner">
        <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
        <div class="section-subtitle">تحليل موظفي المستوى الأول والثاني لكل منفذ</div>
        <div class="notice-centered page-fill"><div>لا توجد بيانات موظفين كافية لهذه الفترة</div></div>
        <div class="page-no">17</div>
      </div>
    </section>`];
  }
  const total = analyses.length;
  return analyses.map((a, i) => (c: ExecutiveRenderContext) => buildPortPage(c, a, i + 1, total));
}
