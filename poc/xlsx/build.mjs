// T8 round 3: the full report workbook.
//
// Package base: the raw source workbook itself (JSZip). Its raw sheets, shared strings,
// tables, printer settings and external link are carried over untouched (compressed bytes
// reused), so the raw data is exactly as uploaded. SheetJS writes every other sheet's cells;
// this script post-processes the package to add: merged styles (raw styles first, deck3 styles
// appended), Somar theme fonts, processed sheets streamed from stage.mjs, Excel tables, pivot
// caches and pivot tables, drawings (logo, shape buttons with hyperlinks, native charts, slicer
// frames), pivot and table slicers, separators, RTL views and frozen panes.
//
// Inputs: out/stage/* (stage.mjs), the raw workbook, ../port-pptx/out/model.json and
// geometry.json (deck logo). Output: out/report.xlsx, out/figures.json, out/charts.json,
// out/buttons.json, out/expect.json.
//
//   node build.mjs <raw.xlsx>
//
// RTL placement: column A is drawn at the right edge. Every content sheet keeps A as a margin;
// tables start at B; pivots, slicers and charts follow to the table's left on screen.

import { createReadStream, createWriteStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const stageDir = join(out, "stage");
const rawPath = process.argv[2];
const t0 = Date.now();
const stage = JSON.parse(readFileSync(join(stageDir, "stage.json"), "utf8"));
const { m } = JSON.parse(readFileSync(join(here, "..", "port-pptx", "out", "model.json"), "utf8"));
const geometry = JSON.parse(readFileSync(join(here, "..", "port-pptx", "out", "geometry.json"), "utf8"));
const LOGO = Buffer.from(geometry[0].images[0].src.split(",")[1], "base64");
const SEL = m.port;
const ISSUED = process.env.T8_DATE ?? "2026-11-05";
const T = { bg: "F9F8F5", panel: "F2F0EA", navy: "10304F", text: "22303E", muted: "5D6B7A", hair: "E3E0D8", gold: "B48A3C", goldLight: "C9A45E", blue: "3F6FA8", green: "2E7D4F", track: "ECEAE3", white: "FFFFFF", black: "000000" };
const FONT = "Somar";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => XLSX.utils.encode_col(i);
const A1 = (r, c) => `${col(c)}${r + 1}`;
const abs = (sheet, r1, c, r2) => `'${sheet}'!$${col(c)}$${r1 + 1}:$${col(c)}$${r2 + 1}`;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL.slice(0, -1)}"`;

