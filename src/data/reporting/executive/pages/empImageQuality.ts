import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";
import { buildEmployeeProfiles } from "../executiveEmployeeData";

export function buildEmpImageQuality(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  // Page 11 — نتائج جودة الصور (global image quality results page)
  // Per-port quality map from ctx.rows
  const portQualityMap = new Map<string, { total: number; high: number; marked: number }>();
  for (const r of ctx.rows) {
    if (r.answerStatus !== "submitted") continue;
    const port = r.portName ?? "غير محدد";
    const rec = portQualityMap.get(port) ?? { total: 0, high: 0, marked: 0 };
    rec.total++;
    if (r.imageQuality === "عالي") rec.high++;
    if (r.hasMarking === true) rec.marked++;
    portQualityMap.set(port, rec);
  }

  // Marking accuracy comparison
  const markedStudied   = ctx.rows.filter(r => r.hasMarking === true && r.verificationCategory !== null);
  const unmarkedStudied = ctx.rows.filter(r => r.hasMarking === false && r.verificationCategory !== null);
  const markingAccuracy   = markedStudied.length   > 0 ? markedStudied.filter(r => r.imageResultAccurate).length / markedStudied.length * 100 : null;
  const noMarkingAccuracy = unmarkedStudied.length > 0 ? unmarkedStudied.filter(r => r.imageResultAccurate).length / unmarkedStudied.length * 100 : null;

  // Global quality %
  const evalCount = kpis.imageQualityEvaluatedCount;
  const highQualPct = evalCount > 0 ? kpis.highQualityCount / evalCount * 100 : null;
  const lowQualPct  = evalCount > 0 ? kpis.lowQualityCount  / evalCount * 100 : null;

  // Lowest 5 ports by high-quality %
  const portQualList = [...portQualityMap.entries()]
    .filter(([, r]) => r.total > 0)
    .map(([name, r]) => ({ name, highPct: r.high / r.total * 100, markPct: r.marked / r.total * 100, total: r.total }))
    .sort((a, b) => a.highPct - b.highPct);
  const bottom5 = portQualList.slice(0, 5);
  const maxHighPct = portQualList.length > 0 ? Math.max(...portQualList.map(p => p.highPct)) : 100;

  const bottom5Bars = bottom5.length > 0
    ? bottom5.map(p => {
        const w = maxHighPct > 0 ? (p.highPct / maxHighPct * 100).toFixed(1) : "0";
        return `<div class="bar-row"><span title="${esc(p.name)}">${esc(p.name)}</span><div class="bar" style="--w:${w}%"><i style="width:${w}%"></i></div><b>${fmtPct(p.highPct)}</b></div>`;
      }).join("")
    : `<p class="muted">لا توجد بيانات كافية</p>`;

  // Port quality table rows (sorted by population desc, max 8)
  const portTableRows = [...portQualityMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)
    .map(([name, r]) => {
      const portProfile = kpis.portProfiles.find(p => p.portName === name);
      return `<tr>
        <td title="${esc(name)}">${esc(name)}</td>
        <td>${fmtNum(r.total)}</td>
        <td>${r.total > 0 ? fmtPct(r.high / r.total * 100) : "—"}</td>
        <td>${r.total > 0 ? fmtPct(r.marked / r.total * 100) : "—"}</td>
        <td>${portProfile?.accuracy != null ? fmtPct(portProfile.accuracy) : "—"}</td>
        <td>—</td>
      </tr>`;
    }).join("");

  // Low quality reasons
  const lowQualReasons = kpis.lowQualityReasons.length > 0
    ? kpis.lowQualityReasons.map(r => `<p>${esc(r.reason)} <span class="muted">(${fmtPct(r.percentage)})</span></p>`).join("")
    : `<p class="muted">لا توجد أسباب مسجلة</p>`;

  // Marking bar widths clamped 0–100
  const wBar = (v: number | null) => v !== null ? Math.min(100, Math.max(0, v)).toFixed(1) : "0";

  const noData = evalCount === 0 && portQualityMap.size === 0;

  return `<section class="page compact" id="page-image-quality" data-title="نتائج جودة الصور">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">نتائج الدقة</div>
    <div class="rail-tab active">جودة الصور</div>
    <div class="rail-tab">الأصناف المشبوهة</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج جودة الصور</h2>
    <div class="section-subtitle">تحليل جودة الصور ووجود التحديد وأثرهما على دقة الفحص</div>
    ${noData
      ? `<div class="notice-centered"><div>لا توجد بيانات كافية لهذه الفترة</div></div>`
      : `<div class="grid grid-4">
      <div class="card"><h3>الصور عالية الجودة</h3><div class="metric green">${fmtPct(highQualPct)}</div></div>
      <div class="card"><h3>وجود تحديد</h3><div class="metric blue">${fmtPct(kpis.markingRate)}</div></div>
      <div class="card"><h3>الصور منخفضة الجودة</h3><div class="metric coral">${fmtPct(lowQualPct)}</div></div>
      <div class="card"><h3>الدقة دون تحديد</h3><div class="metric gold">${fmtPct(noMarkingAccuracy)}</div></div>
    </div>
    <div class="info" style="margin:16px 0">تتم مقارنة دقة الفحص بين الحالات التي بها تحديد والحالات التي لا يوجد بها تحديد لاختبار ما إذا كان غياب التحديد يرتبط بانخفاض الدقة.</div>
    <div class="table-wrap"><table>
      <thead><tr><th>المنفذ</th><th>إجمالي الصور</th><th>جودة مرتفعة</th><th>وجود تحديد</th><th>دقة الفحص</th><th>ملاحظة</th></tr></thead>
      <tbody>${portTableRows || `<tr><td colspan="6" style="text-align:center" class="muted">لا توجد بيانات</td></tr>`}</tbody>
    </table></div>
    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">أدنى 5 منافذ في جودة الصور</div>
        ${bottom5Bars}
      </div>
      <div class="card">
        <div class="panel-title">مقارنة الدقة حسب التحديد</div>
        <p>يوجد تحديد (${fmtPct(markingAccuracy)})</p>
        <div class="bar"><i style="width:${wBar(markingAccuracy)}%"></i></div>
        <p style="margin-top:8px">لا يوجد تحديد (${fmtPct(noMarkingAccuracy)})</p>
        <div class="bar"><i style="width:${wBar(noMarkingAccuracy)}%;background:var(--coral)"></i></div>
      </div>
      <div class="card">
        <div class="panel-title">أسباب انخفاض الجودة</div>
        ${lowQualReasons}
      </div>
    </div>`}
    <div class="page-no">11</div>
  </div>
</section>`;
}

