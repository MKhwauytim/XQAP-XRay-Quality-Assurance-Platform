// PoC tests T1, T3, T4, T5, T6, T7 (study v2 section 7). One measured layout feeds HTML and PPTX.
// Run: node poc/pptx/tests.mjs && pwsh poc/pptx/renderT.ps1 && node poc/pptx/checkT.mjs
// Env NUMFIX = run | lrm | iso | none picks the number fix applied outside the T1 grid (T1 grid shows all).
// "run" (default, the one that passed T1): Latin/digit tokens become their own run with <a:rtl val="0"/>.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";
import { C, EMU_PER_PX, FONT, SLIDE, pxToIn, pxToPt } from "./model.mjs";
import { fontFaceCss, measure, screenshot, SOMAR_TTF } from "./edge.mjs";
import { buildEot, readFontInfo } from "./eot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out", "t");
mkdirSync(OUT, { recursive: true });
const NUMFIX = process.env.NUMFIX || "run";

// -- number direction fixes (T1) ----------------------------------------------
const NUM_RE = /[0-9][0-9.,%\-/:]*/g;
const LTR_RE = /[A-Za-z0-9][A-Za-z0-9.,%\-/:+]*/g;
export function ltrRuns(s) {
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(LTR_RE)) {
    if (m.index > last) parts.push({ t: s.slice(last, m.index), ltr: false });
    parts.push({ t: m[0], ltr: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ t: s.slice(last), ltr: false });
  return parts;
}
const pRuns = (s) => (NUMFIX === "run" ? ltrRuns(s).map((p) => ({ text: p.t, options: { lang: p.ltr ? "en-US" : "ar-SA" } })) : [{ text: fixNums(s), options: {} }]);
const LRM = "‎", LRI = "⁦", PDI = "⁩";
export function fixNums(s, how = NUMFIX) {
  if (how === "lrm") return s.replace(NUM_RE, (t) => LRM + t + LRM);
  if (how === "iso") return s.replace(NUM_RE, (t) => LRI + t + PDI);
  return s;
}
const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const htmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const emu = (px) => Math.round(px * EMU_PER_PX);

// -- fixtures ----------------------------------------------------------------
const T1_CASES = [
  { id: "pct", label: "نسبة", text: "85.5%" },
  { id: "thou", label: "رقم بفاصلة آلاف", text: "48,250" },
  { id: "sent", label: "رقم داخل جملة", text: "بلغت نسبة المطابقة 85.5% من أصل 48,250 حالة" },
  { id: "date", label: "تاريخ", text: "2026-11-05" },
];
const T1_VARIANTS = [
  { id: "none", label: "بدون إصلاح" },
  { id: "lrm", label: "U+200E حول الرقم" },
  { id: "iso", label: "U+2066 و U+2069" },
  { id: "run", label: "تشغيل منفصل LTR" },
];

const PORT_WORDS = ["ميناء", "منفذ", "مطار"];
const PLACES = ["جدة", "الدمام", "البطحاء", "الحديثة", "الرياض", "الوديعة", "الخفجي", "حالة عمار", "الرقعي", "جازان", "ينبع", "ضباء", "سلوى", "الربع الخالي", "الدرة", "القريات", "عرعر", "تبوك", "أبها", "الطوال"];
const T3_ROWS = Array.from({ length: 40 }, (_, i) => {
  const studied = 120 + ((i * 37) % 300), matched = Math.round(studied * (0.72 + ((i * 13) % 25) / 100));
  const day = String(1 + (i % 28)).padStart(2, "0");
  return [`${PORT_WORDS[i % 3]} ${PLACES[i % 20]} ${i + 1}`, (studied * 41).toLocaleString("en-US"), matched.toLocaleString("en-US"), ((matched / studied) * 100).toFixed(1) + "%", `2026-10-${day}`];
});
const T3_HEADER = ["المنفذ", "الصور المدروسة", "المطابقة", "نسبة المطابقة", "تاريخ آخر دراسة"];