// ---------- the raw package ----------
const zip = await JSZip.loadAsync(readFileSync(rawPath));
const rawWb = await zip.file("xl/workbook.xml").async("string");
const rawRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
const rawTarget = {};
for (const mm of rawRels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rawTarget[mm[1]] = mm[2].replace(/^\/?xl\//, "");
const rawSheets = [...rawWb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((mm) => ({ name: mm[1].replace(/&amp;/g, "&"), part: rawTarget[mm[2]] }));
const RAW = stage.rawSheets.map((n) => rawSheets.find((s) => s.name === n));
const rawStyles = await zip.file("xl/styles.xml").async("string");
const rawTheme = await zip.file("xl/theme/theme1.xml").async("string");
const studyTable = await zip.file("xl/tables/table11.xml").async("string");
const studyTableCols = [...studyTable.matchAll(/<tableColumn [^>]*name="([^"]*)"/g)].map((mm) => mm[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
const XOFF = Number(rawStyles.match(/<cellXfs count="(\d+)"/)[1]);
const OFF = { font: Number(rawStyles.match(/<fonts count="(\d+)"/)[1]), fill: Number(rawStyles.match(/<fills count="(\d+)"/)[1]), border: Number(rawStyles.match(/<borders count="(\d+)"/)[1]), dxf: Number(rawStyles.match(/<dxfs count="(\d+)"/)[1]) };

// ---------- styles: raw first (unchanged indices), deck3 appended ----------
const X = Object.fromEntries(Object.entries({ DEF: 0, BG: 1, BAND: 2, BAND_TITLE: 3, BAND_SUB: 4, BUTTON: 5, BACK: 6, SECTION: 7, NOTE: 8, BLACK: 9, KPI_LABEL: 10, KPI_VALUE: 11, KPI_PCT: 12, COVER_TITLE: 13, BODY_NUM: 14, BODY_PCT: 15, DESC: 16, LINK: 17, RULE: 18 }).map(([k, v]) => [k, v + XOFF]));
const mergedStyles = () => {
  const font = (sz, color, b, u) => `<font>${b ? "<b/>" : ""}${u ? "<u/>" : ""}<sz val="${sz}"/><color rgb="FF${color}"/><name val="${FONT}"/><family val="2"/></font>`;
  const fonts = [font(10, T.text), font(18, T.white, 1), font(11, T.goldLight), font(11, T.navy, 1), font(10, T.muted), font(11, T.white, 1), font(20, T.navy, 1), font(24, T.white, 1), font(10, T.blue, 0, 1), font(11, T.text, 1)];
  const solid = (c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = [solid(T.bg), solid(T.navy), solid(T.panel), solid(T.gold), solid(T.black)];
  const F = { bg: 0, navy: 1, panel: 2, gold: 3, black: 4 };
  const box = (c) => `<border><left style="thin"><color rgb="FF${c}"/></left><right style="thin"><color rgb="FF${c}"/></right><top style="thin"><color rgb="FF${c}"/></top><bottom style="thin"><color rgb="FF${c}"/></bottom><diagonal/></border>`;
  const borders = [box(T.goldLight), box(T.hair)];
  const al = (h, wrap) => `<alignment${h ? ` horizontal="${h}"` : ""} vertical="center"${wrap ? ' wrapText="1"' : ""} readingOrder="2"/>`;
  const xf = (fo, fi, bo, nf, a) => { const f = OFF.font + fo, fl = fi === null ? 0 : OFF.fill + fi, b = bo === null ? 0 : OFF.border + bo; return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fl}" borderId="${b}" xfId="0" applyFont="1"${fi !== null ? ' applyFill="1"' : ""}${bo !== null ? ' applyBorder="1"' : ""}${nf ? ' applyNumberFormat="1"' : ""}${a ? ` applyAlignment="1">${a}</xf>` : "/>"}`; };
  const xfs = [xf(0, null, null, 0), xf(0, F.bg, null, 0), xf(0, F.navy, null, 0), xf(1, F.navy, null, 0, al()), xf(2, F.navy, null, 0, al()), xf(3, F.panel, 0, 0, al("center")), xf(5, F.gold, null, 0, al("center")), xf(3, F.bg, null, 0, al()), xf(4, F.bg, null, 0, al()), xf(0, F.black, null, 0), xf(4, F.panel, 1, 0, al("center")), xf(6, F.panel, 1, 3, al("center")), xf(6, F.panel, 1, 10, al("center")), xf(7, F.navy, null, 0, al()), xf(0, null, null, 3), xf(0, null, null, 10), xf(0, F.bg, null, 0, al(null, 1)), xf(8, F.bg, null, 0, al()), xf(9, F.bg, null, 0, al(null, 1))];
  const dfill = (c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor rgb="FF${c}"/></patternFill></fill>`;
  const dxfs = [
    `<dxf><font><color rgb="FF${T.text}"/></font><border><bottom style="thin"><color rgb="FF${T.hair}"/></bottom><horizontal style="thin"><color rgb="FF${T.hair}"/></horizontal></border></dxf>`,
    `<dxf><font><b/><color rgb="FF${T.white}"/></font>${dfill(T.navy)}</dxf>`,
    `<dxf>${dfill(T.panel)}</dxf>`,
    `<dxf><font><b/><color rgb="FF${T.navy}"/></font>${dfill(T.track)}<border><top style="thin"><color rgb="FF${T.gold}"/></top></border></dxf>`,
    `<dxf><font><b/><color rgb="FF${T.navy}"/></font></dxf>`,
  ];
  const d = (i) => OFF.dxf + i;
  const tStyle = `<tableStyles count="1" defaultTableStyle="نمط التقرير" defaultPivotStyle="نمط التقرير"><tableStyle name="نمط التقرير" count="6"><tableStyleElement type="wholeTable" dxfId="${d(0)}"/><tableStyleElement type="headerRow" dxfId="${d(1)}"/><tableStyleElement type="totalRow" dxfId="${d(3)}"/><tableStyleElement type="firstRowStripe" dxfId="${d(2)}"/><tableStyleElement type="pageFieldLabels" dxfId="${d(4)}"/><tableStyleElement type="pageFieldValues" dxfId="${d(4)}"/></tableStyle></tableStyles>`;
  const add = (xml, tag, items) => xml.replace(new RegExp(`<${tag} count="(\\d+)"([^>]*)>([\\s\\S]*?)</${tag}>`), (_, n, attrs, inner) => `<${tag} count="${Number(n) + items.length}"${attrs}>${inner}${items.join("")}</${tag}>`);
  let s = rawStyles.replace(/<name val="[^"]*"\/>/g, `<name val="${FONT}"/>`).replace(/<scheme val="[^"]*"\/>/g, "");
  s = add(s, "fonts", fonts); s = add(s, "fills", fills); s = add(s, "borders", borders); s = add(s, "cellXfs", xfs); s = add(s, "dxfs", dxfs);
  s = s.replace(/<tableStyles[^>]*\/>|<tableStyles[\s\S]*?<\/tableStyles>/, tStyle);
  return s;
};
const themeXml = rawTheme.replace(/(<a:(?:major|minor)Font><a:latin typeface=")[^"]*"/g, `$1${FONT}"`).replace(/(<a:(?:major|minor)Font><a:latin [^>]*\/><a:ea [^>]*\/><a:cs typeface=")[^"]*"/g, `$1${FONT}"`);

// ---------- sheet plan ----------
const POP_PARTS = stage.popParts.map((p) => `المجتمع ${p.part}`);
const STEPS = [
  "ربط أعمدة المجتمع", "حذف الصور المكررة", "استبعاد بلا منفذ أو تاريخ", "تطبيق فترة التقرير", "اشتقاق حقول المجتمع", "توحيد أسماء المنافذ",
  "تحديد مجموعة المنفذ", "تجميع المجتمع حسب المنفذ", "ربط أعمدة العينة", "استبعاد خارج فترة العينة", "اشتقاق حقول العينة", "استبعاد غير الموظفين",
];
const S = { index: "الفهرس", sample: "العينة", stats: "الإحصائيات", source: "المصدر" };
const SEP = ["|", "||", "|||", "||||", "|||||"];
const ORDER = [S.index, SEP[0], ...RAW.map((r) => r.name), SEP[1], ...STEPS, SEP[2], ...POP_PARTS, S.sample, SEP[3], S.stats, SEP[4], S.source];
const sheetId = (n) => ORDER.indexOf(n) + 1;
const SEPS = new Set(SEP);
const RAWSET = new Set(RAW.map((r) => r.name));
const BIG = new Set([...POP_PARTS, S.sample]);
const TABLE_ROW = 10;

const aggCols = ["المنفذ", "نوع المنفذ", "المجموعة", "السنة", "الشهر", "عدد الصور", "اشتباه", "مكود"];
const sampleCols = [...studyTableCols, ...stage.sampleCols.slice(studyTableCols.length)];
if (studyTableCols.length !== stage.sampleCols.length - 8) throw new Error("study header count differs from the raw table");
const F_PORT = "المنفذ (موحد)", F_YEAR = "السنة (مشتقة)", F_MATCH = "التوائم (مشتق)", F_STATUS = "حالة نتيجة الصورة";
// the study sheet's group column is whichever alias the source parser matched (المجموعة / نوع المنفذ2 / نوع المنفذ)
const F_GROUP = stage.study.mapping.find((x) => x[0] === "group")[2].replace(/ \([A-Z]+\)$/, "");
if (!sampleCols.includes(F_GROUP)) throw new Error(`group column not found: ${F_GROUP}`);
const tables = {
  agg: { table: "جدول_تجميع_المجتمع", cols: aggCols, sheet: STEPS[7], start: [TABLE_ROW + 2, 1], n: stage.agg.length },
  smp: { table: "جدول_العينة_المعالجة", cols: sampleCols, sheet: S.sample, start: [TABLE_ROW, 1], n: stage.axis.length },
  src: { table: "جدول_مصدر_الأرقام", sheet: S.source, start: [TABLE_ROW, 1] },
};
const LITE = Number(process.env.T8_LITE ?? 0); // bisect aid: keep only the first N processed rows
const NORAW = !!process.env.T8_NORAW; // bisect aid: blank raw sheets
POP_PARTS.forEach((n, i) => { tables[`pop${i + 1}`] = { table: `جدول_المجتمع_المعالج_${i + 1}`, cols: stage.popCols, sheet: n, start: [TABLE_ROW, 1], n: LITE ? Math.min(LITE, stage.popParts[i].rows) : stage.popParts[i].rows }; });
if (LITE) tables.smp.n = Math.min(LITE, tables.smp.n);
// pivot caches over: agg (pop) and smp
const caches = { pop: { id: 1, t: tables.agg }, smp: { id: 2, t: tables.smp } };
caches.pop.rows = stage.agg;
caches.smp.axis = { [F_PORT]: stage.axis.map((a) => a[0]), [F_GROUP]: stage.axis.map((a) => a[1]), [F_YEAR]: stage.axis.map((a) => a[2]), [F_STATUS]: stage.axis.map((a) => a[3]), [F_MATCH]: stage.axis.map((a) => a[4]) };
caches.pop.axis = Object.fromEntries(aggCols.map((h, i) => [h, stage.agg.map((r) => r[i])]));

const slide = { popSample: "المجتمع والعينة المدروسة في ميناء جدة الإسلامي", results: "نتائج دراسة صور ميناء جدة الإسلامي", compare: "نسبة التوائم: ميناء جدة الإسلامي مقابل جميع المنافذ", timeline: "الخط الزمني لنسبة التوائم في ميناء جدة الإسلامي" };
const BLOCK = { cols: [1, 11], rows: [10, 29, 48] };
const popPivotCol = stage.popCols.length + 3; // after the table and a spacer
const smpPivotCol = sampleCols.length + 3;
const pivots = [
  { sheet: POP_PARTS[0], at: [TABLE_ROW, popPivotCol], cache: "pop", rows: "المنفذ", data: [["عدد الصور", "sum", "مجموع الصور", 3]], title: "مجموع الصور حسب المنفذ", chart: { dataIx: 0, kind: "bar", fmt: "#,##0", color: T.navy, at: [TABLE_ROW, popPivotCol + 8, TABLE_ROW + 26, popPivotCol + 17] } },
  { sheet: S.sample, at: [TABLE_ROW, smpPivotCol], cache: "smp", rows: F_PORT, data: [[F_STATUS, "count", "عدد الدراسات", 3], [F_MATCH, "average", "نسبة التوائم", 10]], title: "الدراسات ونسبة التوائم حسب المنفذ", chart: { dataIx: 1, kind: "bar", fmt: "0.0%", color: T.gold, at: [TABLE_ROW, smpPivotCol + 8, TABLE_ROW + 26, smpPivotCol + 17] } },
  { sheet: S.stats, block: [0, 0], cache: "pop", rows: "المجموعة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "مجموع الصور حسب المجموعة", chart: { dataIx: 0, kind: "col", fmt: "#,##0", color: T.navy } },
  { sheet: S.stats, block: [0, 1], cache: "pop", page: ["المنفذ", SEL], rows: "السنة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "صور الميناء حسب السنة", chart: { dataIx: 0, kind: "col", fmt: "#,##0", color: T.blue } },
  { sheet: S.stats, block: [1, 0], cache: "smp", page: [F_PORT, SEL], rows: F_STATUS, data: [[F_STATUS, "count", "عدد الدراسات", 3]], feeds: slide.results, title: "نتائج دراسة صور الميناء حسب الحالة", chart: { dataIx: 0, kind: "bar", fmt: "#,##0", color: T.navy } },
  { sheet: S.stats, block: [1, 1], cache: "smp", rows: F_GROUP, data: [[F_STATUS, "count", "عدد الدراسات", 3], [F_MATCH, "average", "نسبة التوائم", 10]], feeds: slide.compare, title: "نسبة التوائم حسب نوع المنفذ", chart: { dataIx: 1, kind: "col", fmt: "0.0%", color: T.gold } },
  { sheet: S.stats, block: [2, 0], cache: "smp", page: [F_PORT, SEL], rows: F_YEAR, data: [[F_STATUS, "count", "عدد الدراسات", 3], [F_MATCH, "average", "نسبة التوائم", 10]], feeds: slide.timeline, title: "عينة الميناء ونسبة التوائم حسب السنة", chart: { dataIx: 1, kind: "col", fmt: "0.0%", color: T.green } },
];
for (const p of pivots) if (p.block) { const t = BLOCK.rows[p.block[0]], c = BLOCK.cols[p.block[1]]; p.titleAt = [t, c]; p.at = [t + 3, c]; p.chart.at = [t, c + 4, t + 17, c + 9]; }
pivots.forEach((p, i) => { p.name = p.title; p.no = i + 1; });
const slicers = [
  { name: "مقسم_مجموعة_المجتمع", kind: "pivot", sheet: POP_PARTS[0], cache: "pop", field: "المجموعة", pivots: [1], at: [TABLE_ROW, popPivotCol + 4, TABLE_ROW + 11, popPivotCol + 7] },
  { name: "مقسم_مجموعة_جدول_المجتمع", kind: "table", sheet: POP_PARTS[0], table: "pop1", field: "المجموعة (مشتقة)", at: [TABLE_ROW + 13, popPivotCol + 4, TABLE_ROW + 22, popPivotCol + 7] },
  { name: "مقسم_مجموعة_العينة", kind: "pivot", sheet: S.sample, cache: "smp", field: F_GROUP, pivots: [2], at: [TABLE_ROW, smpPivotCol + 4, TABLE_ROW + 11, smpPivotCol + 7] },
  { name: "مقسم_سنة_العينة", kind: "table", sheet: S.sample, table: "smp", field: F_YEAR, at: [TABLE_ROW + 13, smpPivotCol + 4, TABLE_ROW + 22, smpPivotCol + 7] },
  { name: "مقسم_سنة_الإحصائيات", kind: "pivot", sheet: S.stats, cache: "smp", field: F_YEAR, pivots: [5, 7], at: [BLOCK.rows[2] + 3, BLOCK.cols[1], BLOCK.rows[2] + 13, BLOCK.cols[1] + 3] },
];

// pivot items and output positions (known before Excel runs: refresh keeps shared-item order)
// reader-facing labels for fields whose column name carries a raw suffix or a derivation tag
const LABEL = { [F_GROUP]: "نوع المنفذ", [F_PORT]: "المنفذ", [F_YEAR]: "السنة", [F_STATUS]: "حالة الصورة", "المجموعة (مشتقة)": "نوع المنفذ", "المجموعة": "نوع المنفذ" };
const label = (f) => LABEL[f] ?? f;
const sortU = (vals) => [...new Set(vals.map((v) => (v === null ? "" : v)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
for (const c of Object.values(caches)) {
  c.items = {};
  const need = new Set([...pivots.filter((p) => caches[p.cache] === c).flatMap((p) => [p.rows, p.page?.[0]].filter(Boolean)), ...slicers.filter((s) => s.kind === "pivot" && caches[s.cache] === c).map((s) => s.field)]);
  for (const f of need) c.items[f] = sortU(c.axis[f]);
}
for (const p of pivots) {
  const c = caches[p.cache];
  const n = c.items[p.rows].length;
  const r0 = p.page ? p.at[0] + 2 : p.at[0];
  const first = r0 + (p.data.length > 1 ? 2 : 1);
  p.out = { r0, c0: p.at[1], first, last: first + n - 1, grand: first + n, valueCol: (k) => p.at[1] + 1 + k };
}
const pivotCell = (pivotName, dataName, item) => {
  const p = pivots.find((x) => x.name === pivotName);
  const k = p.data.findIndex((d) => d[2] === dataName);
  const r = item === undefined ? p.out.grand : p.out.first + caches[p.cache].items[p.rows].indexOf(item);
  return { sheet: p.sheet, ref: A1(r, p.out.valueCol(k)) };
};

// ---------- figures ----------
const g = (label) => m.groups.find((x) => x.label === label);
const y = (yr) => m.years.find((x) => x.year === yr);
const figures = [
  ["مجتمع جميع المنافذ", m.allPorts.population, "pivot1", "مجموع الصور", [], "عدد الصور", "بدون", "مجموع"],
  ["مجتمع ميناء جدة الإسلامي", m.selected.population, "pivot1", "مجموع الصور", ["المنفذ", SEL], "عدد الصور", `المنفذ = ${SEL}`, "مجموع"],
  ["مجتمع المنافذ البرية", g("منفذ بري").population, "pivot3", "مجموع الصور", ["المجموعة", "منفذ بري"], "عدد الصور", "المجموعة = منفذ بري", "مجموع"],
  ["مجتمع المنافذ البحرية", g("منفذ بحري").population, "pivot3", "مجموع الصور", ["المجموعة", "منفذ بحري"], "عدد الصور", "المجموعة = منفذ بحري", "مجموع"],
  ["عينة جميع المنافذ", m.allPorts.image.studied, "pivot2", "عدد الدراسات", [], F_STATUS, "بدون", "عدد"],
  ["عينة ميناء جدة الإسلامي", m.selected.image.studied, "pivot2", "عدد الدراسات", [F_PORT, SEL], F_STATUS, `${F_PORT} = ${SEL}`, "عدد"],
  ["نسبة توائم ميناء جدة الإسلامي", m.selected.image.accuracy, "pivot2", "نسبة التوائم", [F_PORT, SEL], F_MATCH, `${F_PORT} = ${SEL}`, "متوسط"],
  ["نسبة توائم جميع المنافذ", m.allPorts.image.accuracy, "pivot2", "نسبة التوائم", [], F_MATCH, "بدون", "متوسط"],
  ...[["اشتباه صحيح", "trueSuspicion"], ["اشتباه خاطئ", "falseSuspicion"], ["اشتباه فائت", "missed"], ["سليمة صحيحة", "trueClear"]].map(([st, k]) => [`${st} في الميناء`, m.selected.image[k], "pivot5", "عدد الدراسات", [F_STATUS, st], F_STATUS, `${F_PORT} = ${SEL}، الحالة = ${st}`, "عدد"]),
  ["نسبة توائم المنافذ البرية", g("منفذ بري").image.accuracy, "pivot6", "نسبة التوائم", [F_GROUP, "منفذ بري"], F_MATCH, "المجموعة = منفذ بري", "متوسط"],
  ["نسبة توائم المنافذ البحرية", g("منفذ بحري").image.accuracy, "pivot6", "نسبة التوائم", [F_GROUP, "منفذ بحري"], F_MATCH, "المجموعة = منفذ بحري", "متوسط"],
  ...[2024, 2025, 2026].flatMap((yr) => [
    [`مجتمع الميناء ${yr}`, y(yr).population, "pivot4", "مجموع الصور", ["السنة", yr], "عدد الصور", `المنفذ = ${SEL}، السنة = ${yr}`, "مجموع"],
    [`عينة الميناء ${yr}`, y(yr).image.studied, "pivot7", "عدد الدراسات", [F_YEAR, yr], F_STATUS, `${F_PORT} = ${SEL}، السنة = ${yr}`, "عدد"],
    [`نسبة توائم الميناء ${yr}`, y(yr).image.accuracy, "pivot7", "نسبة التوائم", [F_YEAR, yr], F_MATCH, `${F_PORT} = ${SEL}، السنة = ${yr}`, "متوسط"],
  ]),
].map(([label, value, pivotId, dataField, filter, field, filterText, measure]) => {
  const pivot = pivots[Number(pivotId.slice(5)) - 1].name; // internal number to the pivot's Arabic name
  const cell = pivotCell(pivot, dataField, filter.length ? filter[1] : undefined);
  return { label, value, pivot, dataField, filter, field, filterText, measure, ...cell };
});
writeFileSync(join(out, "figures.json"), JSON.stringify(figures));

// ---------- design state ----------
const design = Object.fromEntries(ORDER.map((n) => [n, { cells: new Map(), heights: new Map(), widths: [], freeze: null, merges: [], buttons: [] }]));
const put = (sheet, r, c, s) => design[sheet].cells.set(A1(r, c), s);
const rect = (sheet, r1, c1, r2, c2, s) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) put(sheet, r, c, s); };
const sheets = {};
const visibleTexts = [];
const text = (ws, r, c, v) => { if (typeof v === "string") visibleTexts.push(v); XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: { r, c } }); };
// Every sheet opens with the same header block (M15): title and one-sentence purpose in the band,
// then «يقرأ من», «القاعدة» and «الصفوف» lines beside the back button.
const fmtN = (n) => Number(n).toLocaleString("en-US");
const band = (ws, name, title, purpose, lastCol, tc = 3, titleStyle = X.BAND_TITLE) => {
  const d = design[name];
  d.heights.set(0, 8).set(1, 34).set(2, 22).set(3, 8).set(4, 10);
  rect(name, 0, 0, 3, lastCol, X.BAND);
  const end = Math.max(tc, Math.min(lastCol, tc + 12));
  text(ws, 1, tc, title); put(name, 1, tc, titleStyle); d.merges.push({ s: { r: 1, c: tc }, e: { r: 1, c: end } });
  text(ws, 2, tc, purpose); put(name, 2, tc, X.BAND_SUB); d.merges.push({ s: { r: 2, c: tc }, e: { r: 2, c: end } });
};
const headerBlock = (ws, name, { reads, rule, rows }, lastCol = 14) => {
  const d = design[name];
  const lines = [["يقرأ من", reads], ["القاعدة", rule], ["الصفوف", rows]];
  lines.forEach(([k, v], i) => {
    const r = 5 + i;
    text(ws, r, 3, `${k}: ${v}`); put(name, r, 3, i === 1 ? X.RULE : X.NOTE); d.merges.push({ s: { r, c: 3 }, e: { r, c: Math.max(4, lastCol) } });
    d.heights.set(r, i === 1 ? 34 : 20);
  });
  d.heights.set(8, 10);
};
const backButton = (name) => design[name].buttons.push({ text: "العودة إلى الفهرس", target: S.index, at: [5, 1, 7, 2], fill: T.gold, color: T.white });
const tableAoa = (ws, name, key, head, rows, numCols = [], pctCols = []) => {
  const t = tables[key];
  XLSX.utils.sheet_add_aoa(ws, [head, ...rows], { origin: { r: t.start[0], c: t.start[1] } });
  t.cols = head; t.n = rows.length;
  rows.forEach((row, i) => row.forEach((v, j) => { if (typeof v === "number") put(name, t.start[0] + 1 + i, t.start[1] + j, pctCols.includes(j) ? X.BODY_PCT : X.BODY_NUM); }));
};

// counts used by the header blocks
const st = stage;
const sumBy = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
const rawPopRows = sumBy(st.perSheet.map((x) => [x.rows]), 0);
const afterHeader = rawPopRows - sumBy(st.perSheet.map((x) => [x.pre + x.header]), 0);
const afterDup = afterHeader - sumBy(st.perSheet.map((x) => [x.dup]), 0);
const afterNo = afterDup - sumBy(st.perSheet.map((x) => [x.noPortDate]), 0);
const afterCut = afterNo - sumBy(st.perSheet.map((x) => [x.cutoff]), 0);
const RAWPOP = RAW.filter((r) => r.name !== stage.rawSheets[stage.rawSheets.length - 1]).map((r) => `«${r.name}»`).join("، ");
const STUDYRAW = `«${stage.rawSheets[stage.rawSheets.length - 1]}»`;
const same = (n) => `قبل ${fmtN(n)}، بعد ${fmtN(n)} (لا يحذف صفوفا)`;
const ba = (a, b) => `قبل ${fmtN(a)}، بعد ${fmtN(b)}`;

// cover
const descOf = {};
const COV = 3; // cover rows below the header block
{
  const n = S.index, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, `تقرير أعمال ${m.displayName}`, `مصنف بيانات التقرير، ${m.periodLabel}، تاريخ الإصدار ${ISSUED}`, 10, 3, X.COVER_TITLE);
  d.heights.set(1, 44);
  d.widths = [3, 16, 16, 16, 16, 16, 16, 16, 16, 3, 3];
  headerBlock(ws, n, { reads: "البيانات الخام كما رفعت، ثم أوراق المعالجة بترتيب تطبيقها", rule: `ترتيب المعالجة: ${STEPS.join("، ثم ")}`, rows: `المجتمع ${ba(rawPopRows, afterCut)}، العينة ${ba(st.study.dataRows, st.study.kept)}` }, 8);
  d.heights.set(6, 52);
  text(ws, 7 + COV, 1, "حقائق التقرير الأساسية (اضغط البطاقة للانتقال إلى مصدرها)"); put(n, 7 + COV, 1, X.SECTION); d.heights.set(7 + COV, 24);
  const kpis = [["مجتمع الميناء (صورة)", 1, X.KPI_VALUE], ["العينة المدروسة (صورة)", 5, X.KPI_VALUE], ["نسبة التوائم", 6, X.KPI_PCT], ["مجتمع جميع المنافذ (صورة)", 0, X.KPI_VALUE]];
  kpis.forEach(([label, fi, s], i) => {
    const c = 1 + i * 2, f = figures[fi];
    text(ws, 8 + COV, c, label); rect(n, 8 + COV, c, 8 + COV, c + 1, X.KPI_LABEL); d.merges.push({ s: { r: 8 + COV, c }, e: { r: 8 + COV, c: c + 1 } });
    text(ws, 9 + COV, c, f.value); rect(n, 9 + COV, c, 9 + COV, c + 1, s); d.merges.push({ s: { r: 9 + COV, c }, e: { r: 9 + COV, c: c + 1 } });
    ws[A1(8 + COV, c)].l = { Target: `#'${f.sheet}'!${f.ref}`, Tooltip: `المصدر: ${f.sheet} ${f.ref}` };
    ws[A1(9 + COV, c)].l = { Target: `#'${f.sheet}'!${f.ref}`, Tooltip: `المصدر: ${f.sheet} ${f.ref}` };
  });
  d.heights.set(8 + COV, 24).set(9 + COV, 40).set(10 + COV, 14);
  text(ws, 11 + COV, 1, "أجزاء المصنف"); put(n, 11 + COV, 1, X.SECTION); d.heights.set(11 + COV, 24);
  const nav = [[RAW[0].name, "البيانات الخام", "البيانات الخام كما رفعت، كل ورقة وكل عمود"], [STEPS[0], "المعالجة", "أوراق المعالجة بترتيب تطبيقها"], [POP_PARTS[0], "المجتمع", "المجتمع بعد المعالجة، كل الحقول"], [S.sample, "العينة", "العينة بعد المعالجة، كل الحقول"], [S.stats, "الإحصائيات", "حسابات التقرير جداول محورية ورسوم"], [S.source, "مصدر الأرقام", "مصدر كل رقم في التقرير"]];
  nav.forEach(([sheet, label, desc], i) => {
    const r = 12 + COV + Math.floor(i / 2) * 2, c = 1 + (i % 2) * 4;
    d.buttons.push({ text: label, target: sheet, at: [r, c, r + 1, c + 2], fill: T.panel, color: T.navy, line: T.goldLight });
    text(ws, r, c + 2, desc); put(n, r, c + 2, X.DESC); d.merges.push({ s: { r, c: c + 2 }, e: { r, c: c + 3 } });
    d.heights.set(r, 32).set(r + 1, 8);
  });
  const listRow = 19 + COV;
  text(ws, listRow, 1, "فهرس كل الأوراق بالترتيب"); put(n, listRow, 1, X.SECTION); d.heights.set(listRow, 24);
  d.listRow = listRow;
  sheets[n] = ws;
}
for (const sname of SEP) sheets[sname] = XLSX.utils.aoa_to_sheet([]);
for (const r of RAW) sheets[r.name] = XLSX.utils.aoa_to_sheet([["placeholder"]]);

// processing sheets, named by what they do, in the order applied
const stepSheet = (idx, purpose, head, blocks) => {
  const n = STEPS[idx], d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, n, purpose, 22);
  headerBlock(ws, n, head);
  backButton(n);
  d.widths = [3, ...Array(30).fill(16)];
  let c = 1;
  blocks.forEach((b, bi) => {
    const key = b.key ?? `step${idx + 1}_${bi + 1}`;
    tables[key] ??= { table: `جدول_${STEPS[idx].replace(/ /g, "_")}_${bi + 1}`, sheet: n, start: [TABLE_ROW + 2, c] };
    tables[key].start = [TABLE_ROW + 2, c];
    text(ws, TABLE_ROW, c, b.title); put(n, TABLE_ROW, c, X.SECTION); d.heights.set(TABLE_ROW, 22);
    if (b.note) { text(ws, TABLE_ROW + 1, c, b.note); put(n, TABLE_ROW + 1, c, X.NOTE); }
    tableAoa(ws, n, key, b.head, b.rows, b.num ?? [], b.pct ?? []);
    (b.widths ?? b.head.map(() => 16)).forEach((w, j) => { d.widths[c + j] = w; });
    d.widths[c + b.head.length] = 3;
    c += b.head.length + 1;
  });
  d.freeze = TABLE_ROW + 3;
  sheets[n] = ws;
  descOf[n] = purpose;
};
const recon = st.perSheet.map((x) => [x.sheet, x.rows, x.pre, x.header, x.dup, x.noPortDate, x.cutoff, x.kept, x.rows - x.pre - x.header - x.dup - x.noPortDate - x.cutoff - x.kept]);
stepSheet(0, "يحدد صف العناوين في كل ورقة من أوراق المجتمع ويربط كل حقل بعموده فيها.",
  { reads: RAWPOP, rule: "صف العناوين هو أول صف فيه «رقم صورة الأشعة» أو «معرف الأشعة»، وما قبله صفوف ملخص لا تدخل؛ في أوراق 2025 يحمل عمود «موظف المستوى» كود الموظف؛ العناوين التي لا تختلف إلا في همزة الألف عمود واحد.", rows: ba(rawPopRows, afterHeader) }, [
  { title: "ربط الأعمدة لكل ورقة", head: ["الورقة", "صفوف قبل العناوين", "صف العناوين", "رقم الصورة", "تاريخ الدخول", "المنفذ", "نوع المنفذ", "كود موظف المستوى الأول", "كود موظف المستوى الثاني", "نتيجة المستوى الأول", "نتيجة المستوى الثاني"], rows: st.header.map((h) => [h.sheet, h.pre, h.headerRow, h.mapped.id, h.mapped.date, h.mapped.port, h.mapped.type, h.mapped.c1, h.mapped.c2, h.mapped.r1, h.mapped.r2]), widths: [10, 12, 10, 24, 24, 20, 18, 24, 24, 24, 24] },
  { title: "كل عمود أصلي وعموده في المجتمع المعالج", head: ["الورقة", "العمود", "العنوان الأصلي", "العمود في المجتمع المعالج"], rows: st.headerMap, widths: [10, 8, 30, 30] },
]);
stepSheet(1, "يحذف الصورة التي تكرر رقمها في ورقة سابقة، فتحسب كل صورة مرة واحدة.",
  { reads: `«${STEPS[0]}»`, rule: "تقرأ الأوراق من الأقدم إلى الأحدث وورقة Q4B أخيرا؛ أي صورة ظهر رقمها من قبل تحذف، فيبقى الصف من ورقة فترته.", rows: ba(afterHeader, afterDup) }, [
  { title: "الصفوف المحذوفة لكل ورقة", head: ["الورقة", "صفوف مكررة"], rows: st.perSheet.map((x) => [x.sheet, x.dup]), widths: [12, 12] },
  { title: `الصفوف المحذوفة (${fmtN(st.dup.length)})`, head: ["الورقة", "الصف في الورقة", "رقم الصورة", "ظهر أولا في"], rows: st.dup, widths: [12, 12, 22, 14] },
]);
stepSheet(2, "يستبعد الصفوف التي لا يعرف منفذها أو تاريخ دخولها.",
  { reads: `«${STEPS[1]}»`, rule: "يستبعد كل صف بلا اسم منفذ أو بلا تاريخ دخول صالح.", rows: ba(afterDup, afterNo) }, [
  { title: "الصفوف المستبعدة لكل ورقة", head: ["الورقة", "صفوف مستبعدة"], rows: st.perSheet.map((x) => [x.sheet, x.noPortDate]) },
  { title: `الصفوف المستبعدة (${st.noPortDate.length})`, head: ["الورقة", "الصف في الورقة", "رقم الصورة", "المنفذ", "التاريخ", "السبب"], rows: st.noPortDate.length ? st.noPortDate : [["لا يوجد", "", "", "", "", ""]] },
]);
stepSheet(3, "يقصر المجتمع على أشهر فترة التقرير ويطابق صفوف كل ورقة.",
  { reads: `«${STEPS[2]}»`, rule: "تدخل الأشهر حتى سبتمبر 2026 فقط، آخر شهر في فترة التقرير؛ تستبعد صفوف الأشهر بعده.", rows: ba(afterNo, afterCut) }, [
  { title: "الصفوف المستبعدة حسب الورقة والشهر", head: ["الورقة", "الشهر", "صفوف مستبعدة"], rows: st.cutoff },
  { title: "مطابقة الصفوف لكل ورقة", note: "صفوف الورقة = قبل العناوين + العناوين + مكرر + بلا منفذ أو تاريخ + بعد الفترة + المعتمد", head: ["الورقة", "صفوف الورقة", "قبل العناوين", "العناوين", "مكرر", "بلا منفذ أو تاريخ", "بعد الفترة", "المعتمد", "الفرق"], rows: [...recon, ["الإجمالي", ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => sumBy(recon, k))]], widths: [12, 12, 12, 10, 10, 14, 10, 12, 8] },
]);
stepSheet(4, "يضيف لكل صورة الشهر وعلامة الاشتباه وعلامة وجود كود موظف.",
  { reads: `«${STEPS[3]}»`, rule: "الشهر من تاريخ الدخول؛ «اشتباه» إذا كانت نتيجة أي من المستويين «اشتباه»؛ «مكود» إذا حمل أحد المستويين كود موظف حقيقي (ليس نتيجة آلية).", rows: same(afterCut) }, [
  { title: "الحقول المشتقة", head: ["الحقل", "من", "القاعدة", "مجموع على المجتمع"], rows: [["الشهر (مشتق)", "تاريخ الدخول", "السنة والشهر من التاريخ", ""], ["اشتباه (مشتق)", "نتيجة المستويين", "1 إذا كانت أي منهما «اشتباه»", sumBy(st.agg, 6)], ["مكود (مشتق)", "كود موظف المستويين", "1 إذا وجد كود موظف حقيقي", sumBy(st.agg, 7)]], widths: [16, 26, 34, 18] },
]);
stepSheet(5, "يجمع الكتابات المختلفة لاسم المنفذ تحت اسم واحد في المجتمع والعينة.",
  { reads: `«${STEPS[4]}» و${STUDYRAW}`, rule: "تجمع الكتابات المختلفة لاسم المنفذ تحت الاسم الأكثر تكرارا، مع تصحيح الأخطاء الإملائية والأسماء البديلة المعروفة.", rows: same(afterCut) }, [
  { title: "الاسم الأصلي والاسم الموحد", head: ["المجموعة", "الاسم الأصلي", "الاسم الموحد", "تغير؟", "صفوف"], rows: st.names, widths: [10, 34, 34, 12, 12] },
]);
stepSheet(6, "يحدد مجموعة كل منفذ (بري أو بحري أو الميناء).",
  { reads: `«${STEPS[5]}»`, rule: "تؤخذ مجموعة المنفذ من نتائج الدراسة، وإن لم يظهر المنفذ فيها فمن «نوع المنفذ» في المجتمع.", rows: same(afterCut) }, [
  { title: "المجموعة لكل منفذ", head: ["المنفذ الموحد", "المجموعة في العينة", "مصدر المجموعة", "المجموعة المعتمدة"], rows: st.groups, widths: [34, 18, 26, 18] },
]);
stepSheet(7, "يجمع المجتمع المعالج حسب المنفذ والشهر، ومنه تحسب جداول المجتمع المحورية.",
  { reads: `«${STEPS[6]}»`, rule: "صف لكل منفذ وشهر: عدد الصور، والصور المشتبه بها، والصور التي تحمل كود موظف.", rows: ba(afterCut, st.agg.length) }, [
  { key: "agg", title: `المجتمع حسب المنفذ والشهر (${st.agg.length} صفا، مجموع الصور ${fmtN(sumBy(st.agg, 5))})`, head: aggCols, rows: st.agg, widths: [34, 14, 18, 8, 10, 12, 10, 10] },
]);
stepSheet(8, "يربط حقول نتائج الدراسة بأعمدتها.",
  { reads: STUDYRAW, rule: "لكل حقل قائمة أسماء مقبولة، ويؤخذ أول اسم موجود منها في الورقة.", rows: same(st.study.dataRows) }, [
  { title: "ربط الأعمدة", head: ["الحقل", "الأسماء المقبولة", "العمود في الورقة"], rows: st.study.mapping.map(([k, a, b]) => [({ inPeriod: "ضمن فترة التقرير", port: "المنفذ", group: "نوع المنفذ", year: "السنة", month: "الشهر", imageStatus: "حالة نتيجة الصورة", imageMatch: "توائم الصورة", l1Code: "كود موظف المستوى الأول", l1Name: "موظف المستوى الأول", l1Status: "حالة المستوى الأول", l1Match: "توائم المستوى الأول", l2Code: "كود موظف المستوى الثاني", l2Name: "موظف المستوى الثاني", l2Status: "حالة المستوى الثاني", l2Match: "توائم المستوى الثاني" })[k] ?? k, a, b]), widths: [22, 40, 34] },
]);
stepSheet(9, "يستبعد صفوف الدراسة خارج فترة التقرير أو بلا منفذ.",
  { reads: `«${STEPS[8]}»`, rule: "يستبعد كل صف بلا «المنفذ الموحد» أو «ضمن فترة التقرير» فيه لا يساوي «نعم».", rows: ba(st.study.dataRows, st.study.kept) }, [
  { title: `الصفوف المستبعدة (${st.study.dropped.length})`, head: ["الصف في الورقة", "السبب", ...studyTableCols], rows: st.study.dropped.map((r) => r.map((v) => v ?? "")), widths: [10, 26, ...studyTableCols.map(() => 14)] },
]);
stepSheet(10, "يضيف لكل صورة مدروسة السنة والتوائم واعتماد كل مستوى.",
  { reads: `«${STEPS[9]}»`, rule: "السنة إذا كانت أكبر من صفر؛ التوائم 1 إذا كانت «توائم الصورة» تساوي 1؛ يعتمد المستوى إذا كانت حالته ليست فارغة ولا «بدون نتيجة».", rows: same(st.study.kept) }, [
  { title: "توائم الصورة", head: ["القيمة الأصلية", "التوائم (مشتق)", "صفوف"], rows: st.study.dist.match },
  { title: "حالة المستوى الأول", head: ["الحالة", "معتمد", "صفوف"], rows: st.study.dist.l1 },
  { title: "حالة المستوى الثاني", head: ["الحالة", "معتمد", "صفوف"], rows: st.study.dist.l2 },
  { title: "السنة", head: ["القيمة الأصلية", "السنة (مشتقة)", "صفوف"], rows: st.study.dist.year },
]);
stepSheet(11, "يستبعد النتائج الآلية من عداد الموظفين.",
  { reads: `«${STEPS[10]}» و«${STEPS[4]}»`, rule: "الأكواد X-RAY وXRAY نتائج آلية لا موظفون: لا تحسب ضمن الموظفين ولا ضمن الصور التي تحمل كود موظف؛ الصفوف نفسها تبقى.", rows: same(st.study.kept) }, [
  { title: "في المجتمع", head: ["الورقة", "الكود", "مرات الظهور"], rows: st.popCodes },
  { title: "في العينة", head: ["المستوى", "الكود", "مرات الظهور"], rows: st.study.dist.codes },
]);

// processed big sheets: SheetJS writes the header block only; rows are streamed in later
for (const [i, n] of POP_PARTS.entries()) {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, `المجتمع بعد المعالجة، الجزء ${i + 1} من ${POP_PARTS.length}`, "كل صورة في المجتمع بعد المعالجة، بكل أعمدة أوراق المجتمع الأصلية ثم الحقول المشتقة.", 20);
  headerBlock(ws, n, { reads: `${RAWPOP} بعد أوراق المعالجة من «${STEPS[0]}» إلى «${STEPS[6]}»`, rule: `أكثر من مليون صف لا يتسع في ورقة واحدة، فيقسم المجتمع على ${POP_PARTS.length} أوراق بالترتيب.`, rows: `في هذا الجزء ${fmtN(stage.popParts[i].rows)} من ${fmtN(afterCut)}` });
  backButton(n);
  design[n].widths = [3, ...stage.popCols.map(() => 14), 3, 3, 26, 14, 14, 3, 11, 11, 11, 3, ...Array(10).fill(10)];
  design[n].freeze = TABLE_ROW + 1;
  sheets[n] = ws;
  descOf[n] = `المجتمع المعالج، الجزء ${i + 1}: ${fmtN(stage.popParts[i].rows)} صف`;
}
{
  const n = S.sample;
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, "العينة بعد المعالجة", "كل صورة مدروسة ضمن فترة التقرير، بكل أعمدة «نتائج الدراسة» ثم الحقول المشتقة.", 20);
  headerBlock(ws, n, { reads: `${STUDYRAW} بعد أوراق المعالجة من «${STEPS[8]}» إلى «${STEPS[11]}»`, rule: "تبقى كل صورة مدروسة ضمن فترة التقرير ولها منفذ.", rows: ba(st.study.dataRows, st.study.kept) });
  backButton(n);
  design[n].widths = [3, ...sampleCols.map(() => 14), 3, 3, 26, 14, 14, 3, 11, 11, 11, 3, ...Array(10).fill(10)];
  design[n].freeze = TABLE_ROW + 1;
  sheets[n] = ws;
  descOf[n] = "العينة المعالجة: كل صفوف الدراسة ضمن الفترة";
}
for (const p of pivots.filter((p) => p.sheet !== S.stats)) { text(sheets[p.sheet], TABLE_ROW - 1, p.at[1], p.title); put(p.sheet, TABLE_ROW - 1, p.at[1], X.SECTION); design[p.sheet].heights.set(TABLE_ROW - 1, 22); }

// stats
{
  const n = S.stats, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, "الإحصائيات", "كل حسابات التقرير جداول محورية، بجانب كل جدول رسمه والشريحة التي يغذيها.", 21);
  headerBlock(ws, n, { reads: `«${STEPS[7]}» و«${S.sample}»`, rule: "كل جدول محوري يحسب مقياسا واحدا بالاسم الظاهر فوقه، ويتحدث تلقائيا عند فتح المصنف.", rows: `المجتمع ${fmtN(afterCut)} صورة، العينة ${fmtN(st.study.kept)} صورة` }, 18);
  backButton(n);
  const blockW = [24, 14, 14, 2, 10, 10, 10, 10, 10, 4];
  d.widths = [3, ...blockW, ...blockW, 3];
  for (const p of pivots.filter((p) => p.sheet === n)) {
    text(ws, p.titleAt[0], p.titleAt[1], p.title); put(n, p.titleAt[0], p.titleAt[1], X.SECTION);
    text(ws, p.titleAt[0] + 1, p.titleAt[1], `يغذي الشريحة: ${p.feeds}`); put(n, p.titleAt[0] + 1, p.titleAt[1], X.NOTE);
    d.heights.set(p.titleAt[0], 22);
  }
  const sl = slicers.find((s) => s.sheet === n) ?? { at: [BLOCK.rows[2] + 3, BLOCK.cols[1]] };
  text(ws, sl.at[0] - 3, sl.at[1], "مقسم السنة"); put(n, sl.at[0] - 3, sl.at[1], X.SECTION);
  text(ws, sl.at[0] - 2, sl.at[1], "يصفي جدولي نتائج الدراسة وعينة الميناء حسب السنة"); put(n, sl.at[0] - 2, sl.at[1], X.NOTE);
  ws["!ref"] = "A1:V67";
  sheets[n] = ws;
  descOf[n] = "حسابات التقرير جداول محورية في شبكة مع رسومها";
}

