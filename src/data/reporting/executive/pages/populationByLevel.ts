import type { ExecutiveRenderContext } from "../context";
import { esc, fmtNum } from "../primitives";

export function buildPopulationByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;

  // Build stage × port breakdown from ctx.rows
  const stagePortMap = new Map<string, Map<string, { clean: number; suspicious: number; total: number }>>();
  for (const r of ctx.rows) {
    const stageKey = r.stage ?? "unknown";
    const port = r.portName ?? "غير محدد";
    if (!stagePortMap.has(stageKey)) stagePortMap.set(stageKey, new Map());
    const portMap = stagePortMap.get(stageKey)!;
    const rec = portMap.get(port) ?? { clean: 0, suspicious: 0, total: 0 };
    rec.total++;
    if (r.imageResult === "سليمة") rec.clean++;
    else rec.suspicious++;
    portMap.set(port, rec);
  }

  const stageColors = ["gold", "blue", "slate", "coral"] as const;
  const stageKeys   = ["stage1", "stage2", "stage3", "stage4"];

  const stageMetrics = kpis.stageProfiles.map((s, i) => `
    <div class="card stage${i + 1}">
      <h3 style="color:var(--${stageColors[i] ?? "gold"})">${esc(s.stageLabel)}</h3>
      <div class="metric ${stageColors[i] ?? "gold"}">${fmtNum(s.population)}</div>
    </div>`).join("");

  const stageTableBlocks = kpis.stageProfiles.map((s, i) => {
    const key = stageKeys[i] ?? s.stageKey;
    const portMap = stagePortMap.get(key) ?? stagePortMap.get(s.stageKey);
    const entries = portMap
      ? [...portMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)
      : [];
    const moreCount = portMap ? Math.max(0, portMap.size - 8) : 0;

    const rows = entries.map(([portName, rec]) =>
      `<tr>
        <td title="${esc(portName)}">${esc(portName)}</td>
        <td>${fmtNum(rec.clean)}</td>
        <td>${fmtNum(rec.suspicious)}</td>
        <td>${fmtNum(rec.total)}</td>
      </tr>`
    ).join("");

    const moreRow = moreCount > 0
      ? `<tr class="muted-row"><td colspan="4">... ${fmtNum(moreCount)} أخرى</td></tr>`
      : "";

    const totalRow = entries.length > 0
      ? `<tr class="total-row">
          <td>الإجمالي</td>
          <td>${fmtNum(entries.reduce((s2, [, r]) => s2 + r.clean, 0))}</td>
          <td>${fmtNum(entries.reduce((s2, [, r]) => s2 + r.suspicious, 0))}</td>
          <td>${fmtNum(s.population)}</td>
        </tr>`
      : `<tr class="total-row"><td>الإجمالي</td><td>—</td><td>—</td><td>${fmtNum(s.population)}</td></tr>`;

    return `<div class="card stage${i + 1}">
      <div class="panel-title">${esc(s.stageLabel)}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>المنفذ</th><th>سليمة</th><th>اشتباه</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows}${moreRow}${totalRow}</tbody>
      </table></div>
    </div>`;
  }).join("");

  const hasStages = kpis.stageProfiles.length > 0;

  const mainContent = hasStages
    ? `<div class="grid grid-2" style="margin-top:18px">${stageTableBlocks}</div>
      <div class="context-band">
        <div class="card">
          <div class="panel-title">وصف المستويات</div>
          <ul class="method-list">
            <li>المستوى الأول: تقييم فاحص الأشعة الابتدائي لكل حالة — هو الإجراء الأساسي الأول.</li>
            <li>المستوى الثاني: مراجعة إشرافية تُجرى على حالات بعينها للتحقق من قرارات المستوى الأول.</li>
            <li>المستوى الثالث والرابع (عند وجودهما): مراجعات إضافية متخصصة أو تصعيدية.</li>
            <li>تُعرض حالات كل مستوى موزّعة على المنافذ لإبراز تركّز النشاط جغرافيًا.</li>
          </ul>
        </div>
        <div class="card">
          <div class="panel-title">توزيع المستويات</div>
          <div class="stat-stack">
            ${kpis.stageProfiles.map((s, i) =>
              `<div class="stat-pill"><span>${esc(s.stageLabel)}</span><b class="metric ${["gold","blue","slate","coral"][i] ?? "gold"}" style="font-size:1rem">${fmtNum(s.population)}</b></div>`
            ).join("")}
          </div>
        </div>
      </div>`
    : `<div class="notice-centered page-fill"><div>لا توجد بيانات مستويات — يُرجى التأكد من استيراد بيانات المجتمع وإجراء المعالجة.</div></div>`;

  return `<section class="page compact" id="page-pop-levels" data-title="المجتمع حسب المستويات">
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
    <div class="page-fill">
      ${mainContent}
    </div>
    <div class="page-no">06</div>
  </div>
</section>`;
}
