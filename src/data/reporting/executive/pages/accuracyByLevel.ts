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
    <div class="grid grid-4">
      ${cards}
    </div>
    <div class="table-wrap" style="margin-top:18px"><table>
      <thead><tr><th>المستوى</th><th>الحالات المفحوصة</th><th>حالات الاشتباه</th><th>دقة الاشتباه</th><th>دقة الفحص</th><th>أبرز ملاحظة</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div class="info" style="margin-top:18px">الغرض: إبراز المستويات الأقوى وتحديد المستويات التي تتطلب تدخلًا، وفهم الفروق بين دقة الاشتباه ودقة الفحص الإجمالية.</div>
    <div class="page-no">10</div>
  </div>
</section>`;
}