// 22 real header/label texts from portReportHtml.ts (relaxed-thompson worktree) + 18 synthetic long ones.
const T4_REAL = [
  "إجمالي الموظفين المخصصين", "إجابات المستوى الأول", "إجابات المستوى الثاني", "الخط الزمني لنسبة التوائم",
  "اشتباه صحيح / سليمة صحيحة", "الموظف المخصص للمنفذ", "الموظفون المدروسة حالاتهم", "التفصيل حسب نوع المنفذ",
  "المقارنة على مستوى إجابات كل مستوى على حدة", "المجتمع غير مقسَّم حسب السنة في ملف البيانات",
  "حسب سنة دخول الصورة (المجتمع) وسنة التقاطها (العينة)", "حالة على الأقل من صور المنفذ في الشهر",
  "حالة لكل منهم (مستبعدون من مستويات الدقة)", "الصور بلا كود موظف لا تدخل في الحساب",
  "حالات الموظفين المخصصين للمنفذ في الشهر (المستوى الأول والثاني) ÷ عددهم",
  "الصور التي اكتمل فحصها من قبل أخصائي ضمان جودة الأشعة وتشملها أرقام النتائج",
  "الإجابات المتوافقة ÷ الإجابات المدروسة في المستويين، والترتيب من الأعلى إلى الأدنى",
  "الحالات التي تم الاتفاق على نتيجتها بين الوسائل الآلية وأخصائي ضمان جودة الأشعة، من إجمالي الحالات المدروسة",
  "تم احتساب الفئات بناءً على الفرق بين أقل معدل دقة وأعلى معدل دقة مقسومًا على ثلاثة، وكل فئة مقسمة إلى ثلاثة أعمدة",
  "جميع صور الأشعة الواردة خلال فترة التقرير، موزعة حسب نوع المنفذ", "المجتمع والعينة المدروسة في جميع المنافذ", "إجمالي الصور المدروسة",
];
const T4_SYN = [
  "نسبة الاشتباه الصحيح", "نسبة الاشتباه الخاطئ في المستوى الأول", "عدد الصور المحالة للمستوى الثاني",
  "متوسط زمن الدراسة لكل صورة بالدقائق", "نسبة التوافق بين المستويين في المنافذ البحرية",
  "عدد الحالات الفائتة التي اكتشفها أخصائي ضمان الجودة", "نسبة الصور المستبعدة لعدم وضوح الصورة أو تلفها",
  "الحالات المطابقة من إجمالي الحالات المدروسة في المستوى الأول", "عدد الموظفين الذين درسوا أقل من الحد الأدنى من الحالات",
  "نسبة الحالات المعاد فتحها بعد الاعتماد النهائي", "الفرق بين نسبة المنفذ ومتوسط جميع المنافذ بالنقاط المئوية",
  "إجمالي الحالات المدروسة في المنافذ البرية والبحرية والجوية خلال فترة التقرير كاملة",
  "عدد الصور التي لم يتم ربطها بكود موظف بسبب نقص البيانات في ملف المصدر",
  "نسبة الاشتباه الفائت في المستوى الثاني بعد استبعاد الحالات المكررة والحالات غير المكتملة",
  "متوسط عدد الحالات المدروسة لكل موظف مخصص للمنفذ في الشهر الواحد حسب سجل التوزيع المعتمد",
  "نسبة الحالات التي اختلفت فيها نتيجة الوسائل الآلية عن نتيجة أخصائي ضمان الجودة في المستويين الأول والثاني معًا خلال الشهر",
  "نسبة الحالات التي أعيدت دراستها بعد اعتراض الموظف على النتيجة واعتماد المشرف للاعتراض وإعادة التوزيع على موظف آخر من نفس المنفذ أو من منفذ مختلف خلال نفس الشهر أو الشهر التالي له مباشرة مع احتساب الحالات المكررة مرة واحدة فقط في جميع المستويات", "الحالات",
];
const T4_HEADERS = [...T4_REAL, ...T4_SYN];

// -- measurement (Edge canvas, Somar) ----------------------------------------
const T4 = { tableW: 1720, colW: [340, 276, 276, 276, 276, 276], pad: 12, base: 25, testCol: 1, lineH: 34 };
const T4_MIN_SIZE = Math.max(20, T4.base * 0.85); // 21.25px
const T4_OTHER_HEADERS = ["المنفذ", "العدد", "النسبة", "التاريخ", "الإجمالي"];
const T4_DATA = ["ميناء جدة الإسلامي", "48,250", "85.5%", "2026-11-05", "1,026", "320"];

const splitCands = (t) => {
  const sp = [...t.matchAll(/ /g)].map((m) => m.index);
  return sp.map((i) => [t.slice(0, i), t.slice(i + 1)]);
};
const mItems = [];
const want = (t, w = 400) => { mItems.push({ t, w }); return mItems.length - 1; };
// Headers render bold (700) in both outputs, so they are measured bold.
const t4idx = T4_HEADERS.map((h) => ({ full: want(h, 700), splits: splitCands(h).map(([a, b]) => [want(a, 700), want(b, 700)]) }));
const t4other = T4_OTHER_HEADERS.map((h) => want(h, 700));
const t4data = T4_DATA.map((d) => want(d));
const t3cells = T3_ROWS.map((r) => r.map((v) => want(v)));
const t3head = T3_HEADER.map((h) => want(h, 700));
const t1Titles = ["T1 الاتجاه: كل فقرة من اليمين ومحاذاة لليمين", "تفاصيل المنافذ", "تفاصيل المنافذ (يتبع)"].map((t) => want(t, 700));
const shapeLabels = ["بيانات Excel", "نموذج التخطيط (قياس واحد)", "HTML", "PDF", "PowerPoint"].map((t) => want(t, 700));
const freeLabel = want("شكل حر قابل للتعديل", 700);
// PowerPoint lays Somar out slightly wider than Chromium canvas measureText (8 of 40 T4 headers wrapped
// one extra line at factor 1.00 with real Somar loaded). FIT_SAFETY pads every measured width.
const FIT_SAFETY = Number(process.env.FIT_SAFETY ?? 1.04);
const K = measure(mItems, OUT).map((k) => k * FIT_SAFETY);
const W = (i, size) => K[i] * size;

