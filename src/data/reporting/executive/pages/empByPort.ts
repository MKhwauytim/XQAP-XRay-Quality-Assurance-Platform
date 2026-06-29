import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";
import type { EmployeeProfile } from "../executiveEmployeeData";

function employeeChip(p: EmployeeProfile): string {
  if (!p.reliable) return '<span class="chip blue">بيانات غير كافية</span>';
  if (p.riskScore >= 30) return '<span class="chip red">أولوية تدخل</span>';
  if (p.riskScore >= 15) return '<span class="chip orange">يحتاج متابعة</span>';
  if ((p.overallAccuracy ?? 0) >= 90) return '<span class="chip green">متميز</span>';
  return '<span class="chip blue">مستقر</span>';
}

export function buildEmpByPort(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);

  if (profiles.length === 0) {
    return `<section class="page compact" id="page-emp-port" data-title="أداء الموظفين حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">أداء الموظفين</div>
    <div class="rail-tab active">حسب المنفذ</div>
    <div class="rail-tab">المقارنة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
    <div class="section-subtitle">مثال تطبيقي — أكبر منفذ</div>
    <div class="notice-centered"><div>لا توجد بيانات كافية لهذه الدورة</div></div>
    <div class="page-no">17</div>
  </div>
</section>`;
  }

  // Pick the top port by population for the example
  const topPortProfile = [...ctx.kpis.portProfiles].sort((a, b) => b.population - a.population)[0];
  const portName = topPortProfile?.portName ?? "";

  const portEmployees = profiles.filter(p => p.byPort.has(portName));
  const portSorted    = [...portEmployees].sort((a, b) => (b.byPort.get(portName)?.accuracy ?? -1) - (a.byPort.get(portName)?.accuracy ?? -1));
  const portAvgAcc    = topPortProfile?.accuracy ?? null;
  const missedCount   = ctx.rows.filter(r => r.portName === portName && r.verificationCategory === "missed-suspicious").length;

  const portEmpRows = portSorted.slice(0, 8).map(p => {
    const portData = p.byPort.get(portName);
    const portAcc  = portData?.accuracy ?? null;
    const diff     = portAcc !== null && portAvgAcc !== null ? portAcc - portAvgAcc : null;
    const diffStr  = diff !== null ? (diff >= 0 ? "+" : "") + fmtPct(diff) : "—";
    return `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${fmtNum(portData?.studied ?? 0)}</td>
      <td>${p.levelOneAccuracy !== null ? fmtPct(p.levelOneAccuracy) : "—"}</td>
      <td>${p.levelTwoAccuracy !== null ? fmtPct(p.levelTwoAccuracy) : "—"}</td>
      <td>${portAcc !== null ? fmtPct(portAcc) : "—"}</td>
      <td>—</td>
      <td>${diffStr}</td>
      <td>${employeeChip(p)}</td>
    </tr>`;
  }).join("");

  const top3    = portSorted.slice(0, 3).map((p, i) => `<p>${i + 1}. ${esc(ctx.displayName(p.username))} — ${fmtPct(p.byPort.get(portName)?.accuracy ?? null)}</p>`).join("");
  const bottom3 = [...portSorted].reverse().slice(0, 3).map((p, i) => `<p>${i + 1}. ${esc(ctx.displayName(p.username))} — ${fmtPct(p.byPort.get(portName)?.accuracy ?? null)}</p>`).join("");

  return `<section class="page compact" id="page-emp-port" data-title="أداء الموظفين حسب المنفذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">أداء الموظفين</div>
    <div class="rail-tab active">حسب المنفذ</div>
    <div class="rail-tab">المقارنة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أداء الموظفين حسب المنفذ</h2>
    <div class="section-subtitle">مثال تطبيقي — منفذ ${esc(portName)}</div>
    <div class="grid grid-5">
      <div class="card"><h3>الحالات المفحوصة</h3><div class="metric gold">${fmtNum(topPortProfile?.studied ?? 0)}</div></div>
      <div class="card"><h3>عدد الموظفين</h3><div class="metric blue">${fmtNum(portEmployees.length)}</div></div>
      <div class="card"><h3>دقة الفحص</h3><div class="metric blue">${fmtPct(portAvgAcc)}</div></div>
      <div class="card"><h3>دقة الاشتباه</h3><div class="metric green">${fmtPct(topPortProfile?.suspiciousDetectionRate ?? null)}</div></div>
      <div class="card"><h3>الاشتباه الفائت</h3><div class="metric coral">${fmtNum(missedCount)}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th><th>القرارات</th><th>المستوى الأول</th><th>المستوى الثاني</th><th>دقة الفحص</th><th>دقة الاشتباه</th><th>مقارنة بالمتوسط</th><th>التصنيف</th></tr></thead>
      <tbody>${portEmpRows || `<tr><td colspan="8" class="muted" style="text-align:center">لا توجد بيانات لهذا المنفذ</td></tr>`}</tbody>
    </table></div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل 3 موظفين</div>
        ${top3 || `<p class="muted">لا توجد بيانات</p>`}
      </div>
      <div class="card">
        <div class="panel-title">أقل 3 موظفين</div>
        ${bottom3 || `<p class="muted">لا توجد بيانات</p>`}
      </div>
      <div class="card">
        <div class="panel-title">ملاحظات المنفذ</div>
        <p class="muted">لا توجد ملاحظات نصية متاحة في النموذج الحالي.</p>
      </div>
    </div>
    <div class="page-no">17</div>
  </div>
</section>`;
}