// Re-export the employee image quality impact page as a separate named export
// (page 20 in the mockup — used in index.ts as buildEmpImageQuality but routed to page 20)
export function buildEmpImageQualityImpact(ctx: ExecutiveRenderContext): string {
  const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
  const reliable = profiles.filter(p => p.reliable);

  // Global quality × marking accuracy from rows
  const highQRows  = ctx.rows.filter(r => r.imageQuality === "عالي"    && r.verificationCategory !== null);
  const lowQRows   = ctx.rows.filter(r => r.imageQuality === "منخفض"   && r.verificationCategory !== null);
  const markRows   = ctx.rows.filter(r => r.hasMarking === true         && r.verificationCategory !== null);
  const noMarkRows = ctx.rows.filter(r => r.hasMarking === false         && r.verificationCategory !== null);
  const safeRate   = (num: number, den: number) => den > 0 ? num / den * 100 : null;

  const highQAcc   = safeRate(highQRows.filter(r => r.imageResultAccurate).length, highQRows.length);
  const lowQAcc    = safeRate(lowQRows.filter(r => r.imageResultAccurate).length, lowQRows.length);
  const markAcc    = safeRate(markRows.filter(r => r.imageResultAccurate).length, markRows.length);
  const noMarkAcc  = safeRate(noMarkRows.filter(r => r.imageResultAccurate).length, noMarkRows.length);

  // Quadrant: high quality + marking, high + no marking, low + marking, low + no marking
  const hqwm  = ctx.rows.filter(r => r.imageQuality === "عالي"   && r.hasMarking === true  && r.verificationCategory !== null);
  const hqnm  = ctx.rows.filter(r => r.imageQuality === "عالي"   && r.hasMarking === false && r.verificationCategory !== null);
  const lqwm  = ctx.rows.filter(r => (r.imageQuality === "منخفض" || r.imageQuality === "متوسط") && r.hasMarking === true  && r.verificationCategory !== null);
  const lqnm  = ctx.rows.filter(r => (r.imageQuality === "منخفض" || r.imageQuality === "متوسط") && r.hasMarking === false && r.verificationCategory !== null);
  const hqwmAcc = safeRate(hqwm.filter(r => r.imageResultAccurate).length, hqwm.length);
  const hqnmAcc = safeRate(hqnm.filter(r => r.imageResultAccurate).length, hqnm.length);
  const lqwmAcc = safeRate(lqwm.filter(r => r.imageResultAccurate).length, lqwm.length);
  const lqnmAcc = safeRate(lqnm.filter(r => r.imageResultAccurate).length, lqnm.length);

  const noData = ctx.rows.length === 0;

  const tableRows = reliable.slice(0, 8).map(p => {
    const hqA = p.byImageQuality["عالي"].accuracy;
    const lqA = p.byImageQuality["منخفض"].accuracy;
    const mA  = p.byMarking.marked.accuracy;
    const nmA = p.byMarking.unmarked.accuracy;
    const diff = mA !== null && nmA !== null ? mA - nmA : null;
    return `<tr>
      <td>${esc(ctx.displayName(p.username))}</td>
      <td>${hqA !== null ? fmtPct(hqA) : "—"}</td>
      <td>${lqA !== null ? fmtPct(lqA) : "—"}</td>
      <td>${mA  !== null ? fmtPct(mA)  : "—"}</td>
      <td>${nmA !== null ? fmtPct(nmA) : "—"}</td>
      <td>${diff !== null ? (diff >= 0 ? "+" : "") + fmtPct(diff) : "—"}</td>
    </tr>`;
  }).join("");

  return `<section class="page compact" id="page-quality-impact" data-title="أثر جودة الصورة والتحديد">
  <div class="right-rail">
    <div class="rail-main">الجزء الثالث <em>التحاليل المتقدمة</em></div>
    <div class="rail-tab">الاستقرار</div>
    <div class="rail-tab active">جودة الصورة والتحديد</div>
    <div class="rail-tab">الأخطاء</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">أثر جودة الصورة والتحديد على الأداء</h2>
    <div class="section-subtitle">تحليل ما إذا كانت جودة الصورة ووجود التحديد يرتبطان بانخفاض أو ارتفاع الدقة</div>
    ${noData
      ? `<div class="notice-centered"><div>لا توجد بيانات كافية لهذه الفترة</div></div>`
      : `<div class="grid grid-4">
      <div class="card"><h3>جودة عالية</h3><div class="metric blue">${fmtPct(highQAcc)}</div></div>
      <div class="card"><h3>جودة منخفضة</h3><div class="metric coral">${fmtPct(lowQAcc)}</div></div>
      <div class="card"><h3>مع تحديد</h3><div class="metric gold">${fmtPct(markAcc)}</div></div>
      <div class="card"><h3>دون تحديد</h3><div class="metric green">${fmtPct(noMarkAcc)}</div></div>
    </div>
    <div class="quad" style="margin-top:16px">
      <div><h4 style="color:var(--gold)">عالية الجودة + يوجد تحديد</h4><div class="metric gold">${fmtPct(hqwmAcc)}</div><p>أفضل سيناريو متوقع.</p></div>
      <div><h4 style="color:var(--blue)">عالية الجودة + لا يوجد تحديد</h4><div class="metric blue">${fmtPct(hqnmAcc)}</div><p>جودة جيدة مع فقدان معلومات مساعدة.</p></div>
      <div><h4 style="color:var(--gold)">منخفضة/متوسطة + يوجد تحديد</h4><div class="metric gold">${fmtPct(lqwmAcc)}</div><p>التحديد قد يخفف أثر انخفاض الجودة.</p></div>
      <div><h4 style="color:var(--coral)">منخفضة/متوسطة + لا يوجد تحديد</h4><div class="metric coral">${fmtPct(lqnmAcc)}</div><p>أعلى خطر لانخفاض الدقة.</p></div>
    </div>
    <div class="table-wrap" style="margin-top:16px"><table>
      <thead><tr><th>الموظف</th><th>جودة عالية</th><th>جودة منخفضة</th><th>مع تحديد</th><th>دون تحديد</th><th>فرق الأثر</th></tr></thead>
      <tbody>${tableRows || `<tr><td colspan="6" class="muted" style="text-align:center">لا توجد بيانات موثوقة</td></tr>`}</tbody>
    </table></div>`}
    <div class="page-no">20</div>
  </div>
</section>`;
}
