// Front matter pages: cover, table of contents, glossary / how-to-read.
// Driven from the ReportModel where data-bearing; icons via ui/icons.ts (no emoji).

import type { ReportModel } from "../model/reportModel";
import { esc, fmtNum } from "../primitives";
import { icon } from "../ui/icons";
import { page, pageHeader } from "./shared";

// Official ZATCA logo (same source as the sign-in screen) with a graceful inline-SVG
// fallback so the report still shows a mark when opened offline / printed without network.
const ZATCA_LOGO = `<span class="zatca-logo" style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px">
  <img src="https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg" alt="هيئة الزكاة والضريبة والجمارك" width="64" height="64" style="width:64px;height:64px;object-fit:contain;filter:brightness(0) invert(1)" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"/>
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:none">
    <path d="M28 4 L50 14 L50 32 C50 44 28 52 28 52 C28 52 6 44 6 32 L6 14 Z" fill="rgba(244,180,0,0.12)" stroke="#f4b400" stroke-width="1.5"/>
    <path d="M28 10 L44 18 L44 32 C44 40 28 47 28 47 C28 47 12 40 12 32 L12 18 Z" fill="none" stroke="rgba(244,180,0,0.3)" stroke-width="1"/>
    <line x1="16" y1="26" x2="40" y2="26" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
    <line x1="16" y1="30" x2="40" y2="30" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
    <line x1="16" y1="34" x2="40" y2="34" stroke="rgba(244,180,0,0.5)" stroke-width="1.2"/>
    <text x="28" y="22" text-anchor="middle" font-family="Somar,Arial" font-size="11" font-weight="700" fill="#f4b400">زكاة</text>
  </svg>
</span>`;

export function buildCover(model: ReportModel, issueDate: string): string {
  return `<section class="page cover" id="page-cover" data-title="الغلاف">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الغلاف</div>
    <div class="rail-tab">الفهرس</div>
    <div class="rail-tab">المعجم</div>
  </div>
  <div class="cover-bg-art" aria-hidden="true"></div>
  <div class="page-inner">
    <div class="org">
      ${ZATCA_LOGO}
      <div class="org-lines">هيئة الزكاة والضريبة والجمارك<br>قطاع الشؤون القانونية<br>الإدارة العامة لضمان الجودة والامتثال<br>إدارة ضمان جودة الأشعة اللاحقة</div>
    </div>
    <div class="title-block">
      <div class="kicker">نسخة تنفيذية</div>
      <h1>التقرير التنفيذي لضمان جودة الأشعة</h1>
      <div class="subtitle">دقة قرارات المستوى الأول والثاني — تحليل أمني للجودة</div>
      <div class="rule"></div>
      <p class="lead">فترة التقرير: ${esc(issueDate)}<br>مجتمع الحالات محل الدراسة: ${esc(model.summary.periodId)}<br>إجمالي المجتمع: ${fmtNum(model.population.total)} حالة</p>
      <div class="level-strip">
        <div style="--accent:var(--gold)">المستوى الأول</div>
        <div style="--accent:var(--blue)">المستوى الثاني</div>
        <div style="--accent:var(--slate)">المستوى الثالث</div>
        <div style="--accent:var(--coral)">المستوى الرابع</div>
      </div>
      <div class="badges"><span class="badge">تقرير داخلي</span><span class="badge">نسخة تنفيذية</span></div>
    </div>
    <div class="page-no">01</div>
  </div>
</section>`;
}

export function buildToc(parts: { n: string; title: string; pages: { n: string; t: string }[] }[]): string {
  const cards = parts
    .map(
      (part) => `<div class="card">
        <div class="panel-title">${esc(part.title)}</div>
        <div class="table-wrap"><table><tbody>
          ${part.pages.map((p) => `<tr><td>${esc(p.t)}</td><td>${esc(p.n)}</td></tr>`).join("")}
        </tbody></table></div>
      </div>`,
    )
    .join("");
  return `<section class="page toc-page" id="page-toc" data-title="الفهرس">
  <div class="right-rail">
    <div class="rail-main">التقرير التنفيذي <em>لضمان جودة الأشعة</em></div>
    <div class="rail-tab active">الفهرس</div>
    <div class="rail-tab">الأجزاء</div>
  </div>
  <div class="page-inner">
    <div class="toc-header">
      <div class="toc-title">
        <div class="small-note">التقرير التنفيذي لضمان جودة الأشعة<br>دقة المستويين، التطابق، والمساءلة</div>
        <h2 class="section-title">الفهرس</h2>
        <div class="section-subtitle">هيكل التقرير في خمسة أجزاء</div>
      </div>
      <div class="org"><div class="shield"></div><div class="org-lines">التقرير التنفيذي لضمان جودة الأشعة<br><span class="muted">نسخة داخلية</span></div></div>
    </div>
    <div class="toc-grid">${cards}</div>
    <div class="page-no">02</div>
  </div>
</section>`;
}