// source of figures
{
  const n = S.source, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const head = ["الرقم", "القيمة في التقرير", "الورقة", "الخلية", "الحقل", "التصفية", "المقياس", "الجدول المحوري"];
  XLSX.utils.sheet_add_aoa(ws, [head, ...figures.map((f) => [f.label, f.value, f.sheet, f.ref, f.field, f.filterText, f.measure, f.pivot])], { origin: { r: TABLE_ROW, c: 1 } });
  figures.forEach((f, i) => { ws[A1(TABLE_ROW + 1 + i, 1)].l = { Target: `#'${f.sheet}'!${f.ref}`, Tooltip: `الانتقال إلى ${f.sheet} ${f.ref}` }; put(n, TABLE_ROW + 1 + i, 1, X.LINK); put(n, TABLE_ROW + 1 + i, 2, typeof f.value === "number" && !Number.isInteger(f.value) ? X.BODY_PCT : X.BODY_NUM); });
  band(ws, n, "مصدر الأرقام", "كل رقم في التقرير، والخلية والحقل والتصفية والمقياس التي يأتي منها؛ اضغط الرقم للانتقال إلى خليته.", 9);
  headerBlock(ws, n, { reads: `«${S.stats}» و«${POP_PARTS[0]}» و«${S.sample}»`, rule: "كل رقم يقرأ من خلية جدول محوري واحدة، والقيمة هنا هي قيمة التقرير نفسها.", rows: `${figures.length} رقما` }, 8);
  backButton(n);
  d.widths = [3, 30, 16, 14, 8, 16, 48, 10, 30, 3];
  d.freeze = TABLE_ROW + 1;
  text(ws, TABLE_ROW - 1, 1, "الأرقام ومصادرها"); put(n, TABLE_ROW - 1, 1, X.SECTION);
  tables.src.cols = head; tables.src.n = figures.length;
  sheets[n] = ws;
  descOf[n] = "مصدر كل رقم في التقرير، مع رابط إلى خليته";
}
for (const r of RAW) descOf[r.name] = `البيانات الخام كما رفعت: ورقة «${r.name}»`;
for (const s of SEP) descOf[s] = "فاصل";
descOf[S.index] = "هذه الصفحة";

