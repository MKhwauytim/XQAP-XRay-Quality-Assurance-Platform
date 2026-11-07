// Report engine pitch deck (poc/pitch/OUTLINE.md), assembled with the real deck3 kit.
// Run: node poc/pitch/run.mjs   (loads this file through Vite's SSR loader)
// Output: poc/pitch/out/report-engine-pitch.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  coverSlide,
  contentsSlide,
  sectionDivider,
  slideShell,
  contentHead,
  kpiBand,
  dataTable,
  tintedPanel,
  closingSlide,
} from "../../src/data/reporting/executive/deck3/slideKit";
import type { OrgBlock, SlideMeta, TableCell } from "../../src/data/reporting/executive/deck3/slideKit";
import { buildDeckV3Html } from "../../src/data/reporting/executive/deck3/index";
import { DECK_V3_CSS } from "../../src/data/reporting/executive/deck3/theme";
import { esc } from "../../src/data/reporting/executive/primitives";
import { ZATCA_LOGO_URL, ORGANIZATION_PATH } from "../../src/branding/organization";

const ROOT = process.env.PITCH_ROOT ?? process.cwd();
const OUT = path.join(ROOT, "poc/pitch/out/report-engine-pitch.html");
const TOTAL = 27;
const PERIOD = "نوفمبر 2026";
const FOOT = `محرك التقارير · ${PERIOD}`;

const org: OrgBlock = {
  logoUrl: ZATCA_LOGO_URL,
  orgName: "هيئة الزكاة والضريبة والجمارك",
  lines: [ORGANIZATION_PATH[1], "ضمان جودة الأشعة"],
};

let n = 1;
const meta = (key: string, label: string): SlideMeta => ({ num: n++, total: TOTAL, sectionKey: key, sectionLabel: label, footText: FOOT });

// Pitch-local layout helpers. Only deck3 tokens, no new colours.
const PITCH_CSS = `<style>
.pp-fill{flex:1;display:flex;flex-direction:column;min-height:0;}
.pp-wrap .v3-table td{white-space:normal;line-height:1.3;}
.pp-wrap .v3-table td:first-child{font-weight:700;color:var(--v3-navy);}
.pp-wrap.lg .v3-table td{font-size:27px;height:auto;padding:16px 0 16px 18px;}
.pp-wrap.lg .v3-table th{font-size:25px;}
.pp-cols{display:grid;gap:36px;flex:1;min-height:0;}
.pp-note{font-size:24px;color:var(--v3-muted);margin-top:18px;}
.pp-shot{display:flex;flex-direction:column;gap:14px;}
.pp-shot img{width:100%;display:block;border:1px solid var(--v3-hair);}
.pp-shot b{font-size:30px;color:var(--v3-navy);}
.pp-shot span{font-size:23px;color:var(--v3-muted);}
.pp-list{margin:0;padding:0 28px 0 0;display:flex;flex-direction:column;gap:12px;font-size:25px;line-height:1.4;color:var(--v3-text);}
.pp-ask{display:grid;grid-template-columns:110px 1fr;gap:28px;align-items:start;padding:30px 0;border-top:1px solid var(--v3-hair);}
.pp-ask:first-child{border-top:2px solid var(--v3-navy);}
.pp-ask:last-child{border-bottom:2px solid var(--v3-navy);}
.pp-ask .num{font-size:64px;font-weight:700;color:var(--v3-gold);line-height:1;}
.pp-ask b{display:block;font-size:40px;color:var(--v3-navy);margin-bottom:10px;}
.pp-ask span{font-size:27px;color:var(--v3-muted);line-height:1.45;}
.v3-cover .v3-cover-h1{max-width:none;font-size:100px;}
.pp-kpi4 .v3-kpi-band{grid-template-columns:repeat(4,1fr);}
</style>`;