// -- T4 ladder ---------------------------------------------------------------
function ladder(hi, h) {
  const cw = T4.colW[T4.testCol] - 2 * T4.pad;
  const full = W(t4idx[hi].full, T4.base);
  const colW = [...T4.colW];
  if (full <= cw) return { step: 1, size: T4.base, lines: [h], colW };
  const s = Math.floor((cw / K[t4idx[hi].full]) * 2) / 2; // 0.5px steps
  if (s >= T4_MIN_SIZE) return { step: 2, size: s, lines: [h], colW };
  // step 3: widen at the expense of number columns (min = widest content in that column + padding)
  const others = colW.map((w, c) => ({ c, w })).filter((o) => o.c !== 0 && o.c !== T4.testCol);
  // header of column c (c >= 2) is T4_OTHER_HEADERS[c - 1]; its data cell is T4_DATA[c]
  const minOf = (c) => Math.ceil(Math.max(W(t4other[c - 1], T4.base), W(t4data[c], T4.base))) + 2 * T4.pad;
  const slack = others.map((o) => ({ ...o, min: minOf(o.c) }));
  const totalSlack = slack.reduce((a, o) => a + Math.max(0, o.w - o.min), 0);
  const maxCw = cw + totalSlack;
  const take = (need) => {
    const nw = [...colW];
    nw[T4.testCol] += need;
    for (const o of slack) nw[o.c] -= (need * Math.max(0, o.w - o.min)) / totalSlack;
    return nw.map((v) => Math.round(v * 100) / 100);
  };
  if (full <= maxCw) return { step: 3, size: T4.base, lines: [h], colW: take(Math.ceil(full - cw) + 1) };
  // step 4: two balanced lines (split minimizing the longer line), base size, widen only as needed
  let best = null;
  for (const [a, b] of t4idx[hi].splits) {
    const m = Math.max(W(a, T4.base), W(b, T4.base));
    if (!best || m < best.m) best = { m, a, b };
  }
  if (best && best.m <= maxCw) {
    const sp = splitCands(h)[t4idx[hi].splits.findIndex(([a]) => a === best.a)];
    const need = Math.max(0, Math.ceil(best.m - cw) + 1);
    return { step: 4, size: T4.base, lines: sp, colW: need ? take(need) : colW };
  }
  return { step: 5, error: "العنوان أطول من المساحة", size: T4.base, lines: [h], colW };
}
const t4res = T4_HEADERS.map((h, i) => ({ i: i + 1, text: h, real: i < T4_REAL.length, ...ladder(i, h) }));
const steps = [1, 2, 3, 4, 5].map((s) => t4res.filter((r) => r.step === s).length);

// -- slide model (px) --------------------------------------------------------
// Every slide is a list of items; toPptx and toHtml below both read the same numbers.
const slides = [];
const title = (text, y = 60) => ({ kind: "text", text, x: 100, y, w: 1720, h: 64, size: 44, weight: 700, color: C.navy, lineH: 64 });

// T1: case x variant grid + rtl table
{
  const items = [title("T1 الاتجاه: كل فقرة من اليمين ومحاذاة لليمين")];
  const colW = 400, rowH = 120, gx = 1840, gy = 170;
  T1_VARIANTS.forEach((v, j) => items.push({ kind: "text", text: v.label, x: gx - 210 - (j + 1) * colW, y: gy, w: colW - 20, h: 40, size: 24, weight: 700, color: C.muted, lineH: 40 }));
  T1_CASES.forEach((c, i) => {
    const y = gy + 60 + i * rowH;
    items.push({ kind: "text", text: c.label, x: gx - 200, y, w: 200, h: 50, size: 26, weight: 700, color: C.text, lineH: 50 });
    T1_VARIANTS.forEach((v, j) => {
      const x = gx - 210 - (j + 1) * colW;
      items.push({ kind: "rect", x, y: y - 10, w: colW - 20, h: rowH - 20, fill: "ffffff", crop: `t1-${c.id}-${v.id}` });
      items.push({ kind: "ntext", src: c.text, variant: v.id, x: x + 10, y, w: colW - 40, h: 60, size: c.id === "sent" ? 17 : 40, weight: 700, color: C.navy, lineH: 60 });
    });
  });
  items.push({
    kind: "table", x: 100, y: 720, colW: [420, 300, 300, 300, 400], rowH: 52, size: 24,
    header: ["البند", "الإجمالي", "المطابقة", "النسبة", "التاريخ"],
    rows: [["ميناء جدة الإسلامي", "48,250", "41,254", "85.5%", "2026-11-05"], ["منفذ البطحاء", "12,040", "10,510", "87.3%", "2026-10-28"]],
    crop: "t1-table",
  });
  slides.push({ id: "T1", items });
}