export function buildGlossary(model: ReportModel): string {
  const levelCard = (label: string, accent: string, desc: string): string =>
    `<div class="card level-card ${accent}"><h3>${esc(label)}</h3><div class="muted" style="font-size:0.78rem;line-height:1.6">${esc(desc)}</div></div>`;

  const metricRow = (ar: string, formula: string): string =>
    `<tr><td>${esc(ar)}</td><td style="font-size:0.72rem">${esc(formula)}</td></tr>`;

  const outcomeLegend = [
    { t: "سليمة صحيحة", d: "قرار سليمة طابق المراجع", icon: "check", tone: "green" },
    { t: "اشتباه صحيح", d: "قرار اشتباه طابق المراجع", icon: "check", tone: "blue" },
    { t: "اشتباه فائت", d: "قُيّم سليمة والمراجع اشتباه — خطر أمني", icon: "alert", tone: "coral" },
    { t: "اشتباه خاطئ", d: "قُيّم اشتباه والمراجع سليمة — تكلفة", icon: "flag", tone: "gold" },
  ]
    .map(
      (o) => `<div class="doc-legend-item">
        <span class="doc-close-icon" style="color:var(--${o.tone})">${icon(o.icon, 16)}</span>
        <div><b>${esc(o.t)}</b><span class="muted">${esc(o.d)}</span></div>
      </div>`,
    )
    .join("");

  const body = `${pageHeader({ iconName: "layers", eyebrow: "المعجم", title: "المعجم وكيفية القراءة", subtitle: "تعريفات المستويات والمؤشرات ودلالات النتائج" })}
    <div class="grid grid-4" style="margin-top:12px">
      ${levelCard("المستوى الأول", "stage1", "المفتش الذي يصدر القرار الأولي على الصورة.")}
      ${levelCard("المستوى الثاني", "stage2", "المراجعة المزدوجة لقرار المستوى الأول.")}
      ${levelCard("المراجع (الجودة)", "stage3", "المعيار الذهبي الذي تُقاس عليه دقة المستويين.")}
      ${levelCard("الفرق الأخرى", "stage4", "اليدوي / المعاكس / الوسائل الحية — دليل مساند فقط.")}
    </div>
    <div class="grid grid-2 page-fill" style="margin-top:14px">
      <div class="card doc-panel">
        <div class="panel-title">تعريفات المؤشرات</div>
        <div class="table-wrap"><table><thead><tr><th>المؤشر</th><th>طريقة الحساب</th></tr></thead><tbody>
          ${metricRow("دقة الفحص", "(سليمة صحيحة + اشتباه صحيح) ÷ القابل للتقييم")}
          ${metricRow("معدل اكتشاف الاشتباه", "اشتباه صحيح ÷ (صحيح + فائت)")}
          ${metricRow("الاشتباه الفائت", "فائت ÷ (صحيح + فائت) — الخطر الأعلى")}
          ${metricRow("دقة قرار الاشتباه", "اشتباه صحيح ÷ (صحيح + خاطئ)")}
          ${metricRow("الاشتباه الخاطئ", "خاطئ ÷ (سليمة صحيحة + خاطئ)")}
        </tbody></table></div>
      </div>
      <div class="card doc-panel">
        <div class="panel-title">دلالات النتائج</div>
        <div class="doc-legend">${outcomeLegend}</div>
        <div class="info doc-note" style="margin-top:10px"><span class="doc-note-icon">${icon("alert", 16)}</span><span>دلالات كفاية البيانات: 0 لا يُعرض ولا يُرتّب · 1–9 غير كافٍ · 10–19 محدود · 20+ كافٍ. القيم الناقصة تُعرض "—" لا "0%".</span></div>
        ${model.dataQuality.inspectorIdentityMapped ? "" : `<div class="info doc-note" style="margin-top:8px"><span class="doc-note-icon">${icon("users", 16)}</span><span>هوية المفتش غير مرتبطة هذه الفترة (لم تتم مطابقة BI).</span></div>`}
      </div>
    </div>`;
  return page({ id: "page-glossary", title: "المعجم وكيفية القراءة", pageNo: "03", railTabs: ["المعجم", "الأجزاء"], body });
}
