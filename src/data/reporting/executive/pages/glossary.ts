import type { ExecutiveRenderContext } from "../context";
import { esc } from "../primitives";
import { ORGANIZATION_PATH_TEXT } from "../../../../branding/organization";

function orgHeader(): string {
  const lines = ORGANIZATION_PATH_TEXT.split(" ← ").map(l => `<div>${esc(l)}</div>`).join("");
  return `<div class="xr-org-header">
    <div class="xr-org-text">${lines}</div>
    <div class="xr-org-logo">🛡</div>
  </div>`;
}

const LEVELS = [
  { cls: "xr-l1-card", icon: "🥇", title: "المستوى الأول", sub: "حالات الضبط المؤكدة", body: "الحالات التي تتضمن حوادث ضبط أمنية أو جودة قرارات التجاوز للأنظمة، ولم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما." },
  { cls: "xr-l2-card", icon: "🔍", title: "المستوى الثاني", sub: "حالات الاشتباه المؤكدة", body: "الحالات التي لم يتم الاشتباه بها من قبل كلا المستويين أو أحدهما، وتم الاشتباه بها من أحد الفرق الأمنية الأخرى." },
  { cls: "xr-l3-card", icon: "⚡", title: "المستوى الثالث", sub: "حالات محرك المخاطر", body: "الحالات التي تتضمن مدخلات مخاطر ولم يتم الاشتباه بها من المستوى الأول والثاني." },
  { cls: "xr-l4-card", icon: "📡", title: "المستوى الرابع", sub: "اشتباه الأشعة غير المؤكد", body: "الحالات التي تم الاشتباه بها من قبل المستوى الأول أو الثاني في صور الأشعة ولم يتم تأكيد الاشتباه." },
];

const TERMS = [
  { icon: "✅", name: "سليمة", def: "حالة لم يُكتشف فيها اشتباه من قبل نتائج فحص الأشعة." },
  { icon: "⚠️", name: "اشتباه", def: "حالة اكتُشف فيها اشتباه من أحد مستويات فحص الأشعة." },
  { icon: "👥", name: "مجتمع الحالات", def: "مجموع جميع حالات الأشعة المستوردة للشهر المحدد." },
  { icon: "🎯", name: "العينة", def: "مجموعة الحالات المختارة عشوائياً للمراجعة والتحقق." },
  { icon: "🔍", name: "CertScan", def: "نوع فحص الأشعة المعتمد والمرخص (Certscan)." },
  { icon: "📊", name: "مطابقة BI", def: "مدى تطابق بيانات BI مع بيانات الأشعة المستوردة." },
  { icon: "📋", name: "التوزيع", def: "عملية توزيع حالات العينة على الموظفين للمراجعة." },
  { icon: "🎖", name: "الدقة الإجمالية", def: "نسبة الحالات التي تطابق فيها حكم الخبير مع نتيجة الأشعة." },
];

export function buildGlossary(_ctx: ExecutiveRenderContext): string {
  const cards = LEVELS.map(l => `
    <div class="xr-level-card ${l.cls}">
      <div class="xr-level-card-head">
        <div class="xr-level-card-icon">${l.icon}</div>
        <h3>${esc(l.title)}</h3>
        <span>${esc(l.sub)}</span>
      </div>
      <div class="xr-level-card-body">${esc(l.body)}</div>
      <div class="xr-level-card-bar"></div>
    </div>`).join("");

  const terms = TERMS.map(t => `
    <div class="xr-term">
      <div class="xr-term-icon">${t.icon}</div>
      <div class="xr-term-name">${esc(t.name)}</div>
      <div class="xr-term-def">${esc(t.def)}</div>
    </div>`).join("");

  return `<section class="xr-page" id="page-glossary">
    <div class="xr-page-inner">
      ${orgHeader()}
      <h2 class="xr-page-title">المعجم ودلالات المستويات</h2>
      <div class="xr-level-cards">${cards}</div>
      <div class="xr-glossary-sep">معجم المصطلحات</div>
      <div class="xr-terms-grid">${terms}</div>
      <div class="xr-page-num">• 05 •</div>
    </div>
  </section>`;
}