// T3: 40 rows paginated from the measured layout
const T3 = { x: 100, y: 180, colW: [520, 300, 300, 300, 300], headH: 60, rowH: 50, size: 24, pad: 12, bottom: 1000 };
const t3fit = [];
T3_ROWS.forEach((r, ri) => r.forEach((v, c) => { const w = W(t3cells[ri][c], T3.size); if (w > T3.colW[c] - 2 * T3.pad) t3fit.push({ ri, c, w }); }));
T3_HEADER.forEach((h, c) => { const w = W(t3head[c], T3.size); if (w > T3.colW[c] - 2 * T3.pad) t3fit.push({ head: c, w }); });
const perPage = Math.floor((T3.bottom - T3.y - T3.headH) / T3.rowH);
const t3pages = [];
for (let i = 0; i < T3_ROWS.length; i += perPage) t3pages.push(T3_ROWS.slice(i, i + perPage));
t3pages.forEach((rows, p) => {
  slides.push({
    id: `T3-${p + 1}`, t3: true,
    items: [
      title(p === 0 ? "تفاصيل المنافذ" : "تفاصيل المنافذ (يتبع)"),
      { kind: "text", text: `صفحة ${p + 1} من ${t3pages.length}`, x: 100, y: 1020, w: 1720, h: 36, size: 20, weight: 400, color: C.muted, lineH: 36 },
      { kind: "table", x: T3.x, y: T3.y, colW: T3.colW, rowH: T3.rowH, headH: T3.headH, size: T3.size, header: T3_HEADER, rows },
    ],
  });
});

// T4: 40 header cases, packed onto slides by measured height
{
  let cur = null, y = 0;
  const top = 150, limit = 1020, gap = 22, dataH = 48;
  t4res.forEach((r) => {
    const headH = r.lines.length === 2 ? 2 * T4.lineH + 16 : T4.lineH + 22;
    const blockH = headH + dataH + gap;
    if (!cur || y + blockH > limit) {
      cur = { id: `T4-${slides.filter((s) => s.id.startsWith("T4")).length + 1}`, items: [title("T4 العناوين الطويلة: سلم الملاءمة")] };
      slides.push(cur);
      y = top;
    }
    const header = [`${r.i} | الخطوة ${r.step}`, null, ...T4_OTHER_HEADERS.slice(1)];
    header[T4.testCol] = r.step === 5 ? "خطأ: لا يتسع" : r.lines; // full message lives in r.error
    cur.items.push({ kind: "table", t4: r, x: 100, y, colW: r.colW, rowH: dataH, headH, size: T4.base, headSize: r.size, header, rows: [T4_DATA.slice(0, 6)] });
    y += blockH;
  });
}

// T5: diagram as grouped shapes and connectors (slide-8 style)
const diagram = (() => {
  const box = (id, text, x, y, w, h, fill, color) => ({ id, text, x, y, w, h, fill, color });
  const nodes = [
    box("src", "بيانات Excel", 1480, 470, 300, 140, C.hair, C.text),
    box("model", "نموذج التخطيط (قياس واحد)", 860, 450, 540, 180, C.navy, "ffffff"),
    box("html", "HTML", 380, 250, 300, 120, C.blue, "ffffff"),
    box("pdf", "PDF", 380, 480, 300, 120, C.blue, "ffffff"),
    box("pptx", "PowerPoint", 380, 710, 300, 120, C.blue, "ffffff"),
  ];
  const edges = [["src", "model"], ["model", "html"], ["model", "pdf"], ["model", "pptx"]];
  return { nodes, edges };
})();
// G6 for the diagram: each label must fit its box minus the 28px insets (measured, bold 30px).
const diagramFit = diagram.nodes.map((n, k) => ({ id: n.id, need: Math.ceil(W(shapeLabels[k], 30)), avail: n.w - 56, fits: W(shapeLabels[k], 30) <= n.w - 56 }));
slides.push({ id: "T5", items: [title("T5 المخطط كأشكال مجمعة"), { kind: "diagram", ...diagram }] });

// T6: freeform (custom geometry), coordinates px relative to the shape box
const FREE = {
  x: 560, y: 260, w: 800, h: 560, fill: C.gold,
  pts: [[0, 280], [220, 0], [800, 120], [640, 560], [160, 520]],
  text: "شكل حر قابل للتعديل",
};
const FREE_PAD = 202; // keeps the right-aligned label inside the slanted right edge
const freeFit = { need: Math.ceil(W(freeLabel, 32)), avail: FREE.w - 2 * FREE_PAD, fits: W(freeLabel, 32) <= FREE.w - 2 * FREE_PAD };
slides.push({ id: "T6", items: [title("T6 الشكل الحر"), { kind: "free", ...FREE }] });

// -- PPTX --------------------------------------------------------------------
const geo = (b) => ({ x: pxToIn(b.x), y: pxToIn(b.y), w: pxToIn(b.w), h: pxToIn(b.h) });
const textBase = { fontFace: FONT, rtlMode: true, lang: "ar-SA", margin: 0, fit: "none", valign: "top", wrap: false, align: "right" };
const rawById = {};
let rawSeq = 0;
const marker = () => `@@RAW${++rawSeq}@@`;

