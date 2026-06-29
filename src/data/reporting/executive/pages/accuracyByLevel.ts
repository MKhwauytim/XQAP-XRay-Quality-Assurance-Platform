import type { ExecutiveRenderContext } from "../context";
import { fmtNum, fmtPct, esc } from "../primitives";
import type { ExecutiveReportRow } from "../../executiveReportTypes";

function stageAccuracyFromRows(rows: ExecutiveReportRow[]): Map<string, { accuracy: number | null; suspiciousDetectionRate: number | null; studiedSuspicious: number; studied: number }> {
  const stageGroups = new Map<string, ExecutiveReportRow[]>();
  for (const r of rows) {
    if (r.verificationCategory === null) continue;
    const key = r.stage ?? "unknown";
    if (!stageGroups.has(key)) stageGroups.set(key, []);
    stageGroups.get(key)!.push(r);
  }
  const out = new Map<string, { accuracy: number | null; suspiciousDetectionRate: number | null; studiedSuspicious: number; studied: number }>();
  for (const [key, rows2] of stageGroups) {
    const correct = rows2.filter(r => r.imageResultAccurate).length;
    const suspRows = rows2.filter(r => r.verificationCategory === "correct-suspicious" || r.verificationCategory === "missed-suspicious");
    const detected = rows2.filter(r => r.verificationCategory === "correct-suspicious").length;
    out.set(key, {
      accuracy: rows2.length > 0 ? (correct / rows2.length) * 100 : null,
      suspiciousDetectionRate: suspRows.length > 0 ? (detected / suspRows.length) * 100 : null,
      studiedSuspicious: suspRows.length,
      studied: rows2.length,
    });
  }
  return out;
}