// cover: index of every sheet, with links
{
  const n = S.index, ws = sheets[n], d = design[n];
  ORDER.forEach((name, i) => {
    const r = d.listRow + 1 + i;
    text(ws, r, 1, name); put(n, r, 1, X.LINK);
    ws[A1(r, 1)].l = { Target: `#'${name}'!A1`, Tooltip: `الانتقال إلى ${name}` };
    text(ws, r, 2, descOf[name] ?? ""); put(n, r, 2, X.DESC); d.merges.push({ s: { r, c: 2 }, e: { r, c: 8 } });
  });
  ws["!ref"] = `A1:K${d.listRow + ORDER.length + 2}`;
}

const wb = XLSX.utils.book_new();
for (const n of ORDER) { const ws = sheets[n]; if (design[n].merges.length) ws["!merges"] = design[n].merges; XLSX.utils.book_append_sheet(wb, ws, n); }
const base = await JSZip.loadAsync(XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: false }));
const tSheet = Date.now();

// ---------- assemble the package ----------
const ct = [];
const addRel = async (path, id, type, target, external) => {
  const f = zip.file(path);
  const xml = f ? await f.async("string") : `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(path, xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type.startsWith("http") ? type : REL + type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/></Relationships>`));
};
// drop what the report does not carry: customXml, raw docProps, the raw workbook/rels/content types, unused raw sheets
for (const p of Object.keys(zip.files)) if (/^customXml\//.test(p) || p === "docProps/custom.xml" || p === "xl/connections.xml") zip.remove(p); // Power Query package and its connection, not data
const unused = rawSheets.filter((s) => !RAW.includes(s));
for (const s of unused) { zip.remove(`xl/${s.part}`); zip.remove(`xl/${s.part.replace("worksheets/", "worksheets/_rels/")}.rels`); }
// raw sheets move to xl/worksheets/src_<n>.xml so SheetJS's sheetN.xml names stay free
const rename = (from, to) => { const f = zip.files[from]; delete zip.files[from]; f.name = to; zip.files[to] = f; };
for (const [i, r] of RAW.entries()) {
  r.newPart = `worksheets/src_${i + 1}.xml`;
  rename(`xl/${r.part}`, `xl/${r.newPart}`);
  rename(`xl/${r.part.replace("worksheets/", "worksheets/_rels/")}.rels`, `xl/${r.newPart.replace("worksheets/", "worksheets/_rels/")}.rels`);
}
if (NORAW) for (const r of RAW) { zip.file(`xl/${r.newPart}`, `${XML}<worksheet ${NS}><sheetData/></worksheet>`); zip.remove(`xl/${r.newPart.replace("worksheets/", "worksheets/_rels/")}.rels`); }
// the raw study sheet was the selected tab; unselect it (same byte length) while streaming
const studyRaw = RAW.find((r) => r.name === stage.rawSheets[stage.rawSheets.length - 1]);
{
  const f = zip.file(`xl/${studyRaw.newPart}`);
  let done = false;
  const tr = new Transform({ transform(chunk, _e, cb) { if (!done) { const s = chunk.toString("latin1"); const i = s.indexOf('tabSelected="1"'); if (i >= 0) { chunk = Buffer.from(chunk); chunk.write('tabSelected="0"', i, "latin1"); } done = true; } cb(null, chunk); } });
  if (!NORAW) zip.file(`xl/${studyRaw.newPart}`, f.nodeStream().pipe(tr));
}
// SheetJS parts: docProps, rels, workbook, worksheets (non-raw, non-big written directly)
for (const p of ["_rels/.rels", "docProps/app.xml", "docProps/core.xml"]) zip.file(p, await base.file(p).async("nodebuffer"));
zip.file("xl/styles.xml", mergedStyles());
zip.file("xl/theme/theme1.xml", themeXml);
zip.file("xl/media/logo.png", LOGO);
const baseWbRels = await base.file("xl/_rels/workbook.xml.rels").async("string");
const relTarget = {};
for (const mm of baseWbRels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Type="[^"]*\/worksheet"[^>]*Target="([^"]+)"/g)) relTarget[mm[1]] = mm[2];
const baseWb = await base.file("xl/workbook.xml").async("string");
const sheetPart = {}; // name -> xl/... part path
for (const mm of baseWb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) sheetPart[mm[1].replace(/&amp;/g, "&")] = relTarget[mm[2]].replace(/^\/?xl\//, "");
let wbRels = baseWbRels;
for (const r of RAW) wbRels = wbRels.replace(`Target="${sheetPart[r.name]}"`, `Target="${r.newPart}"`).replace(`Target="/xl/${sheetPart[r.name]}"`, `Target="${r.newPart}"`);
wbRels = wbRels.replace(/<Relationship [^>]*Type="[^"]*\/(sharedStrings|styles|theme|sheetMetadata)"[^>]*\/>/g, "");
wbRels = wbRels.replace("</Relationships>", `<Relationship Id="rIdSst" Type="${REL}sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdSty" Type="${REL}styles" Target="styles.xml"/><Relationship Id="rIdThm" Type="${REL}theme" Target="theme/theme1.xml"/><Relationship Id="rIdExt1" Type="${REL}externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>`);
zip.file("xl/_rels/workbook.xml.rels", wbRels);

// tables
let tableId = 100;
const tableXml = (t, ref) => `${XML}<table ${NS} id="${t.id}" name="${t.table}" displayName="${t.table}" ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/><tableColumns count="${t.cols.length}">${t.cols.map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`).join("")}</tableColumns><tableStyleInfo name="نمط التقرير" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
const sheetTables = {};
for (const t of Object.values(tables)) {
  t.id = ++tableId;
  t.ref = `${A1(t.start[0], t.start[1])}:${A1(t.start[0] + t.n, t.start[1] + t.cols.length - 1)}`;
  zip.file(`xl/tables/table${t.id}.xml`, tableXml(t, t.ref));
  ct.push([`/xl/tables/table${t.id}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"]);
  (sheetTables[t.sheet] ??= []).push(t);
}

// pivot caches
const isNum = (vals) => vals.length > 0 && vals.every((v) => typeof v === "number" || v === "" || v === null);
for (const c of Object.values(caches)) {
  const fields = c.t.cols.map((h, i) => {
    const vals = c.axis[h] ?? (c.rows ? c.rows.map((r) => r[i]) : null);
    let attrs = "";
    if (vals && isNum(vals)) {
      const nums = vals.filter((v) => typeof v === "number");
      attrs = ` containsSemiMixedTypes="0" containsString="0" containsNumber="1"${nums.every(Number.isInteger) ? ' containsInteger="1"' : ""} minValue="${nums.reduce((a, b) => Math.min(a, b))}" maxValue="${nums.reduce((a, b) => Math.max(a, b))}"${vals.some((v) => v === "" || v === null) ? ' containsBlank="1"' : ""}`;
    } else if (vals && vals.some((v) => v === "" || v === null)) attrs = ' containsBlank="1"';
    if (!c.items[h]) return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${attrs}/></cacheField>`;
    const items = c.items[h].map((v) => (v === "" ? "<m/>" : typeof v === "number" ? `<n v="${v}"/>` : `<s v="${esc(v)}"/>`)).join("");
    return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${attrs} count="${c.items[h].length}">${items}</sharedItems></cacheField>`;
  });
  zip.file(`xl/pivotCache/pivotCacheDefinition${c.id}.xml`, `${XML}<pivotCacheDefinition ${NS} saveData="0" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="0"><cacheSource type="worksheet"><worksheetSource name="${c.t.table}"/></cacheSource><cacheFields count="${fields.length}">${fields.join("")}</cacheFields><extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotCacheDefinition pivotCacheId="${c.id}"/></ext></extLst></pivotCacheDefinition>`);
  ct.push([`/xl/pivotCache/pivotCacheDefinition${c.id}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"]);
  wbRels = (await zip.file("xl/_rels/workbook.xml.rels").async("string")).replace("</Relationships>", `<Relationship Id="rIdPc${c.id}" Type="${REL}pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition${c.id}.xml"/></Relationships>`);
  zip.file("xl/_rels/workbook.xml.rels", wbRels);
}

// aggregation used for chart caches (same as the pivot)
const aggregate = (p) => {
  const c = caches[p.cache];
  const val = (h, i) => (c.axis[h] ? c.axis[h][i] : c.rows[i][c.t.cols.indexOf(h)]);
  const n = c.rows ? c.rows.length : c.axis[F_PORT].length;
  const groups = new Map(c.items[p.rows].map((it) => [it, []]));
  for (let i = 0; i < n; i++) {
    if (p.page && val(p.page[0], i) !== p.page[1]) continue;
    groups.get(val(p.rows, i) ?? "")?.push(i);
  }
  return c.items[p.rows].map((it) => p.data.map(([f, sub]) => { const ix = groups.get(it); return sub === "sum" ? ix.reduce((s, i) => s + val(f, i), 0) : sub === "count" ? ix.length : ix.reduce((s, i) => s + val(f, i), 0) / ix.length; }));
};

// pivot tables
const sheetPivots = {};
pivots.forEach((p, i) => {
  const n = i + 1, c = caches[p.cache];
  const fIdx = (h) => c.t.cols.indexOf(h);
  const rowItems = c.items[p.rows];
  const dataSet = new Set(p.data.map((d) => d[0]));
  const slicerFields = new Set(slicers.filter((s) => s.kind === "pivot" && s.pivots.includes(n)).map((s) => s.field));
  const pf = c.t.cols.map((h) => {
    const dataAttr = dataSet.has(h) ? ' dataField="1"' : "";
    const axis = h === p.rows ? ' axis="axisRow"' : h === p.page?.[0] ? ' axis="axisPage"' : "";
    if (!axis && !slicerFields.has(h)) return `<pivotField${dataAttr} showAll="0"/>`;
    return `<pivotField${axis}${dataAttr} showAll="0"><items count="${c.items[h].length + 1}">${c.items[h].map((_, k) => `<item x="${k}"/>`).join("")}<item t="default"/></items></pivotField>`;
  }).join("");
  const nd = p.data.length, o = p.out;
  const loc = `<location ref="${A1(o.r0, o.c0)}:${A1(o.grand, o.c0 + nd)}" firstHeaderRow="1" firstDataRow="${nd > 1 ? 2 : 1}" firstDataCol="1"${p.page ? ' rowPageCount="1" colPageCount="1"' : ""}/>`;
  const ri = `<rowItems count="${rowItems.length + 1}">${rowItems.map((_, k) => (k ? `<i><x v="${k}"/></i>` : "<i><x/></i>")).join("")}<i t="grand"><x/></i></rowItems>`;
  const cf = nd > 1 ? `<colFields count="1"><field x="-2"/></colFields><colItems count="${nd}">${p.data.map((_, k) => (k ? `<i i="${k}"><x v="${k}"/></i>` : "<i><x/></i>")).join("")}</colItems>` : `<colItems count="1"><i/></colItems>`;
  const pg = p.page ? `<pageFields count="1"><pageField fld="${fIdx(p.page[0])}" item="${c.items[p.page[0]].indexOf(p.page[1])}" hier="-1"/></pageFields>` : "";
  const df = `<dataFields count="${nd}">${p.data.map(([f, sub, name, fmt]) => `<dataField name="${esc(name)}" fld="${fIdx(f)}"${sub === "sum" ? "" : ` subtotal="${sub}"`} baseField="0" baseItem="0" numFmtId="${fmt}"/>`).join("")}</dataFields>`;
  zip.file(`xl/pivotTables/pivotTable${n}.xml`, `${XML}<pivotTableDefinition ${NS} name="${p.name}" cacheId="${c.id}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0" dataCaption="القيم" grandTotalCaption="الإجمالي" rowHeaderCaption="${esc(label(p.rows))}" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">${loc}<pivotFields count="${c.t.cols.length}">${pf}</pivotFields><rowFields count="1"><field x="${fIdx(p.rows)}"/></rowFields>${ri}${cf}${pg}${df}<pivotTableStyleInfo name="نمط التقرير" showRowHeaders="1" showColHeaders="1" showRowStripes="1" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`);
  ct.push([`/xl/pivotTables/pivotTable${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"]);
  zip.file(`xl/pivotTables/_rels/pivotTable${n}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${c.id}.xml"/></Relationships>`);
  (sheetPivots[p.sheet] ??= []).push(n);
});

// charts
const rpr = (sz, color, b) => `<a:defRPr sz="${sz}"${b ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr>`;
const txPr = (sz, color, b) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${rpr(sz, color, b)}</a:pPr><a:endParaRPr lang="ar-SA"/></a:p></c:txPr>`;
const chartXml = (p, cats, vals) => {
  const ch = p.chart, name = p.data[ch.dataIx][2], o = p.out;
  const catF = abs(p.sheet, o.first, o.c0, o.last), valF = abs(p.sheet, o.first, o.valueCol(ch.dataIx), o.last);
  const strCache = `<c:strCache><c:ptCount val="${cats.length}"/>${cats.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
  const isBar = ch.kind === "bar";
  return `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL.slice(0, -1)}"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${rpr(1100, T.navy, 1)}</a:pPr><a:r><a:rPr lang="ar-SA" sz="1100" b="1"><a:solidFill><a:srgbClr val="${T.navy}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr><a:t>${esc(p.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${isBar ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${ch.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:dLbls><c:numFmt formatCode="${ch.fmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, T.text)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strRef><c:f>${esc(catF)}</c:f>${strCache}</c:strRef></c:cat><c:val><c:numRef><c:f>${esc(valF)}</c:f>${numCache}</c:numRef></c:val></c:ser><c:gapWidth val="60"/><c:axId val="101"/><c:axId val="102"/></c:barChart><c:catAx><c:axId val="101"/><c:scaling><c:orientation val="${isBar ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${isBar ? "r" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="${T.hair}"/></a:solidFill></a:ln></c:spPr>${txPr(800, T.text)}<c:crossAx val="102"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="102"/><c:scaling><c:orientation val="${isBar ? "maxMin" : "minMax"}"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="${isBar ? "t" : "r"}"/><c:numFmt formatCode="${ch.fmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx val="101"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="${T.white}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${T.hair}"/></a:solidFill></a:ln></c:spPr>${txPr(900, T.text)}</c:chartSpace>`;
};

// drawings
const EMU = 9525;
const anchor = (r1, c1, r2, c2, body, edit = "oneCell") => `<xdr:twoCellAnchor editAs="${edit}"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const logoXml = (id) => `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>${6 * EMU}</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>${4 * EMU}</xdr:rowOff></xdr:from><xdr:ext cx="${180 * EMU}" cy="${40 * EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="شعار الهيئة"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${180 * EMU}" cy="${40 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
const frame = (id, name, uri, inner) => `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic></xdr:graphicFrame>`;
const buttonXml = (id, b, relId) => {
  const [r1, c1, r2, c2] = b.at;
  const line = b.line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${b.line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  return anchor(r1, c1, r2, c2, `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="زر ${esc(b.text)} ${id}" descr="${esc(b.text)}"><a:hlinkClick xmlns:r="${REL.slice(0, -1)}" r:id="${relId}" tooltip="${esc(`الانتقال إلى ${b.target}`)}"/></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 22000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="${b.fill}"/></a:solidFill>${line}</xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" lIns="36000" rIns="36000" rtlCol="1" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr" rtl="1"/><a:r><a:rPr lang="ar-SA" sz="1100" b="1"><a:solidFill><a:srgbClr val="${b.color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr><a:t>${esc(b.text)}</a:t></a:r></a:p></xdr:txBody></xdr:sp>`, "absolute");
};
const slicerAnchor = (id, s) => {
  const [req, ns] = s.kind === "pivot" ? ["a14", 'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"'] : ["sle15", 'xmlns:sle15="http://schemas.microsoft.com/office/drawing/2012/slicer"'];
  const [r1, c1, r2, c2] = s.at;
  const choice = anchor(r1, c1, r2, c2, frame(id, s.name, "http://schemas.microsoft.com/office/drawing/2010/slicer", `<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="${s.name}"/>`));
  const fb = anchor(r1, c1, r2, c2, `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ar-SA" sz="1100"><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr><a:t>مقسم</a:t></a:r></a:p></xdr:txBody></xdr:sp>`);
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice ${ns} Requires="${req}">${choice}</mc:Choice><mc:Fallback>${fb}</mc:Fallback></mc:AlternateContent>`;
};
let chartN = 0, drawingN = 0;
const sheetDrawing = {};
const chartsMeta = [], buttonsMeta = [];
for (const n of ORDER.filter((x) => !SEPS.has(x) && !RAWSET.has(x))) {
  const dn = ++drawingN;
  const rels = `xl/drawings/_rels/drawing${dn}.xml.rels`;
  await addRel(rels, "rIdLogo", "image", "../media/logo.png");
  let id = 2;
  const parts = [logoXml(id++)];
  for (const [bi, b] of design[n].buttons.entries()) {
    const relId = `rIdBtn${bi + 1}`;
    await addRel(rels, relId, "hyperlink", `#'${b.target}'!A1`);
    parts.push(buttonXml(id++, b, relId));
    buttonsMeta.push({ sheet: n, name: `زر ${b.text} ${id - 1}`, text: b.text, target: b.target });
  }
  for (const p of pivots.filter((p) => p.sheet === n)) {
    const cn = ++chartN;
    const cats = caches[p.cache].items[p.rows].map(String);
    const vals = aggregate(p).map((r) => r[p.chart.dataIx]);
    zip.file(`xl/charts/chart${cn}.xml`, chartXml(p, cats, vals));
    ct.push([`/xl/charts/chart${cn}.xml`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"]);
    await addRel(rels, `rIdCh${cn}`, "chart", `../charts/chart${cn}.xml`);
    const [r1, c1, r2, c2] = p.chart.at;
    parts.push(anchor(r1, c1, r2, c2, frame(id++, `رسم ${p.title}`, "http://schemas.openxmlformats.org/drawingml/2006/chart", `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdCh${cn}"/>`)));
    chartsMeta.push({ sheet: n, chart: cn, pivot: p.name, dataField: p.data[p.chart.dataIx][2], cats, vals });
  }
  for (const s of slicers.filter((s) => s.sheet === n)) parts.push(slicerAnchor(id++, s));
  zip.file(`xl/drawings/drawing${dn}.xml`, `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL.slice(0, -1)}">${parts.join("")}</xdr:wsDr>`);
  ct.push([`/xl/drawings/drawing${dn}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
  sheetDrawing[n] = dn;
}
writeFileSync(join(out, "charts.json"), JSON.stringify(chartsMeta));
writeFileSync(join(out, "buttons.json"), JSON.stringify(buttonsMeta));

// slicers
const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const pivotCacheRefs = [], tableCacheRefs = [];
for (const [i, s] of slicers.entries()) {
  const k = i + 1;
  let body;
  if (s.kind === "pivot") {
    const c = caches[s.cache];
    body = `<pivotTables>${s.pivots.map((n) => `<pivotTable tabId="${sheetId(pivots[n - 1].sheet)}" name="${esc(pivots[n - 1].name)}"/>`).join("")}</pivotTables><data><tabular pivotCacheId="${c.id}"><items count="${c.items[s.field].length}">${c.items[s.field].map((_, x) => `<i x="${x}" s="1"/>`).join("")}</items></tabular></data>`;
    pivotCacheRefs.push(k);
  } else {
    const t = tables[s.table];
    body = `<extLst><x:ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}" xmlns:x15="${X15}"><x15:tableSlicerCache tableId="${t.id}" column="${t.cols.indexOf(s.field) + 1}"/></x:ext></extLst>`;
    tableCacheRefs.push(k);
  }
  zip.file(`xl/slicerCaches/slicerCache${k}.xml`, `${XML}<slicerCacheDefinition xmlns="${X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${s.name}" sourceName="${esc(s.field)}">${body}</slicerCacheDefinition>`);
  ct.push([`/xl/slicerCaches/slicerCache${k}.xml`, "application/vnd.ms-excel.slicerCache+xml"]);
  await addRel("xl/_rels/workbook.xml.rels", `rIdSc${k}`, "http://schemas.microsoft.com/office/2007/relationships/slicerCache", `slicerCaches/slicerCache${k}.xml`);
}
let slicerPartN = 0;
const sheetSlicerExt = {};
const sheetSlicerRels = {};
for (const n of ORDER) {
  const exts = [];
  for (const kind of ["pivot", "table"]) {
    const list = slicers.filter((s) => s.sheet === n && s.kind === kind);
    if (!list.length) continue;
    const pn = ++slicerPartN;
    zip.file(`xl/slicers/slicer${pn}.xml`, `${XML}<slicers xmlns="${X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x xr10" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10">${list.map((s) => `<slicer name="${s.name}" cache="${s.name}" caption="${esc(label(s.field))}" rowHeight="241300" style="SlicerStyleLight6"/>`).join("")}</slicers>`);
    ct.push([`/xl/slicers/slicer${pn}.xml`, "application/vnd.ms-excel.slicer+xml"]);
    (sheetSlicerRels[n] ??= []).push(pn);
    exts.push(kind === "pivot"
      ? `<ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="${X14}"><x14:slicerList><x14:slicer r:id="rIdSl${pn}"/></x14:slicerList></ext>`
      : `<ext uri="{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}" xmlns:x15="${X15}"><x14:slicerList xmlns:x14="${X14}"><x14:slicer r:id="rIdSl${pn}"/></x14:slicerList></ext>`);
  }
  if (exts.length) sheetSlicerExt[n] = `<extLst>${exts.join("")}</extLst>`;
}

// workbook.xml
let wbXml = baseWb;
if (!wbXml.includes("xmlns:r=")) wbXml = wbXml.replace("<workbook ", `<workbook xmlns:r="${REL.slice(0, -1)}" `);
wbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "");
const fdIdx = ORDER.indexOf("2025-Q1");
const names = [...slicers.map((s) => `<definedName name="${s.name}">#N/A</definedName>`), `<definedName name="_xlnm._FilterDatabase" localSheetId="${fdIdx}" hidden="1">'2025-Q1'!$A$1:$L$614989</definedName>`].join("");
wbXml = wbXml.replace("</sheets>", `</sheets><externalReferences><externalReference r:id="rIdExt1"/></externalReferences><definedNames>${names}</definedNames>`);
const pcXml = `<pivotCaches>${Object.values(caches).map((c) => `<pivotCache cacheId="${c.id}" r:id="rIdPc${c.id}"/>`).join("")}</pivotCaches>`;
const wbExt = `<extLst><ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="${X14}"><x14:slicerCaches>${pivotCacheRefs.map((k) => `<x14:slicerCache r:id="rIdSc${k}"/>`).join("")}</x14:slicerCaches></ext><ext uri="{46BE6895-7355-4a93-B00E-2C351335B9C9}" xmlns:x15="${X15}"><x15:slicerCaches xmlns:x14="${X14}">${tableCacheRefs.map((k) => `<x14:slicerCache r:id="rIdSc${k}"/>`).join("")}</x15:slicerCaches></ext></extLst>`;
wbXml = wbXml.replace(/<calcPr[^>]*\/>/, "").replace("</workbook>", `<calcPr calcId="191029"/>${pcXml}${wbExt}</workbook>`);
zip.file("xl/workbook.xml", wbXml);

// worksheets
const styleRows = (xml, n) => {
  const d = design[n];
  const byRow = new Map();
  for (const [ref, s] of d.cells) { const { r, c } = XLSX.utils.decode_cell(ref); if (!byRow.has(r)) byRow.set(r, new Map()); byRow.get(r).set(c, s); }
  const touched = new Set([...byRow.keys(), ...d.heights.keys()]);
  const rowAttrs = (r) => `r="${r + 1}"${d.heights.has(r) ? ` ht="${d.heights.get(r)}" customHeight="1"` : ""}`;
  const fixRow = (r, inner) => {
    const cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map((mm) => ({ c: XLSX.utils.decode_col(mm[1]), xml: mm[0] }));
    for (const [c, s] of byRow.get(r) ?? []) {
      const cell = cells.find((x) => x.c === c);
      if (cell) cell.xml = cell.xml.replace(/ s="\d+"/, "").replace(/^<c r="([A-Z]+\d+)"/, `<c r="$1" s="${s}"`);
      else cells.push({ c, xml: `<c r="${A1(r, c)}" s="${s}"/>` });
    }
    cells.sort((a, b) => a.c - b.c);
    return `<row ${rowAttrs(r)}>${cells.map((x) => x.xml).join("")}</row>`;
  };
  const sd = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/);
  const rows = [...(sd[1] ?? "").matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)].map((mm) => ({ r: Number(mm[1]) - 1, xml: touched.has(Number(mm[1]) - 1) ? fixRow(Number(mm[1]) - 1, mm[2] ?? "") : mm[0] }));
  const seen = new Set(rows.map((x) => x.r));
  for (const r of touched) if (!seen.has(r)) rows.push({ r, xml: fixRow(r, "") });
  rows.sort((a, b) => a.r - b.r);
  return xml.replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, `<sheetData>${rows.map((x) => x.xml).join("")}</sheetData>`);
};
const bigFile = (n) => (n === S.sample ? join(stageDir, "sample.xml") : join(stageDir, `pop-${POP_PARTS.indexOf(n) + 1}.xml`));
for (const [i, n] of ORDER.entries()) {
  if (RAWSET.has(n)) continue;
  const part = `xl/${sheetPart[n]}`;
  const rels = part.replace("worksheets/", "worksheets/_rels/") + ".rels";
  let xml = await base.file(part).async("string");
  if (!xml.includes("xmlns:r=")) xml = xml.replace("<worksheet ", `<worksheet xmlns:r="${REL.slice(0, -1)}" `);
  const d = design[n], sep = SEPS.has(n);
  xml = xml.replace(/<sheetPr[^>]*\/>|<sheetPr[^>]*>[\s\S]*?<\/sheetPr>/, "");
  xml = xml.replace(/(<worksheet [^>]*>)/, `$1<sheetPr><tabColor rgb="FF${sep ? T.black : n === S.index ? T.gold : STEPS.includes(n) ? T.blue : T.navy}"/></sheetPr>`);
  const pane = d.freeze ? `<pane ySplit="${d.freeze}" topLeftCell="A${d.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${d.freeze + 1}" sqref="A${d.freeze + 1}"/>` : "";
  const view = `<sheetViews><sheetView showGridLines="0"${sep ? ' showRowColHeaders="0"' : ""} rightToLeft="1"${i === 0 ? ' tabSelected="1"' : ""} workbookViewId="0">${pane}</sheetView></sheetViews>`;
  xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, "");
  xml = /<dimension [^>]*\/>/.test(xml) ? xml.replace(/(<dimension [^>]*\/>)/, `$1${view}`) : xml.replace(/(<\/sheetPr>)/, `$1${view}`);
  const bgStyle = sep ? X.BLACK : X.BG;
  const colXml = `<cols>${d.widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${(w ?? 14) + 0.7}" style="${bgStyle}" customWidth="1"/>`).join("")}<col min="${d.widths.length + 1}" max="16384" width="9.14" style="${bgStyle}"/></cols>`;
  xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, "").replace(/<sheetFormatPr[^>]*\/>/, "");
  xml = xml.replace(/(<sheetViews>[\s\S]*?<\/sheetViews>)/, `$1<sheetFormatPr defaultRowHeight="15"/>${colXml}`);
  if (sep) xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, "<sheetData/>").replace(/<dimension [^>]*\/>/, '<dimension ref="A1"/>');
  else xml = styleRows(xml, n);
  let tail = "";
  if (sheetDrawing[n]) { tail += `<drawing r:id="rIdDr"/>`; await addRel(rels, "rIdDr", "drawing", `../drawings/drawing${sheetDrawing[n]}.xml`); }
  const ts = sheetTables[n] ?? [];
  if (ts.length) { tail += `<tableParts count="${ts.length}">${ts.map((t) => `<tablePart r:id="rIdTbl${t.id}"/>`).join("")}</tableParts>`; for (const t of ts) await addRel(rels, `rIdTbl${t.id}`, "table", `../tables/table${t.id}.xml`); }
  tail += sheetSlicerExt[n] ?? "";
  for (const pn of sheetSlicerRels[n] ?? []) await addRel(rels, `rIdSl${pn}`, "http://schemas.microsoft.com/office/2007/relationships/slicer", `../slicers/slicer${pn}.xml`);
  for (const pn of sheetPivots[n] ?? []) await addRel(rels, `rIdPt${pn}`, "pivotTable", `../pivotTables/pivotTable${pn}.xml`);
  xml = xml.replace("</worksheet>", `${tail}</worksheet>`);
  if (BIG.has(n)) {
    const t = ts[0];
    xml = xml.replace(/<dimension [^>]*\/>/, `<dimension ref="A1:${A1(t.start[0] + t.n, Math.max(t.start[1] + t.cols.length + 20, 30))}"/>`);
    const [pre, post] = xml.split("</sheetData>");
    const file = bigFile(n);
    zip.file(part, Readable.from((async function* () { yield Buffer.from(pre); if (LITE) { let rows = 0, buf = ""; for await (const ch of createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 })) { buf += ch; let e; while ((e = buf.indexOf("</row>")) >= 0) { yield Buffer.from(buf.slice(0, e + 6)); buf = buf.slice(e + 6); if (++rows > LITE) return yield Buffer.from(`</sheetData>${post}`); } } } else for await (const ch of createReadStream(file, { highWaterMark: 1 << 22 })) yield ch; yield Buffer.from(`</sheetData>${post}`); })()));
  } else zip.file(part, xml);
}
// drop SheetJS's own placeholder parts for raw sheets
for (const r of RAW) zip.remove(`xl/${sheetPart[r.name]}`);

// content types
let ctXml = await base.file("[Content_Types].xml").async("string");
ctXml = ctXml.replace(/<Default Extension="bin"[^>]*\/>/, "").replace(/<Override PartName="\/xl\/metadata\.xml"[^>]*\/>/, "");
ctXml = ctXml.replace(/<Override PartName="\/xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|styles\.xml|theme\/theme1\.xml)"[^>]*\/>/g, (all, p) => (p.startsWith("worksheets/") && RAW.some((r) => sheetPart[r.name] === p) ? "" : p.startsWith("worksheets/") ? all : ""));
const ov = (p, t) => `<Override PartName="${p}" ContentType="${t}"/>`;
const extra = [
  ov("/xl/sharedStrings.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"),
  ov("/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
  ov("/xl/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
  ov("/xl/externalLinks/externalLink1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"),
  ...RAW.map((r) => ov(`/xl/${r.newPart}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")),
  ...Object.keys(zip.files).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p) && Number(p.match(/(\d+)\.xml$/)[1]) < 100).map((p) => ov(`/${p}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml")),
  ...ct.map(([p, t]) => ov(p, t)),
];
ctXml = ctXml.replace("<Override", '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/><Override');
if (!ctXml.includes('Extension="png"')) ctXml = ctXml.replace("<Override", '<Default Extension="png" ContentType="image/png"/><Override');
ctXml = ctXml.replace("</Types>", `${extra.join("")}</Types>`);
zip.file("[Content_Types].xml", ctXml);

writeFileSync(join(out, "expect.json"), JSON.stringify({ order: ORDER, raw: RAW.map((r) => r.name), steps: STEPS, popParts: POP_PARTS, perSheet: stage.perSheet, study: { dataRows: stage.study.dataRows, kept: stage.study.kept, dropped: stage.study.dropped.length }, popKept: stage.check.keptPop, tables: Object.fromEntries(Object.values(tables).map((t) => [t.table, { sheet: t.sheet, rows: t.n, cols: t.cols.length }])) }));


// M15 self-check: no visible name may look like an internal id or a numbered step.
{
  const ID_PATTERNS = [/^[a-z]{1,3}\d+$/i, /\b[a-z]+(?:_[a-z0-9]+)+\b/i, /\b[a-z]+[A-Z][A-Za-z0-9]*\b/, /\btbl/i, /خطوة\s*\d/, /\b(?:pivot|Slicer|Chart|Button)\s*_?\d*\b/i];
  const rawHeaders = new Set([...studyTableCols, ...stage.popCols.slice(0, stage.popCols.length - 7)]);
  const visible = [
    ...ORDER.map((v) => ['ورقة', v]),
    ...Object.values(tables).map((t) => ['جدول', t.table]),
    ...Object.values(tables).flatMap((t) => t.cols.filter((h) => !rawHeaders.has(h)).map((h) => ['عمود', h])),
    ...pivots.flatMap((p) => [['جدول محوري', p.name], ...p.data.map((d) => ['مقياس', d[2]])]),
    ...slicers.flatMap((s) => [['مقسم', s.name], ['عنوان مقسم', label(s.field)]]),
    ...buttonsMeta.map((b) => ['زر', b.text]),
    ...visibleTexts.map((v) => ['نص', v]),
  ];
  const bad = visible.filter(([, v]) => ID_PATTERNS.some((re) => re.test(String(v))));
  writeFileSync(join(out, 'names-check.json'), JSON.stringify({ checked: visible.length, bad }));
  if (bad.length) throw new Error(`M15 name check failed: ${bad.map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
  console.log(`M15 name check: ${visible.length} visible names, 0 id-like`);
}

// write (stream; raw sheets reuse their compressed bytes)
const outPath = join(out, process.env.T8_OUT ?? "report.xlsx");
await new Promise((res, rej) => zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }).pipe(createWriteStream(outPath)).on("finish", res).on("error", rej));
console.log(`${outPath} ${(statSync(outPath).size / 1048576).toFixed(1)} MB; ${ORDER.length} sheets, ${pivots.length} pivots, ${chartN} charts, ${slicers.length} slicers, ${buttonsMeta.length} shape buttons, ${figures.length} figures; sheetjs ${tSheet - t0} ms, package ${Date.now() - tSheet} ms`);