/** Keeps number+unit runs (4.14%, 154 KB, 0 EMU) in LTR order inside RTL cells. */
const bidi = (escaped: string): string => escaped.replace(/\d[\d.,]*%|\d[\d.,]* (?:KB|EMU)/g, (m) => `<bdi dir="ltr">${m}</bdi>`);
const td = (html: string, cls?: string): TableCell => ({ html: bidi(esc(html)), cls });
const rowsOf = (rows: string[][]): TableCell[][] => rows.map((r) => r.map((c) => td(c)));

function content(m: SlideMeta, title: string, body: string, note?: string): string {
  return slideShell(m, "", `${contentHead({ eyebrow: "", title, hideEyebrow: true, note })}
<div class="pp-fill">${body}</div>`);
}

function table(headers: string[], rows: string[][], opts: { first?: 14 | 26 | 28 | 36; lg?: boolean } = {}): string {
  return `<div class="pp-wrap${opts.lg ? " lg" : ""}">${dataTable({ headers, rows: rowsOf(rows), firstColWidth: opts.first })}</div>`;
}

const list = (items: string[]): string => `<ul class="pp-list">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

function pngData(rel: string): string {
  return `data:image/png;base64,${readFileSync(path.join(ROOT, rel)).toString("base64")}`;
}

/** Slide 8: one layout model feeding three renderers, drawn as inline SVG in deck3 tokens. */
function architectureSvg(): string {
  const box = (x: number, y: number, w: number, h: number, fill: string, rule: string, title: string, lines: string[]) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(${fill})"/>
  <rect x="${x}" y="${y}" width="${w}" height="6" fill="var(${rule})"/>
  <text x="${x + w - 32}" y="${y + 58}" text-anchor="start" direction="rtl" font-size="34" font-weight="700" fill="var(--v3-navy)">${esc(title)}</text>
  ${lines.map((l, i) => `<text x="${x + w - 32}" y="${y + 104 + i * 38}" direction="rtl" font-size="25" fill="var(--v3-text)">${esc(l)}</text>`).join("")}`;
  const outs = [
    { x: 1150, t: "HTML", l: ["العرض داخل التطبيق", "صناديق بمواضع مطلقة"] },
    { x: 590, t: "PDF", l: ["طباعة المتصفح", "نفس ملف HTML"] },
    { x: 30, t: "PowerPoint", l: ["ملف قابل للتعديل", "رسوم وجداول أصلية"] },
  ];
  const line = (x2: number) => `<path d="M860 300 V350 H${x2} V400" fill="none" stroke="var(--v3-navy)" stroke-width="3"/>`;
  return `<svg viewBox="0 0 1720 640" width="1720" height="640" xmlns="http://www.w3.org/2000/svg" font-family="Somar, Tahoma, sans-serif" role="img" aria-label="نموذج الترتيب يغذي ثلاثة مخرجات">
  ${box(430, 20, 860, 280, "--v3-panel", "--v3-navy", "نموذج الترتيب", ["كل صندوق بالبكسل على لوح 1920x1080", "يُقاس النص قبل الرسم", "مصدر الأرقام الوحيد للمخرجات الثلاثة"])}
  ${outs.map((o) => line(o.x + 270)).join("")}
  ${outs.map((o, i) => box(o.x, 400, 540, 220, i === 2 ? "--v3-sea" : i === 1 ? "--v3-panel" : "--v3-land", i === 2 ? "--v3-blue" : i === 1 ? "--v3-navy" : "--v3-gold", o.t, o.l)).join("")}
</svg>`;
}

