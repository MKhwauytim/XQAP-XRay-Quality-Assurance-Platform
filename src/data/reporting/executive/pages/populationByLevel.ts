import type { ExecutiveRenderContext } from "../context";
import { esc, fmtNum } from "../primitives";

export function buildPopulationByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const stageColors = ['gold', 'blue', 'slate', 'coral'];
  const stageMetrics = kpis.stageProfiles.map((s, i) => `
    <div class="card stage${i+1}">
      <h3 style="color:var(--${stageColors[i] ?? 'gold'})">${esc(s.stageLabel)}</h3>
      <div class="metric ${stageColors[i] ?? 'gold'}">${fmtNum(s.population)}</div>
    </div>`).join('');

  const stageTableRows = kpis.stageProfiles.map((s, i) => `
    <div class="card stage${i+1}">
      <div class="panel-title">${esc(s.stageLabel)}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${kpis.portProfiles
            .filter(p => p.population > 0)
            .slice(0, 4)
            .map(p => `<tr><td>${esc(p.portName)}</td><td>—</td><td>—</td><td>${fmtNum(Math.round(p.population * s.population / Math.max(1, kpis.totalPopulation)))}</td></tr>`)
            .join('')}
          <tr class="total-row"><td>الإجمالي</td><td>—</td><td>—</td><td>${fmtNum(s.population)}</td></tr>
        </tbody>
      </table></div>
    </div>`).join('');

  return `<section class="page compact" id="page-pop-level" data-title="المجتمع حسب المستويات">
  <div class="right-rail">
    <div class="rail-main">الجزء الأول <em>مجتمع الحالات</em></div>
    <div class="rail-tab active">المستويات</div>
    <div class="rail-tab">المنافذ</div>
    <div class="rail-tab">العينة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مجتمع الحالات حسب المستويات والمنافذ</h2>
    <div class="section-subtitle">توزيع الحالات داخل كل مستوى بحسب المنافذ ونتائج الأشعة الأصلية</div>
    <div class="grid grid-5">
      <div class="card"><h3>إجمالي المجتمع</h3><div class="metric gold">${fmtNum(kpis.totalPopulation)}</div></div>
      ${stageMetrics}
    </div>
    <div class="grid grid-2" style="margin-top:18px">
      ${stageTableRows}
    </div>
    <div class="page-no">06</div>
  </div>
</section>`;
}
