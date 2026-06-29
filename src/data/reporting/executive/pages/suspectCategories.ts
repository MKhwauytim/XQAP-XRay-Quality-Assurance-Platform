import type { ExecutiveRenderContext } from "../context";
import { fmtNum, esc } from "../primitives";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function buildFreqMap(rows: ExecutiveReportRow[], field: "suspectedTypes" | "smuggleMethod"): { label: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const r of rows) {
    const val = r[field];
    if (!val) continue;
    val.split(/[,،;]/).map(s => s.trim()).filter(Boolean).forEach(v => {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    });
  }
  return [...freq.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function buildSuspectCategories(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  const typeFreq   = buildFreqMap(ctx.rows, "suspectedTypes");
  const methodFreq = buildFreqMap(ctx.rows, "smuggleMethod");

  const categoryCount  = typeFreq.length;
  const mechanismCount = methodFreq.length;
  const topCategory    = typeFreq[0]?.label ?? "—";

  const maxTypeCount   = typeFreq[0]?.count  ?? 1;
  const maxMethodCount = methodFreq[0]?.count ?? 1;

  const barRows = (items: { label: string; count: number }[], max: number, limit = 5) =>
    items.slice(0, limit).map(item => {
      const w = (item.count / max * 100).toFixed(1);
      return `<div class="bar-row">
        <span title="${esc(item.label)}">${esc(item.label)}</span>
        <div class="bar" style="--w:${w}%"><i style="width:${w}%"></i></div>
        <b>${fmtNum(item.count)}</b>
      </div>`;
    }).join("");

  // Top 3 types × top 3 methods heatmap
  const topTypes   = typeFreq.slice(0, 3);
  const topMethods = methodFreq.slice(0, 3);

  // Cross-tabulate
  const crossTab = new Map<string, Map<string, number>>();
  for (const r of ctx.rows) {
    const types   = (r.suspectedTypes ?? "").split(/[,،;]/).map(s => s.trim()).filter(Boolean);
    const methods = (r.smuggleMethod  ?? "").split(/[,،;]/).map(s => s.trim()).filter(Boolean);
    for (const t of types) {
      for (const m of methods) {
        if (!crossTab.has(t)) crossTab.set(t, new Map());
        crossTab.get(t)!.set(m, (crossTab.get(t)!.get(m) ?? 0) + 1);
      }
    }
  }

  const hmHeaders = topMethods.map(m => `<div class="hdr">${esc(m.label)}</div>`).join("");
  const hmMax = Math.max(1, ...topTypes.flatMap(t => topMethods.map(m => crossTab.get(t.label)?.get(m.label) ?? 0)));
  const hmRows = topTypes.map(t => {
    const cells = topMethods.map(m => {
      const cnt = crossTab.get(t.label)?.get(m.label) ?? 0;
      const lvl = cnt === 0 ? 1 : Math.ceil((cnt / hmMax) * 5);
      return `<div class="hm-cell hm${lvl}">${fmtNum(cnt)}</div>`;
    }).join("");
    return `<div class="hm-row"><div class="hm-cell hdr">${esc(t.label)}</div>${cells}</div>`;
  }).join("");

  const noData = ctx.rows.length === 0 || (typeFreq.length === 0 && methodFreq.length === 0);

  return `<section class="page compact" id="page-categories" data-title="الأصناف وآليات التهريب">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">جودة الصور</div>
    <div class="rail-tab active">الأصناف المشبوهة</div>
    <div class="rail-tab">الجزء الثالث</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">الأصناف المشبوهة وآلية التهريب المحتملة</h2>
    <div class="section-subtitle">تحليل الأنماط النوعية المستخرجة من نتائج المراجعة</div>
    ${noData
      ? `<div class="notice-centered"><div>لا توجد بيانات أصناف أو آليات تهريب لهذه الدورة</div></div>`
      : `<div class="grid grid-4">
      <div class="card"><h3>حالات الاشتباه المؤكدة</h3><div class="metric gold">${fmtNum(kpis.correctSuspicious)}</div></div>
      <div class="card"><h3>الأصناف المصنفة</h3><div class="metric blue">${fmtNum(categoryCount)}</div></div>
      <div class="card"><h3>آليات التهريب المحتملة</h3><div class="metric coral">${fmtNum(mechanismCount)}</div></div>
      <div class="card"><h3>أعلى صنف تكرارًا</h3><div class="metric green" style="font-size:20px" title="${esc(topCategory)}">${esc(topCategory)}</div></div>
    </div>
    <div class="info" style="margin:16px 0">تستخرج الأصناف وآليات التهريب من النصوص الحرة وتجمع في فئات معيارية قبل التحليل.</div>
    <div class="grid grid-2">
      <div class="card">
        <div class="panel-title">الأصناف الأكثر تكرارًا</div>
        ${typeFreq.length > 0 ? barRows(typeFreq, maxTypeCount) : `<p class="muted">لا توجد بيانات</p>`}
      </div>
      <div class="card">
        <div class="panel-title">آليات التهريب الأكثر تكرارًا</div>
        ${methodFreq.length > 0 ? barRows(methodFreq, maxMethodCount) : `<p class="muted">لا توجد بيانات</p>`}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="panel-title">ربط الأصناف بآليات التهريب</div>
        ${topTypes.length > 0 && topMethods.length > 0
          ? `<div class="heatmap">
              <div class="hm-row"><div class="hdr">الصنف / الآلية</div>${hmHeaders}</div>
              ${hmRows}
            </div>`
          : `<p class="muted">يتطلب توفر بيانات أصناف وآليات معًا</p>`}
      </div>
      <div class="card">
        <div class="panel-title">أبرز الملاحظات</div>
        <p>• تتركز أنماط الاشتباه في فئات محددة قابلة للرصد والمتابعة.</p>
        <p>• قد يرتبط تكرار بعض الأصناف بمنافذ أو فترات زمنية بعينها.</p>
        <p>• التنوع في آليات التهريب المرصودة يستلزم تحديثًا دوريًا للنماذج التدريبية.</p>
        <p>• ينصح بمراجعة الحالات التي تحمل أعلى درجات الاشتباه بصفة أولوية.</p>
      </div>
    </div>`}
    <div class="page-no">12</div>
  </div>
</section>`;
}