export function buildSlides(): string {
  const s: string[] = [];

  // 1 Cover
  s.push(coverSlide({
    org,
    kicker: "عرض مقترح",
    title: "محرك التقارير: من تقرير مبني يدويًا إلى منصة قوالب",
    periodLabel: "التاريخ",
    periodValue: PERIOD,
    metaRows: [
      { label: "الموضوع", value: "محرك التقارير" },
      { label: "الحالة", value: "مقترح للقرار" },
      { label: "الفرع", value: "claude/pptx-poc", end: true },
    ],
    meta: meta("cover", "الغلاف"),
  }));

  // 2 Contents
  s.push(contentsSlide({
    eyebrow: "",
    hideEyebrow: true,
    title: "محتويات العرض",
    rows: [
      { index: 1, title: "المشكلة", description: "لماذا تُبنى التقارير بالكود ولماذا يختلف الباوربوينت.", pages: "ص 03-05" },
      { index: 2, title: "القرار", description: "قرارات 5 نوفمبر ونموذج الترتيب الواحد.", pages: "ص 06-08" },
      { index: 3, title: "الإثبات", description: "نتائج تجربة التصدير إلى PowerPoint.", pages: "ص 09-12" },
      { index: 4, title: "المحرك", description: "القدرات والكتالوج والرسوم والقواعد.", pages: "ص 13-21" },
      { index: 5, title: "الخطة", description: "المراحل والمخاطر والمطلوب منك.", pages: "ص 22-26" },
    ],
    meta: meta("contents", "المحتويات"),
  }));

  const divider = (ghost: string, kicker: string, title: string, desc: string, key: string) =>
    s.push(sectionDivider({ eyebrow: FOOT, ghost, kicker, title, description: desc, footItems: [], meta: meta(key, title) }));

  // 3
  divider("01", "القسم الأول", "المشكلة", "كيف تُبنى التقارير اليوم، ولماذا يطلع ملف الباوربوينت مختلفًا عن العرض.", "problem");

  // 4
  s.push(content(meta("problem", "المشكلة"), "التقارير اليوم تُبنى بالكود، وكل تقرير جديد يبدأ من الصفر", table(
    ["المشكلة", "ما يحدث فعلًا"],
    [
      ["لا يوجد محرك ترتيب", "ارتفاعات الصفوف أرقام ثابتة، والجدول الطويل يُقص بصمت فتضيع صفوف دون تنبيه."],
      ["الهيدر يلتف على 2 إلى 4 أسطر", "قاعدة CSS في تقرير المنفذ تتغلب على قاعدة عدم الالتفاف في deck3."],
      ["التصميم يعيش في الكود", "كل شريحة دالة TypeScript، فلا يمكن تصفحها أو ترقيمها أو إعادة استخدامها."],
      ["شكلان فقط للرسوم", "أعمدة وأعمدة مجمعة بسلسلتين، ولا شيء يختار الشكل المناسب للبيانات."],
      ["منطق الأشعة داخل المحرك", "حقول ومصطلحات المجال مخلوطة بالمحرك، فنقله اليوم يجر الأشعة معه."],
    ],
    { first: 36, lg: true },
  )));

  // 5
  s.push(content(meta("problem", "المشكلة"), "الباوربوينت يطلع مختلف لأن المتصفح هو اللي يرتب الصفحة", table(
    ["السبب", "الأثر في PowerPoint"],
    [
      ["الترتيب بـ flex وgrid", "لا مكافئ لهما في ملف PowerPoint، فالمواضع تُخمَّن أو تسقط."],
      ["الرسوم مبنية بـ CSS لا ببيانات", "تخرج مستطيلات ثابتة غير قابلة للتعديل بدل رسم أصلي."],
      ["خط Somar مضمن بصيغة WOFF", "PowerPoint لا يقرأ WOFF، فيستبدل الخط وتنكسر الأسطر."],
      ["الاتجاه من اليمين والهوامش الداخلية", "بدون إعدادات صريحة تنعكس الأرقام ويُضاف هامش لا وجود له في العرض."],
    ],
    { first: 36, lg: true },
  )));

  // 6
  divider("02", "القسم الثاني", "القرار", "ستة قرارات اتخذتها في 5 نوفمبر، ونموذج ترتيب واحد لكل المخرجات.", "decision");

  // 7
  s.push(content(meta("decision", "القرار"), "ستة قرارات اتخذتها في 5 نوفمبر", table(
    ["#", "القرار", "ما يعنيه"],
    [
      ["1", "إعادة البناء على نموذج ترتيب واحد", "HTML وPDF وPowerPoint من نفس الأرقام، وخطة P1 تتوقف بعد المهمة 3."],
      ["2", "تجربة PowerPoint أولًا", "شريحة مؤشرات ورسم قابل للتعديل وجدول عربي، قبل إعادة البناء."],
      ["3", "كتالوج يبدأ بـ 15 إلى 20 تصميمًا", "مأخوذة من شرائح deck3 الحقيقية، بأرقام ثابتة، ويكبر عند الطلب."],
      ["4", "أرقام لاتينية", "123 في الجداول والرسوم والنص."],
      ["5", "الإدارات الأخرى تختار من الكتالوج", "ترسل اختيارها وملف Excel، والمشرف يربط البيانات ويخرج التقرير."],
      ["6", "المحرر وجودة المخرج بنفس الأولوية", "العمل على الاثنين بالتوازي."],
    ],
    { first: 14, lg: true },
  )));

  // 8
  s.push(content(meta("decision", "القرار"), "نموذج ترتيب واحد يطلع منه HTML وPDF وPowerPoint بنفس الأرقام",
    `${architectureSvg()}
<p class="pp-note">اللوح <bdi dir="ltr">1920 x 1080 px = 12,192,000 x 6,858,000 EMU</bdi>، أي <bdi dir="ltr">6350 EMU</bdi> لكل بكسل.</p>`));

  // 9
  divider("03", "القسم الثالث", "الإثبات", "تجربة تصدير شريحة deck3 إلى PowerPoint ومقارنتها بالعرض.", "proof");

  // 10
  const crit: string[][] = [
    ["P1", "يفتح دون إصلاح", "ناجح"],
    ["P2", "الرسم قابل للتعديل من بياناته", "ناجح"],
    ["P3", "العربية والاتجاه والأرقام اللاتينية", "ناجح بعد تصحيحين"],
    ["P4", "أبعاد الجدول", "ناجح، فرق 0 EMU"],
    ["P5", "التطابق البصري", "قيس 4.14%، بلا حد معتمد"],
    ["P6", "حجم المكتبة", "قيس 154 KB مضغوط"],
    ["P7", "خط Somar في الطرفين", "جزئي، يُستبدل في PowerPoint"],
    ["P8", "تباعد الأسطر بالنقاط", "ناجح"],
  ];
  s.push(content(meta("proof", "الإثبات"), "التجربة نجحت: الملف قابل للتعديل والترتيب مطابق",
    `<div class="pp-kpi4">${kpiBand([
      { label: "معايير ناجحة", value: "6 / 8", sub: "و2 جزئيان أو بلا حد" },
      { label: "فرق عرض الجدول", value: "0", aside: "EMU", valueTone: "green" },
      { label: "فرق البكسلات", value: "4.14%", sub: "أغلبه من استبدال الخط" },
      { label: "حجم المكتبة", value: "154", aside: "KB gzip" },
    ], "top", true)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:22px">
${dataTable({ headers: ["#", "المعيار", "النتيجة"], rows: rowsOf(crit.slice(0, 4)), firstColWidth: 14, rowPx: 80 })}
${dataTable({ headers: ["#", "المعيار", "النتيجة"], rows: rowsOf(crit.slice(4)), firstColWidth: 14, rowPx: 80 })}
</div>`));

  // 11
  s.push(content(meta("proof", "الإثبات"), "نفس السلايد في الطرفين",
    `<div class="pp-cols" style="grid-template-columns:1fr 1fr;align-content:start">
  <div class="pp-shot"><b>HTML</b><img src="${pngData("poc/pptx/out/html.png")}" alt="الشريحة في HTML"/><span>لقطة Edge بحجم <bdi dir="ltr">1920 x 1080</bdi></span></div>
  <div class="pp-shot"><b>PowerPoint</b><img src="${pngData("poc/pptx/out/pptx.png")}" alt="الشريحة في PowerPoint"/><span>تصدير PowerPoint نفسه بحجم <bdi dir="ltr">1920 x 1080</bdi></span></div>
</div>
<p class="pp-note">الفرق الظاهر في شكل الحروف سببه استبدال خط Somar في PowerPoint، والمواضع والخطوط متطابقة.</p>`));

  // 12
  s.push(content(meta("proof", "الإثبات"), "أربع تصحيحات تعلمناها من التجربة", table(
    ["التصحيح", "ما وجدناه"],
    [
      ["حجم الخط = البكسل x 0.5", "قاعدة 0.75 في البحث خاطئة لهذا التحويل، فكان النص أكبر 1.5 مرة."],
      ["حذف خصائص charset الصينية", "المكتبة تكتبها لكل نص، فظهرت الأرقام اللاتينية رموزًا غريبة."],
      ["rtl=0 للنص الرقمي فقط", "بدونها تظهر النسبة مقلوبة، والتصحيح على مستوى الفقرة."],
      ["وحدات هامش خلايا الجدول", "بالبوصة إذا كانت كل القيم أقل من 1، وبالنقاط غير ذلك، ويجب تثبيتها."],
    ],
    { first: 36, lg: true },
  )));

  // 13
  divider("04", "القسم الرابع", "المحرك", "القدرات التي يقدمها المحرك، وكيف تمنع الأخطاء التي نراها اليوم.", "engine");

  // 14
  s.push(content(meta("engine", "المحرك"), "ثمان قدرات تصنع المحرك", table(
    ["القدرة", "ما تقدمه"],
    [
      ["ربط البيانات", "بيانات التطبيق وملفات Excel مربوطة بقاموس البيانات."],
      ["المعاملات", "المنفذ والشهر، ويتغير التقرير كله بتغييرها."],
      ["مكتبة كتل", "كتل بهوية deck3."],
      ["محرك قيود الترتيب", "يقيس قبل الرسم ويقسم الجدول الطويل."],
      ["أشكال الرسوم", "يُختار الشكل من شكل البيانات."],
      ["الكتالوج", "تصاميم مرقمة يُختار منها."],
      ["فحص التصميم", "قواعد آلية تمنع الأخطاء والشكل الآلي."],
      ["التصدير", "HTML وPDF وPPTX وXLSX."],
    ],
    { first: 36 },
  )));

  // 15
  s.push(content(meta("engine", "المحرك"), "الكتالوج: تصميم مرقم تختاره برقمه", `<div class="pp-cols" style="grid-template-columns:1fr 1fr">
${tintedPanel({ variant: "all", title: "ما فيه", padLg: true, body: list([
    "15 إلى 20 تصميمًا أوليًا مأخوذة من deck3.",
    "أرقام ثابتة حسب العائلة: COV، KPI، OBS، CMP، TRD، TBL.",
    "دليل تصاميم مصدّر بصيغة HTML يتصفحه أي أحد.",
    "قائمة مفضلة لكل مستخدم.",
  ]) })}
${tintedPanel({ variant: "land", title: "كيف تستخدمه الإدارات", padLg: true, body: list([
    "الإدارة تختار أرقام التصاميم من الدليل.",
    "ترسل ملف الاختيار مع ملف Excel.",
    "المشرف يربط البيانات ويبني التقرير.",
    "رقم التصميم لا يتغير، فالطلب يبقى صالحًا.",
  ]) })}
</div>`));

  // 16
  s.push(content(meta("engine", "المحرك"), "شكل الرسم يتحدد من شكل البيانات", `<div class="pp-cols" style="grid-template-columns:1.25fr 1fr">
${table(["شكل البيانات", "الشكل المقترح"], [
    ["1 إلى 5 عناصر", "أعمدة بقيم ظاهرة"],
    ["6 إلى 14 عنصرًا", "أعمدة كثيفة"],
    ["15 إلى 30 مرتبة", "أشرطة أفقية مرتبة"],
    ["أكثر من 30", "أعلى N ثم «أخرى»"],
    ["مقارنة 2 أو 3 أو 5 منافذ", "أعمدة مجمعة بعدد المنافذ"],
  ], { first: 36 })}
${tintedPanel({ variant: "sea", title: "كيف يُختار", body: list([
    "محلل يعد العناصر والسلاسل، ويميز الزمن من الفئات.",
    "جدول قواعد يحدد الشكل.",
    "الاختيار الآلي يعرض سببه.",
    "المالك يستطيع تجاوزه.",
  ]) })}
</div>
<p class="pp-note">الأمثلة قواعد مقترحة للتصميم، لا بيانات.</p>`));

  // 17
  s.push(content(meta("engine", "المحرك"), "الجدول الطويل ينتقل لسلايد «يتبع» بدل ما ينقص", table(
    ["القاعدة", "ما يحدث"],
    [
      ["الهيدر سطر واحد", "يُجرّب الاحتواء ثم التصغير ثم الاختصار، ولا يلتف."],
      ["القياس قبل الرسم", "يُحسب ارتفاع كل صف قبل وضعه على الشريحة."],
      ["التقسيم مع تكرار الهيدر", "الصفوف الزائدة تنتقل لشريحة «يتبع» بنفس الهيدر."],
      ["حد أدنى للخط 20px", "لا يُصغر النص تحت 20px لإدخال صفوف أكثر."],
    ],
    { first: 36, lg: true },
  )));

  // 18
  s.push(content(meta("engine", "المحرك"), "قواعد تمنع الشكل الآلي", `<div class="pp-cols" style="grid-template-columns:repeat(4,1fr);gap:24px">
${tintedPanel({ variant: "all", title: "Floor: لا يُشحن", body: list(["تباين 4.5:1 للنص.", "لا قص، بل «يتبع».", "لا رقم بلا مصدر.", "خط 20px على الأقل."]) })}
${tintedPanel({ variant: "land", title: "Reflex: عادات آلية", body: list(["لا عنوان صغير فوق كل عنوان.", "العنوان يقول النتيجة.", "عنصر رئيسي واحد لكل شريحة."]) })}
${tintedPanel({ variant: "sea", title: "Finish: إتقان", body: list(["تنسيق أرقام موحد.", "حواف على الشبكة.", "العناصر المتكررة في نفس مكانها."]) })}
${tintedPanel({ variant: "all", title: "Text: النص", body: list(["لا شرطة طويلة.", "لا رموز تعبيرية.", "جملة واحدة لكل ادعاء."]) })}
</div>
<p class="pp-note">Floor يمنع النشر، Reflex تحذير يُتجاوز بسبب مكتوب، Finish ملاحظة.</p>`));

  // 19
  s.push(content(meta("engine", "المحرك"), "كل رقم في التقرير له مصدر", table(
    ["الضمان", "كيف"],
    [
      ["أعمدة Excel مربوطة بالقاموس", "كل عمود يُطابق حقلًا معرفًا في قاموس البيانات."],
      ["المقياس يستخدم حقولًا مربوطة فقط", "لا مقياس على حقل غير مربوط."],
      ["مصدر لكل رقم", "يمكن تتبع كل رقم معروض إلى حقله."],
      ["لقطات حتمية", "نفس البيانات تعطي نفس التقرير، ويُقارن قبل وبعد كل تغيير."],
    ],
    { first: 36, lg: true },
  )));

  // 20
  s.push(content(meta("engine", "المحرك"), "المحرك مستقل والمجال حزمة", `<div class="pp-cols" style="grid-template-columns:1fr 1fr 1fr">
${tintedPanel({ variant: "all", title: "المحرك", padLg: true, body: list(["حدوده في src/engine.", "لا يعرف شيئًا عن الأشعة.", "يمكن نقله لنظام مستقل لاحقًا."]) })}
${tintedPanel({ variant: "land", title: "حزمة الأشعة", padLg: true, body: list(["أول حزمة مجال.", "حقولها ومصطلحاتها ونصوصها.", "تقرير المنفذ والعرض التنفيذي."]) })}
${tintedPanel({ variant: "sea", title: "حزم لاحقة", padLg: true, body: list(["الضرائب.", "القضايا.", "تُضاف دون تعديل المحرك."]) })}
</div>`));

  // 21
  s.push(content(meta("engine", "المحرك"), "اختبار القبول: تبني تقرير منفذ جدة بيدك",
    `<div class="pp-kpi4" style="--x:0">${kpiBand([
      { label: "شرائح التقرير", value: "15", aside: "أو أكثر" },
      { label: "قدرات يفرضها الاختبار", value: "9" },
      { label: "فرق مسموح في الأرقام", value: "0", valueTone: "green" },
    ], "top", true)}</div>
${table(["الشرط", "التفصيل"], [
    ["بدون كود خاص بالتقرير", "رفع ملفات الدراسات والمجتمع وتأكيد ربط الأعمدة فقط."],
    ["مطابقة شريحة بشريحة", "نفس الأرقام بالدقة المعروضة، ونفس عدد الصفحات والترتيب."],
    ["تغيير المنفذ", "كل شريحة يتغير نطاقها بشكل صحيح."],
  ], { first: 36 })}`));

  // 22
  divider("05", "القسم الخامس", "الخطة", "المراحل والمخاطر والقرارات المفتوحة، وما أحتاجه منك.", "plan");

  // 23
  s.push(content(meta("plan", "الخطة"), "خمس مراحل، نبدأ بإصلاح الهيدر", table(
    ["المرحلة", "المدة", "المحتوى"],
    [
      ["0. إصلاحات اليوم", "أيام", "إصلاح التفاف الهيدر في تقرير المنفذ، وتثبيت قرارات العربية في المواصفة."],
      ["1. العمود الفقري", "3 إلى 5 أسابيع", "نظام ألوان واحد، نموذج المستند، حدود المحرك، محرك الترتيب."],
      ["2. ما يراه المالك", "3 إلى 4 أسابيع", "الكتالوج، تذييل المصدر، تحسين المحرر، تحويل تقرير المنفذ إلى قالب."],
      ["3. أشكال الرسوم", "4 إلى 6 أسابيع", "المحلل والقواعد، المقارنات والاتجاهات، دليل التصاميم."],
      ["4. النقل والتجريد", "لاحقًا", "عقد الربط، حزم المجال، ترحيل تصاميم الإصدار الأول."],
    ],
    { first: 26, lg: true },
  ), "المدد تقدير"));

  // 24
  s.push(content(meta("plan", "الخطة"), "المخاطر التي نعرفها", table(
    ["الخطر", "ما نفعله"],
    [
      ["خط Somar غير مثبت على مستوى الجهاز", "PowerPoint يستبدله (P7). يُثبت على كل جهاز أو نختار خطًا آخر."],
      ["حجم الملف يزيد", "حوالي 154 KB مضغوط للمكتبة، ويُقرأ الفرق في كل طلب دمج."],
      ["تصاميم Report Designer الحالية", "تحتاج ترحيلًا مع أرشفة الأصل، دون حذف."],
      ["تاريخ أخطاء التوقيت", "الاختبار أولًا ثم المراجعة لكل تغيير."],
    ],
    { first: 36, lg: true },
  )));

  // 25
  s.push(content(meta("plan", "الخطة"), "قرارات ما زالت مفتوحة", table(
    ["القرار", "الخيارات"],
    [
      ["استراتيجية الخط", "تثبيت Somar على كل الأجهزة، أو خط عربي من Office في المخرجين."],
      ["PDF عبر طباعة المتصفح", "هل نعتمده قيدًا دائمًا؟"],
      ["المقاييس", "دوال مسجلة فقط؟"],
      ["تعديل القوالب", "من يحق له التعديل؟"],
      ["ملفات Excel المرفوعة", "هل تُحفظ في مساحة العمل؟"],
      ["حد التطابق البصري P5", "يُحدد بعد حل مشكلة الخط."],
    ],
    { first: 36 },
  )));

  // 26
  const asks = [
    ["قرر استراتيجية الخط", "تثبيت Somar على كل الأجهزة، أو خط عربي من Office في HTML وPowerPoint معًا."],
    ["وافق على المرحلة 0", "إصلاح التفاف الهيدر في تقرير المنفذ، خلال أيام."],
    ["وافق على إعادة تخطيط P1", "على نموذج الترتيب الجديد بدل خطة الكتل الحالية."],
  ];
  s.push(content(meta("plan", "الخطة"), "المطلوب منك الآن", `<div>${asks
    .map((a, i) => `<div class="pp-ask"><span class="num">${i + 1}</span><div><b>${esc(a[0])}</b><span>${esc(a[1])}</span></div></div>`)
    .join("")}</div>`));

  // 27
  s.push(closingSlide({
    org,
    kicker: "ختام العرض",
    title: "محرك التقارير",
    closingLine: "نموذج ترتيب واحد، ثلاثة مخرجات، ونفس الأرقام.",
    metaRows: [
      { label: "التاريخ", value: PERIOD },
      { label: "الحالة", value: "مقترح للقرار", end: true },
    ],
    meta: meta("closing", "ختام العرض"),
  }));

  if (s.length !== TOTAL) throw new Error(`expected ${TOTAL} slides, built ${s.length}`);
  return PITCH_CSS + "\n" + s.join("\n");
}

