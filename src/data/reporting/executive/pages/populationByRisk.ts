import type { ExecutiveRenderContext } from "../context";
import { esc, fmtNum } from "../primitives";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function portTypeFromRows(rows: ExecutiveReportRow[]): Map<string, "land" | "sea"> {
  const m = new Map<string, "land" | "sea">();
  for (const r of rows) {
    if (r.portName && r.portType) m.set(r.portName, r.portType as "land" | "sea");
  }
  return m;
}

export function buildPopulationByRisk(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const portTypeMap = portTypeFromRows(ctx.rows);

  // Classify ports: prefer ctx.rows portType, fall back to name heuristic
  const landPorts = kpis.portProfiles.filter(p => {
    const t = portTypeMap.get(p.portName);
    if (t) return t === "land";
    return !p.portName.includes("ميناء");
  }).sort((a, b) => b.population - a.population);

  const seaPorts = kpis.portProfiles.filter(p => {
    const t = portTypeMap.get(p.portName);
    if (t) return t === "sea";
    return p.portName.includes("ميناء");
  }).sort((a, b) => b.population - a.population);

  const landTotal       = landPorts.reduce((s, p) => s + p.population, 0);
  const seaTotal        = seaPorts.reduce((s, p) => s + p.population, 0);
  const landCleanTotal  = landPorts.reduce((s, p) => s + p.clean, 0);
  const seaCleanTotal   = seaPorts.reduce((s, p) => s + p.clean, 0);
  const landSuspTotal   = landPorts.reduce((s, p) => s + p.suspicious, 0);
  const seaSuspTotal    = seaPorts.reduce((s, p) => s + p.suspicious, 0);

  const portRow = (p: typeof kpis.portProfiles[0]) =>
    `<tr>
      <td title="${esc(p.portName)}">${esc(p.portName)}</td>
      <td>${fmtNum(p.population)}</td>
      <td>${fmtNum(p.clean)}</td>
      <td>${fmtNum(p.suspicious)}</td>
    </tr>`;

  // Truncate to 8 rows max
  const landRows = landPorts.slice(0, 8);
  const seaRows  = seaPorts.slice(0, 8);
  const landMore  = landPorts.length > 8 ? `<tr class="muted-row"><td colspan="4">... ${fmtNum(landPorts.length - 8)} أخرى</td></tr>` : "";
  const seaMore   = seaPorts.length  > 8 ? `<tr class="muted-row"><td colspan="4">... ${fmtNum(seaPorts.length - 8)} أخرى</td></tr>` : "";

  const hasAnyPorts = kpis.portProfiles.length > 0;

  const portSplitHtml = hasAnyPorts
    ? `<div class="port-split">
      <div class="card land">
        <div class="panel-title">المنافذ البرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${landRows.map(portRow).join("")}
            ${landMore}
            ${landPorts.length > 0
              ? `<tr class="total-row"><td>الإجمالي</td><td>${fmtNum(landTotal)}</td><td>${fmtNum(landCleanTotal)}</td><td>${fmtNum(landSuspTotal)}</td></tr>`
              : `<tr class="total-row"><td colspan="4"><span class="muted">لا توجد منافذ برية</span></td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card sea">
        <div class="panel-title">المنافذ البحرية</div>
        <div class="table-wrap"><table>
          <thead><tr><th>المنفذ</th><th>الإجمالي</th><th>سليمة</th><th>اشتباه</th></tr></thead>
          <tbody>
            ${seaRows.map(portRow).join("")}
            ${seaMore}
            ${seaPorts.length > 0
              ? `<tr class="total-row"><td>الإجمالي</td><td>${fmtNum(seaTotal)}</td><td>${fmtNum(seaCleanTotal)}</td><td>${fmtNum(seaSuspTotal)}</td></tr>`
              : `<tr class="total-row"><td colspan="4"><span class="muted">لا توجد منافذ بحرية</span></td></tr>`}
          </tbody>
        </table></div>
      </div>
    </div>`
    : `<div class="notice-centered"><div>لم يتم معالجة بيانات المجتمع بعد — يُرجى استيراد ملف بيانات المخاطر وإجراء المعالجة لعرض توزيع المنافذ.</div></div>`;

  return `<section class="page" id="page-pop-risk" data-title="مجتمع حالات المخاطر">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab active">مجتمع المخاطر</div>
    <div class="rail-tab">المستويات</div>
    <div class="rail-tab">العينة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مجتمع حالات المخاطر</h2>
    <div class="section-subtitle">توزيع المجتمع بحسب نوع المنفذ والمنافذ التابعة له</div>
    <div class="grid grid-3">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">${fmtNum(kpis.totalPopulation)}</div></div>
      <div class="card"><h3>المنافذ البرية</h3><div class="metric green">${fmtNum(landTotal)}</div></div>
      <div class="card"><h3>المنافذ البحرية</h3><div class="metric blue">${fmtNum(seaTotal)}</div></div>
    </div>
    <div class="info" style="margin:16px 0">منهجية التصنيف: تُعد الحالة اشتباه إذا كانت نتيجة المستوى الأول أو المستوى الثاني = اشتباه، وفي غير ذلك تُصنف سليمة.</div>
    <div class="page-fill">
      ${portSplitHtml}
      <div class="context-band">
        <div class="card">
          <div class="panel-title">منهجية تصنيف المجتمع</div>
          <ul class="method-list">
            <li>تُصنّف الحالة "اشتباه" إذا كانت نتيجة المستوى الأول أو الثاني = اشتباه، وإلا فهي "سليمة".</li>
            <li>يُقسّم المجتمع حسب نوع المنفذ (بري/بحري) ثم حسب المنفذ التابع له.</li>
            <li>تُرتّب المنافذ تنازليًا بحسب حجم المجتمع، وتُختصر القوائم الطويلة مع بيان العدد المتبقي.</li>
            <li>تُستخدم هذه الأرقام كأساس لحساب العينة ونِسب التغطية في الصفحات التالية.</li>
          </ul>
        </div>
        <div class="card">
          <div class="panel-title">ملخّص المجتمع</div>
          <div class="stat-stack">
            <div class="stat-pill"><span>إجمالي المنافذ</span><b>${fmtNum(landPorts.length + seaPorts.length)}</b></div>
            <div class="stat-pill"><span>منافذ برية</span><b>${fmtNum(landPorts.length)}</b></div>
            <div class="stat-pill"><span>منافذ بحرية</span><b>${fmtNum(seaPorts.length)}</b></div>
            <div class="stat-pill"><span>إجمالي المجتمع</span><b>${fmtNum(kpis.totalPopulation)}</b></div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-no">05</div>
  </div>
</section>`;
}