function runXml(text, { size, weight, color, ltr }) {
  const rtlEl = ltr ? '<a:rtl val="0"/>' : "";
  return `<a:r><a:rPr lang="${ltr ? "en-US" : "ar-SA"}" sz="${Math.round(pxToPt(size) * 100)}" b="${weight >= 700 ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/>${rtlEl}</a:rPr><a:t>${xmlEsc(text)}</a:t></a:r>`;
}
function ntextRuns(b) {
  if (b.variant === "run") {
    const parts = [];
    let last = 0;
    for (const m of b.src.matchAll(NUM_RE)) {
      if (m.index > last) parts.push({ t: b.src.slice(last, m.index), ltr: false });
      parts.push({ t: m[0], ltr: true });
      last = m.index + m[0].length;
    }
    if (last < b.src.length) parts.push({ t: b.src.slice(last), ltr: false });
    return parts.map((p) => runXml(p.t, { ...b, ltr: p.ltr })).join("");
  }
  return runXml(fixNums(b.src, b.variant), b);
}
let spId = 5000;
function spXml({ name, x, y, w, h, geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', fill, line, runs, anchor = "t", ins = 0, txBox = true }) {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>";
  const lnXml = line ? `<a:ln w="${emu(line.w)}"><a:solidFill><a:srgbClr val="${line.color}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${++spId}" name="${xmlEsc(name)}"/><p:cNvSpPr${txBox ? ' txBox="1"' : ""}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>${geom}${fillXml}${lnXml}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="${emu(ins)}" tIns="0" rIns="${emu(ins)}" bIns="0" anchor="${anchor}" rtlCol="1"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="r" rtl="1"/>${runs}</a:p></p:txBody></p:sp>`;
}
function diagramXml(d) {
  const ids = {};
  const parts = d.nodes.map((n) => {
    const xml = spXml({ name: `node-${n.id}`, x: n.x, y: n.y, w: n.w, h: n.h, geom: '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>', fill: n.fill, runs: runXml(n.text, { size: 30, weight: 700, color: n.color }), anchor: "ctr", ins: 28, txBox: false });
    ids[n.id] = spId;
    return xml;
  });
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  for (const [a, b] of d.edges) {
    const s = byId[a], t = byId[b];
    // RTL flow: from the source's left edge (site idx 1) to the target's right edge (idx 3)
    const x1 = s.x, y1 = s.y + s.h / 2, x2 = t.x + t.w, y2 = t.y + t.h / 2;
    const flipH = x2 < x1, flipV = y2 < y1;
    const off = { x: Math.min(x1, x2), y: Math.min(y1, y2) }, ext = { w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    parts.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${++spId}" name="edge-${a}-${b}"/><p:cNvCxnSpPr><a:stCxn id="${ids[a]}" idx="1"/><a:endCxn id="${ids[b]}" idx="3"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>` +
      `<p:spPr><a:xfrm${flipH ? ' flipH="1"' : ""}${flipV ? ' flipV="1"' : ""}><a:off x="${emu(off.x)}" y="${emu(off.y)}"/><a:ext cx="${emu(ext.w)}" cy="${emu(ext.h)}"/></a:xfrm>` +
      `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="${emu(4)}"><a:solidFill><a:srgbClr val="${C.muted}"/></a:solidFill><a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`);
  }
  const bx = Math.min(...d.nodes.map((n) => n.x)), by = Math.min(...d.nodes.map((n) => n.y));
  const bw = Math.max(...d.nodes.map((n) => n.x + n.w)) - bx, bh = Math.max(...d.nodes.map((n) => n.y + n.h)) - by;
  const xf = `<a:off x="${emu(bx)}" y="${emu(by)}"/><a:ext cx="${emu(bw)}" cy="${emu(bh)}"/><a:chOff x="${emu(bx)}" y="${emu(by)}"/><a:chExt cx="${emu(bw)}" cy="${emu(bh)}"/>`;
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${++spId}" name="diagram-group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>${xf}</a:xfrm></p:grpSpPr>${parts.join("")}</p:grpSp>`;
}

const pptx = new pptxgen();
pptx.defineLayout({ name: "DECK3", width: pxToIn(SLIDE.w), height: pxToIn(SLIDE.h) });
pptx.layout = "DECK3";
pptx.rtlMode = true;
pptx.theme = { headFontFace: FONT, bodyFontFace: FONT, lang: "ar-SA" };

function addTable(slide, b) {
  const border = (px, color) => ({ type: "solid", pt: pxToPt(px), color });
  const none = { type: "none" };
  const cell = (txt, head) => {
    const lines = Array.isArray(txt) ? txt : [txt];
    const size = head ? (b.headSize ?? b.size) : b.size;
    return {
      text: lines.flatMap((l, k) => { const r = pRuns(l); r[r.length - 1].options.breakLine = k < lines.length - 1; return r; }),
      options: {
        ...textBase, fontSize: pxToPt(size), bold: head, color: head ? C.muted : C.text, valign: "middle",
        margin: [0, pxToIn(12), 0, pxToIn(12)],
        border: [head ? border(2, C.navy) : none, none, border(1, C.hair), none],
        fill: { color: C.bg },
      },
    };
  };
  const rows = [b.header.map((h) => cell(h, true)), ...b.rows.map((r) => r.map((v) => cell(v, false)))];
  slide.addTable(rows, {
    x: pxToIn(b.x), y: pxToIn(b.y), w: pxToIn(b.colW.reduce((a, v) => a + v, 0)),
    colW: b.colW.map(pxToIn), // logical order; a:tblPr rtl="1" puts column 0 on the right
    rowH: [pxToIn(b.headH ?? b.rowH), ...b.rows.map(() => pxToIn(b.rowH))],
    autoPage: false,
  });
}

for (const s of slides) {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  for (const b of s.items) {
    if (b.kind === "text") slide.addText(pRuns(b.text), { ...geo(b), ...textBase, fontSize: pxToPt(b.size), bold: b.weight >= 700, color: b.color, lineSpacing: pxToPt(b.lineH) });
    else if (b.kind === "rect") slide.addShape(pptx.ShapeType.rect, { ...geo(b), fill: { color: b.fill }, line: { color: C.hair, width: 0.5 } });
    else if (b.kind === "table") addTable(slide, b);
    else if (b.kind === "ntext" || b.kind === "diagram") {
      const m = marker();
      rawById[m] = b.kind === "ntext" ? spXml({ name: `t1-${b.variant}`, ...b, runs: ntextRuns(b) }) : diagramXml(b);
      slide.addText(m, { x: 0, y: 0, w: 1, h: 0.3, fontFace: FONT });
    } else if (b.kind === "free") {
      slide.addText(b.text, {
        x: pxToIn(b.x), y: pxToIn(b.y), w: pxToIn(b.w), h: pxToIn(b.h),
        shape: pptx.ShapeType.custGeom,
        points: [...b.pts.map(([x, y]) => ({ x: pxToIn(x), y: pxToIn(y) })), { close: true }],
        fill: { color: b.fill }, line: { color: C.navy, width: 2 },
        ...textBase, align: "right", valign: "middle", margin: pxToPt(FREE_PAD) /* addText margin is in points; table cell margin is inches */, fontSize: pxToPt(32), bold: true, color: C.navy,
      });
    }
  }
}

// Post-process: strip bogus charset (RESULTS.md finding 2), force rtl="1" algn="r" on EVERY slide
// paragraph, mark every table a:tblPr rtl="1", and splice in the raw XML items.
function normalize(xml) {
  xml = xml.replace(/(<a:(?:latin|ea|cs|sym) typeface="[^"]*")(?: pitchFamily="[^"]*")?(?: charset="[^"]*")?/g, "$1");
  xml = xml.replace(/<p:sp>(?:(?!<\/p:sp>).)*?(@@RAW\d+@@)(?:(?!<\/p:sp>).)*<\/p:sp>/gs, (_, m) => rawById[m]);
  xml = xml.replace(/<a:pPr\b([^>]*?)(\/?)>/g, (_, attrs, close) => `<a:pPr${attrs.replace(/\s(?:rtl|algn)="[^"]*"/g, "")} algn="r" rtl="1"${close}>`);
  xml = xml.replace(/<a:p>(?!<a:pPr)/g, '<a:p><a:pPr algn="r" rtl="1"/>');
  // pptxgenjs writes one a:pPr per run for multi-run text (schema allows one per paragraph): keep the first.
  xml = xml.replace(/<a:p>.*?<\/a:p>/gs, (p) => {
    let seen = false;
    return p.replace(/<a:pPr\b[^>]*?(?:\/>|>.*?<\/a:pPr>)/gs, (m) => (seen ? "" : ((seen = true), m)));
  });
  // LTR runs (lang en-US) get a run-level <a:rtl val="0"/>; the paragraph stays rtl="1".
  xml = xml.replace(/<a:rPr\b([^>]*lang="en-US"[^>]*?)(\/>|>((?:(?!<\/a:rPr>).)*)<\/a:rPr>)/gs, (m, attrs, _c, inner) => inner === undefined ? `<a:rPr${attrs}><a:rtl val="0"/></a:rPr>` : (inner.includes("<a:rtl ") ? m : `<a:rPr${attrs}>${inner}<a:rtl val="0"/></a:rPr>`));
  xml = xml.replace(/<a:tblPr\b([^>]*?)(\/?)>/g, (_, attrs, close) => `<a:tblPr${attrs.replace(/\srtl="[^"]*"/, "")} rtl="1"${close}>`);
  return xml;
}

const raw = await pptx.write({ outputType: "nodebuffer" });
const zip = await JSZip.loadAsync(raw);
const counts = { paragraphs: 0, rtl1algnR: 0, rtl0: 0, tables: 0, tblRtl: 0, lrm: 0, runRtl0: 0, slides: 0 };
for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
  const xml = normalize(await zip.file(name).async("string"));
  zip.file(name, xml);
  counts.slides++;
  counts.paragraphs += (xml.match(/<a:p>/g) || []).length;
  counts.rtl1algnR += (xml.match(/<a:pPr\b[^>]*algn="r" rtl="1"/g) || []).length;
  counts.rtl0 += (xml.match(/<a:pPr\b[^>]*rtl="0"/g) || []).length;
  counts.tables += (xml.match(/<a:tbl>/g) || []).length;
  counts.tblRtl += (xml.match(/<a:tblPr\b[^>]*rtl="1"/g) || []).length;
  counts.lrm += (xml.match(/‎/g) || []).length;
  counts.runRtl0 += (xml.match(/<a:rtl val="0"\/>/g) || []).length;
}
const plain = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(join(OUT, "tests.pptx"), plain);

// -- T7: embed Somar (EOT-wrapped fntdata, the format PowerPoint writes) ------
const fontInfo = { regular: readFontInfo(readFileSync(SOMAR_TTF.regular)), bold: readFontInfo(readFileSync(SOMAR_TTF.bold)) };
// Somar ships CFF outlines ("OTTO"); otf2ttf.py writes glyf-outline copies to out/t/fonts/.
const GLYF = { regular: join(OUT, "fonts", "Somar-Regular-glyf.ttf"), bold: join(OUT, "fonts", "Somar-Bold-glyf.ttf") };
async function embedFonts(buf, mode, src = SOMAR_TTF) {
  const z = await JSZip.loadAsync(buf);
  const files = { regular: readFileSync(src.regular), bold: readFileSync(src.bold) };
  z.file("ppt/fonts/font1.fntdata", mode === "eot" ? buildEot(files.regular) : files.regular);
  z.file("ppt/fonts/font2.fntdata", mode === "eot" ? buildEot(files.bold) : files.bold);
  let ct = await z.file("[Content_Types].xml").async("string");
  if (!ct.includes('Extension="fntdata"')) ct = ct.replace("<Default ", '<Default Extension="fntdata" ContentType="application/x-fontdata"/><Default ');
  z.file("[Content_Types].xml", ct);
  let rels = await z.file("ppt/_rels/presentation.xml.rels").async("string");
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";
  rels = rels.replace("</Relationships>", `<Relationship Id="rIdF1" Type="${REL}" Target="fonts/font1.fntdata"/><Relationship Id="rIdF2" Type="${REL}" Target="fonts/font2.fntdata"/></Relationships>`);
  z.file("ppt/_rels/presentation.xml.rels", rels);
  let pres = await z.file("ppt/presentation.xml").async("string");
  pres = pres.replace(/\ssaveSubsetFonts="[^"]*"/g, "").replace(/<p:presentation\b/,'<p:presentation embedTrueTypeFonts="1" saveSubsetFonts="0"');
  pres = pres.replace(/(<p:notesSz[^>]*\/>)/, `$1<p:embeddedFontLst><p:embeddedFont><p:font typeface="${FONT}"/><p:regular r:id="rIdF1"/><p:bold r:id="rIdF2"/></p:embeddedFont></p:embeddedFontLst>`);
  z.file("ppt/presentation.xml", pres);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
writeFileSync(join(OUT, "tests-embed-eot.pptx"), await embedFonts(plain, "eot"));
writeFileSync(join(OUT, "tests-embed-ttf.pptx"), await embedFonts(plain, "ttf"));
writeFileSync(join(OUT, "tests-embed-glyf-eot.pptx"), await embedFonts(plain, "eot", GLYF));
writeFileSync(join(OUT, "tests-embed-glyf-ttf.pptx"), await embedFonts(plain, "ttf", GLYF));

// -- HTML from the same items ------------------------------------------------
// Same rule as PPTX: in "run" mode each Latin/digit token is its own LTR span.
const htmlRuns = (s) => (NUMFIX === "run" ? ltrRuns(s).map((p) => (p.ltr ? `<span dir="ltr">${htmlEsc(p.t)}</span>` : htmlEsc(p.t))).join("") : htmlEsc(fixNums(s)));
function htmlNumSpan(b) {
  if (b.variant === "run") return htmlEsc(b.src).replace(NUM_RE, (t) => `<span dir="ltr">${t}</span>`);
  return htmlEsc(fixNums(b.src, b.variant));
}
const pos = (b) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;`;
function htmlItem(b) {
  if (b.kind === "text") return `<div class="abs t" style="${pos(b)}font-size:${b.size}px;font-weight:${b.weight};color:#${b.color};line-height:${b.lineH}px">${htmlRuns(b.text)}</div>`;
  if (b.kind === "rect") return `<div class="abs" style="${pos(b)}background:#${b.fill};outline:1px solid #${C.hair}"></div>`;
  if (b.kind === "ntext") return `<div class="abs t" style="${pos(b)}font-size:${b.size}px;font-weight:${b.weight};color:#${b.color};line-height:${b.lineH}px">${htmlNumSpan(b)}</div>`;
  if (b.kind === "table") {
    const cols = b.colW.map((w) => `<col style="width:${w}px">`).join("");
    const td = (tag, v, head) => {
      const lines = Array.isArray(v) ? v : [v];
      const size = head ? (b.headSize ?? b.size) : b.size;
      const st = `font-size:${size}px;font-weight:${head ? 700 : 400};color:#${head ? C.muted : C.text};height:${head ? (b.headH ?? b.rowH) : b.rowH}px;${head ? `border-top:2px solid #${C.navy};` : ""}border-bottom:1px solid #${C.hair};`;
      return `<${tag} style="${st}"><div class="cell">${lines.map((l) => htmlRuns(l)).join("<br>")}</div></${tag}>`;
    };
    const head = `<tr>${b.header.map((h) => td("th", h, true)).join("")}</tr>`;
    const body = b.rows.map((r) => `<tr>${r.map((v) => td("td", v, false)).join("")}</tr>`).join("");
    return `<table class="abs tbl" dir="rtl" style="left:${b.x}px;top:${b.y}px;width:${b.colW.reduce((a, v) => a + v, 0)}px"><colgroup>${cols}</colgroup>${head}${body}</table>`;
  }
  if (b.kind === "diagram") {
    const byId = Object.fromEntries(b.nodes.map((n) => [n.id, n]));
    const lines = b.edges.map(([a, c]) => { const s = byId[a], t = byId[c]; return `<line x1="${s.x}" y1="${s.y + s.h / 2}" x2="${t.x + t.w}" y2="${t.y + t.h / 2}" stroke="#${C.muted}" stroke-width="4" marker-end="url(#arr)"/>`; }).join("");
    const svg = `<svg class="abs" style="left:0;top:0" width="1920" height="1080"><defs><marker id="arr" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="12" refX="16" refY="6" orient="auto"><path d="M0,0 L16,6 L0,12 z" fill="#${C.muted}"/></marker></defs>${lines}</svg>`;
    return svg + b.nodes.map((n) => `<div class="abs node" style="${pos(n)}background:#${n.fill};color:#${n.color}">${htmlEsc(n.text)}</div>`).join("");
  }
  if (b.kind === "free") {
    const d = "M" + b.pts.map(([x, y]) => `${x},${y}`).join(" L") + " Z";
    return `<svg class="abs" style="${pos(b)}" width="${b.w}" height="${b.h}"><path d="${d}" fill="#${b.fill}" stroke="#${C.navy}" stroke-width="4"/></svg><div class="abs t" style="${pos(b)}display:flex;align-items:center;justify-content:flex-start;padding:0 ${FREE_PAD}px;font-size:32px;font-weight:700;color:#${C.navy}">${htmlEsc(b.text)}</div>`;
  }
  return "";
}
const css = `${fontFaceCss()}
html,body{margin:0;padding:0;background:#${C.bg};}
.slide{position:relative;width:1920px;height:1080px;overflow:hidden;background:#${C.bg};font-family:"Somar";}
.abs{position:absolute;margin:0;box-sizing:border-box;}
.t{white-space:nowrap;text-align:right;}
.tbl{border-collapse:collapse;table-layout:fixed;font-family:"Somar";}
.tbl th,.tbl td{box-sizing:border-box;text-align:right;line-height:${T4.lineH}px;vertical-align:middle;padding:0 12px;}
.cell{white-space:nowrap;overflow:hidden;}
.node{display:flex;align-items:center;justify-content:flex-start;padding:0 28px;border-radius:16px;font-size:30px;font-weight:700;}`;
const page = (body, extra = "") => `<!doctype html><html lang="ar-SA" dir="rtl"><head><meta charset="utf-8"><title>PPTX tests</title><style>${css}</style></head><body>${body}${extra}</body></html>`;
slides.forEach((s, i) => {
  const f = join(OUT, `html-${String(i + 1).padStart(2, "0")}-${s.id}.html`);
  writeFileSync(f, page(`<div class="slide" dir="rtl">${s.items.map(htmlItem).join("\n")}</div>`));
  screenshot(f, f.replace(/\.html$/, ".png"), OUT);
});
// HTML clip check: every table cell content fits (scrollWidth <= clientWidth) and every slide's
// content stays inside 1080px. Runs in Edge with Somar.
const checkHtml = join(OUT, "html-check.html");
writeFileSync(checkHtml, page(slides.map((s) => `<div class="slide" dir="rtl" data-id="${s.id}">${s.items.map(htmlItem).join("")}</div>`).join(""),
  `<pre id="out">PENDING</pre><script>(async()=>{await document.fonts.ready;const r=[];document.querySelectorAll('.slide').forEach(sl=>{const sb=sl.getBoundingClientRect();let clipped=0,cells=0,outside=0;sl.querySelectorAll('.cell').forEach(c=>{cells++;if(c.scrollWidth>c.clientWidth+0.5){clipped++;(window.CL=window.CL||[]).push(sl.dataset.id+':'+c.textContent+':'+c.scrollWidth+'/'+c.clientWidth)}});sl.querySelectorAll('table').forEach(t=>{const b=t.getBoundingClientRect();if(b.bottom>sb.bottom+0.5||b.left<sb.left-0.5||b.right>sb.right+0.5)outside++;});r.push({id:sl.dataset.id,cells,clipped,outside});});r.push(window.CL||[]);(()=>{});document.getElementById('out').textContent='RESULT'+JSON.stringify(r)+'END';})();</script>`));

writeFileSync(join(OUT, "layout.json"), JSON.stringify({
  numfix: NUMFIX, fitSafety: FIT_SAFETY, counts, steps, diagramFit, freeFit, t4: t4res.map(({ i, text, real, step, size, lines, colW }) => ({ i, real, step, size, lines: lines.length, testColW: colW[T4.testCol], chars: text.length })),
  t3: { perPage, pages: t3pages.map((p) => p.length), unfit: t3fit, header: T3_HEADER },
  slides: slides.map((s, i) => ({ n: i + 1, id: s.id })),
  crops: slides.flatMap((s, i) => s.items.filter((b) => b.crop).map((b) => ({ slide: i + 1, name: b.crop, x: b.x - 6, y: b.y - 6, w: (b.w ?? b.colW.reduce((a, v) => a + v, 0)) + 12, h: (b.h ?? 52 * 3) + 12 }))),
  fontInfo,
}, null, 2));
console.log(JSON.stringify({ counts, steps, t3: { perPage, pages: t3pages.map((p) => p.length), unfit: t3fit.length }, slides: slides.length, fsType: { regular: fontInfo.regular.fsType, bold: fontInfo.bold.fsType } }));