export function buildAccuracyByLevel(ctx: ExecutiveRenderContext): string {
  const { kpis } = ctx;
  const stageAccMap = stageAccuracyFromRows(ctx.rows);

  const stageKeys   = ["stage1", "stage2", "stage3", "stage4"];
  const stageColors = ["gold", "blue", "slate", "coral"] as const;

  const cards = kpis.stageProfiles.map((s, i) => {
    const key = stageKeys[i] ?? s.stageKey;
    const acc = stageAccMap.get(key) ?? stageAccMap.get(s.stageKey);
    const inspAcc = acc?.accuracy ?? null;
    const suspAcc = acc?.suspiciousDetectionRate ?? null;
    const col = stageColors[i] ?? "gold";
    return `<div class="card level-card stage${i + 1}">
      <h3>${esc(s.stageLabel)}</h3>
      <p>دقة الفحص</p>
      <div class="metric ${col}">${fmtPct(inspAcc)}</div>
      <p>دقة الاشتباه: ${fmtPct(suspAcc)}</p>
    </div>`;
  }).join("");

  const tableRows = kpis.stageProfiles.map((s, i) => {
    const key = stageKeys[i] ?? s.stageKey;
    const acc = stageAccMap.get(key) ?? stageAccMap.get(s.stageKey);
    const inspAcc = acc?.accuracy ?? null;
    const suspAcc = acc?.suspiciousDetectionRate ?? null;
    const studied = acc?.studied ?? s.studied;
    const studiedSusp = acc?.studiedSuspicious ?? 0;
    return `<tr>
      <td>${esc(s.stageLabel)}</td>
      <td>${fmtNum(studied)}</td>
      <td>${fmtNum(studiedSusp)}</td>
      <td>${fmtPct(suspAcc)}</td>
      <td>${fmtPct(inspAcc)}</td>
      <td>—</td>
    </tr>`;
  }).join("");

  const hasPendingData = kpis.validStudied === 0;

  const pendingCards = kpis.stageProfiles.map((s, i) => {
    const col = stageColors[i] ?? "gold";
    return `<div class="card level-card stage${i + 1}">
      <h3>${esc(s.stageLabel)}</h3>
      <p>دقة الفحص</p>
      <div class="metric ${col}">—</div>
      <p>دقة الاشتباه: —</p>
    </div>`;
  }).join("");

  const mainContent = hasPendingData
    ? `<div class="grid grid-4">${pendingCards}</div>
      <div class="notice-centered" style="flex:1;padding:24px"><div>لم تُقدَّم مراجعات خبير بعد — ستظهر نتائج الدقة لكل مستوى فور اكتمال عملية المراجعة.</div></div>
      <div class="context-band">
        <div class="card">
          <div class="panel-title">ما الذي تقيسه هذه الصفحة؟</div>
          <ul class="method-list">
            <li>دقة الفحص لكل مستوى = نسبة الحالات التي تطابقت فيها نتيجة المستوى مع رأي الخبير.</li>
            <li>دقة الاشتباه = قدرة المستوى على اكتشاف الحالات المشبوهة الحقيقية بشكل صحيح.</li>
            <li>المقارنة بين المستويات تُبرز مدى اتساق الأداء وتحدد المستويات التي تحتاج إلى تدخل.</li>
            <li>تُحسب القيم فقط على الحالات التي صدر بها رأي الخبير.</li>
          </ul>
        </div>
        <div class="card">
          <div class="panel-title">المستويات المسجّلة</div>
          <div class="stat-stack">
            ${kpis.stageProfiles.map((s) =>
              `<div class="stat-pill"><span>${esc(s.stageLabel)}</span><b>${fmtNum(s.population)} حالة</b></div>`
            ).join("")}
            ${kpis.stageProfiles.length === 0
              ? '<div class="stat-pill"><span>لا توجد مستويات</span><b>—</b></div>'
              : ''}
          </div>
        </div>
      </div>`
    : `<div class="grid grid-4">${cards}</div>
      <div class="page-fill">
        <div class="table-wrap" style="margin-top:18px"><table>
          <thead><tr><th>المستوى</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>أبرز ملاحظة</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>
        <div class="context-band">
          <div class="card">
            <div class="panel-title">تفسير النتائج</div>
            <ul class="method-list">
              <li>المستويات ذات دقة فحص أعلى من الهدف تُشير إلى أداء متميز يستحق التعزيز.</li>
              <li>الفجوة الكبيرة بين دقة الفحص ودقة الاشتباه تستوجب مراجعة منهجية الاشتباه.</li>
              <li>يُنصح بتركيز جهود التحسين على المستويات التي تقل دقتها عن المستهدف.</li>
              <li>الغرض: إبراز المستويات الأقوى وتحديد المستويات التي تتطلب تدخلًا.</li>
            </ul>
          </div>
          <div class="card">
            <div class="panel-title">إجماليات المستويات</div>
            <div class="stat-stack">
              ${kpis.stageProfiles.map((s, i) => {
                const key = stageKeys[i] ?? s.stageKey;
                const acc = stageAccMap.get(key) ?? stageAccMap.get(s.stageKey);
                const inspAcc = acc?.accuracy ?? null;
                const col = stageColors[i] ?? "gold";
                return `<div class="stat-pill"><span>${esc(s.stageLabel)}</span><b style="color:var(--${col})">${fmtPct(inspAcc)}</b></div>`;
              }).join("")}
            </div>
          </div>
        </div>
      </div>`;

  return `<section class="page compact" id="page-acc-level" data-title="نتائج الدقة حسب المستويات">
  <div class="right-rail">
    <div class="rail-main">الجزء الثاني <em>نتائج الفحص</em></div>
    <div class="rail-tab">دقة المنفذ</div>
    <div class="rail-tab active">دقة المستوى</div>
    <div class="rail-tab">جودة الصور</div>
  </div>
  <div class="page-inner">
    <h2 class="section-title">نتائج الدقة حسب المستويات</h2>
    <div class="section-subtitle">تحليل دقة الفحص ودقة الاشتباه عبر المستويات الأربعة</div>
    <div class="page-fill">
      ${mainContent}
    </div>
    <div class="page-no">10</div>
  </div>
</section>`;
}