// Cross-port comparison — page 18
export function buildEmpCrossPort(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable  = profiles.filter(p => p.reliable);

  // Sort ports by population desc, cap at 6 for the matrix
  const ports = [...ctx.kpis.portProfiles].sort((a, b) => b.population - a.population).slice(0, 6);

  const portCount   = ctx.kpis.portProfiles.length;
  const bestPort    = [...ctx.kpis.portProfiles].sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1))[0];
  const maxPortAcc  = bestPort?.accuracy ?? null;
  const minPortAcc  = ctx.kpis.portProfiles.reduce<number | null>((min, p) => p.accuracy !== null ? (min === null ? p.accuracy : Math.min(min, p.accuracy)) : min, null);
  const portDiff    = maxPortAcc !== null && minPortAcc !== null ? maxPortAcc - minPortAcc : null;
  const mostStable  = reliable.filter(p => p.stabilityIndex !== null).sort((a, b) => (a.stabilityIndex!) - (b.stabilityIndex!))[0];

  const heatClass = (acc: number | null) => {
    if (acc === null) return "hm1";
    if (acc >= 95) return "hm5";
    if (acc >= 90) return "hm4";
    if (acc >= 80) return "hm3";
    if (acc >= 70) return "hm2";
    return "hm1";
  };

  const headers = ports.map(p => `<th title="${esc(p.portName)}">${esc(p.portName)}</th>`).join("");
  const matrixRows = reliable.slice(0, 8).map(p => {
    const cells = ports.map(port => {
      const portData = p.byPort.get(port.portName);
      const acc = portData?.accuracy ?? null;
      return `<td class="${heatClass(acc)}">${acc !== null ? fmtPct(acc) : "—"}</td>`;
    }).join("");
    return `<tr><td>${esc(ctx.displayName(p.username))}</td>${cells}</tr>`;
  }).join("");

  const bestPerEmp = reliable.slice(0, 6).map(p => {
    let bestPort2 = "", bestAcc2: number | null = null;
    for (const [port, data] of p.byPort) {
      if (data.accuracy !== null && (bestAcc2 === null || data.accuracy > bestAcc2)) {
        bestAcc2 = data.accuracy; bestPort2 = port;
      }
    }
    return `<p>${esc(ctx.displayName(p.username))} — ${esc(bestPort2)} (${fmtPct(bestAcc2)})</p>`;
  }).join("");

  const worstPerEmp = reliable.slice(0, 6).map(p => {
    let worstPort = "", worstAcc: number | null = null;
    for (const [port, data] of p.byPort) {
      if (data.accuracy !== null && (worstAcc === null || data.accuracy < worstAcc)) {
        worstAcc = data.accuracy; worstPort = port;
      }
    }
    return `<p>${esc(ctx.displayName(p.username))} — ${esc(worstPort)} (${fmtPct(worstAcc)})</p>`;
  }).join("");

  const noData = reliable.length === 0 || ports.length === 0;

  return `<section class="page compact" id="page-emp-cross-port" data-title="مقارنة الموظفين بين المنافذ">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">حسب المنفذ</div>
    <div class="rail-tab active">المقارنة</div>
    <div class="rail-tab">الاستقرار</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">مقارنة الموظفين بين المنافذ</h2>
    <div class="section-subtitle">مصفوفة أداء الموظفين حسب المنفذ</div>
    ${noData
      ? `<div class="notice-centered"><div>لا توجد بيانات كافية لهذه الدورة</div></div>`
      : `<div class="grid grid-4">
      <div class="card"><h3>المنافذ المقارنة</h3><div class="metric blue">${fmtNum(portCount)}</div></div>
      <div class="card"><h3>أفضل منفذ</h3><div class="metric blue" style="font-size:20px" title="${esc(bestPort?.portName ?? "")}">${esc(bestPort?.portName ?? "—")}</div></div>
      <div class="card"><h3>أكبر فرق أداء</h3><div class="metric coral">${fmtPct(portDiff)}</div></div>
      <div class="card"><h3>أكثر الموظفين استقرارًا</h3><div class="metric green" style="font-size:20px">${esc(mostStable ? ctx.displayName(mostStable.username) : "—")}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th>${headers}</tr></thead>
      <tbody>${matrixRows}</tbody>
    </table></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أفضل منفذ لكل موظف</div>
        ${bestPerEmp || `<p class="muted">لا توجد بيانات</p>`}
      </div>
      <div class="card">
        <div class="panel-title">أضعف منفذ لكل موظف</div>
        ${worstPerEmp || `<p class="muted">لا توجد بيانات</p>`}
      </div>
    </div>`}
    <div class="page-no">18</div>
  </div>
</section>`;
}