/** Hard rules from OUTLINE.md. Throws on any violation. */
export function checkRules(html: string): void {
  const problems: string[] = [];
  const dash = html.match(/[—–]/g);
  if (dash) problems.push(`long dash x${dash.length}`);
  const sym = html.match(/[☀-➿✓✔✗]|[\u{1F300}-\u{1FAFF}]/gu);
  if (sym) problems.push(`emoji/symbol: ${[...new Set(sym)].join(" ")}`);
  const arabicDigits = html.match(/[٠-٩۰-۹]/g);
  if (arabicDigits) problems.push(`non-Latin digits x${arabicDigits.length}`);
  // Eyebrows only on section dividers: no content-slide eyebrow element at all.
  const eyebrows = (html.match(/class="v3-eyebrow"/g) ?? []).length;
  if (eyebrows) problems.push(`content eyebrow x${eyebrows}`);
  const slides = (html.match(/<section class="slide v3/g) ?? []).length;
  if (slides !== TOTAL) problems.push(`slide count ${slides}`);
  if (problems.length) throw new Error(`pitch rule check failed: ${problems.join("; ")}`);
}

export async function main(): Promise<void> {
  const slides = buildSlides();
  const html = buildDeckV3Html(slides, PERIOD, { title: "محرك التقارير", navBrand: "محرك التقارير", toolbarBrand: "محرك التقارير" });
  checkRules(html);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, html, "utf8");
  console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB, ${TOTAL} slides)`);

  const shots = process.env.PITCH_SHOTS_DIR;
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const head = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><style>${DECK_V3_CSS}
html,body{margin:0;background:var(--v3-bg);} .slide.v3{transform:none;margin:0;box-shadow:none;border:none;}</style></head><body>`;
    const parts = slides.split(/(?=<section class="slide v3)/);
    const css = parts.shift() ?? "";
    parts.forEach((p, i) => writeFileSync(path.join(shots, `slide-${i + 1}.html`), `${head}${css}${p}</body></html>`, "utf8"));
    console.log(`wrote ${parts.length} per-slide files to ${shots}`);
  }
}
