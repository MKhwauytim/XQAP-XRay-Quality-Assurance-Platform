// T8 step 2 (designed workbook): SheetJS writes the cells, then a JSZip post-process adds
// what the community build cannot write: styles (deck3 palette, Somar), Excel tables,
// pivot caches and pivot tables, drawings (logo, native charts), slicers (pivot and table),
// RTL views, frozen panes, separator sheets.
//
// Inputs (read only): out/rows.json (extract.mjs), ../port-pptx/out/model.json and
// ../port-pptx/out/geometry.json (the deck's own logo image).
// Output: out/report.xlsx, out/figures.json, out/charts.json (for verify.ps1).
//
// RTL placement: column A is drawn at the right edge. On data sheets A is a margin, the
// table sits at B:G, then a spacer, the pivot at I, the slicers at M:O and the chart at
// Q:Y, so reading right to left: table, pivot, slicers, chart.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const t0 = Date.now();
const { population, studies } = JSON.parse(readFileSync(join(out, "rows.json"), "utf8"));
const { m } = JSON.parse(readFileSync(join(here, "..", "port-pptx", "out", "model.json"), "utf8"));
const geometry = JSON.parse(readFileSync(join(here, "..", "port-pptx", "out", "geometry.json"), "utf8"));
const LOGO = Buffer.from(geometry[0].images[0].src.split(",")[1], "base64"); // 1075 x 240, white, the deck cover logo
const SEL = m.port;
const ISSUED = process.env.T8_DATE ?? "2026-11-05";

// deck3 tokens (src/data/reporting/executive/deck3/theme.ts), values only
const T = { bg: "F9F8F5", panel: "F2F0EA", navy: "10304F", text: "22303E", muted: "5D6B7A", hair: "E3E0D8", gold: "B48A3C", goldLight: "C9A45E", blue: "3F6FA8", green: "2E7D4F", track: "ECEAE3", white: "FFFFFF", black: "000000" };
const FONT = "Somar";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => XLSX.utils.encode_col(i);
const A1 = (r, c) => `${col(c)}${r + 1}`; // 0-based
const abs = (sheet, r1, c, r2) => `'${sheet}'!$${col(c)}$${r1 + 1}:$${col(c)}$${r2 + 1}`;

// ---------- styles (cellXfs ids) ----------
const X = { DEF: 0, BG: 1, BAND: 2, BAND_TITLE: 3, BAND_SUB: 4, BUTTON: 5, BACK: 6, SECTION: 7, NOTE: 8, BLACK: 9, KPI_LABEL: 10, KPI_VALUE: 11, KPI_PCT: 12, COVER_TITLE: 13, BODY_NUM: 14, BODY_PCT: 15, DESC: 16 };
const stylesXml = () => {
  const font = (sz, color, b) => `<font>${b ? "<b/>" : ""}<sz val="${sz}"/><color rgb="FF${color}"/><name val="${FONT}"/><family val="2"/></font>`;
  const fonts = [font(10, T.text), font(18, T.white, 1), font(11, T.goldLight), font(11, T.navy, 1), font(10, T.muted), font(11, T.white, 1), font(20, T.navy, 1), font(24, T.white, 1)];
  const solid = (c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', solid(T.bg), solid(T.navy), solid(T.panel), solid(T.gold), solid(T.black)];
  const box = (c) => `<border><left style="thin"><color rgb="FF${c}"/></left><right style="thin"><color rgb="FF${c}"/></right><top style="thin"><color rgb="FF${c}"/></top><bottom style="thin"><color rgb="FF${c}"/></bottom><diagonal/></border>`;
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>", box(T.goldLight), box(T.hair)];
  const al = (h, wrap) => `<alignment${h ? ` horizontal="${h}"` : ""} vertical="center"${wrap ? ' wrapText="1"' : ""} readingOrder="2"/>`;
  const xf = (font, fill, border, numFmt, align) => `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${border ? ' applyBorder="1"' : ""}${numFmt ? ' applyNumberFormat="1"' : ""}${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`;
  const xfs = [xf(0, 0, 0, 0), xf(0, 2, 0, 0), xf(0, 3, 0, 0), xf(1, 3, 0, 0, al()), xf(2, 3, 0, 0, al()), xf(3, 4, 1, 0, al("center")), xf(5, 5, 0, 0, al("center")), xf(3, 2, 0, 0, al()), xf(4, 2, 0, 0, al()), xf(0, 6, 0, 0), xf(4, 4, 2, 0, al("center")), xf(6, 4, 2, 3, al("center")), xf(6, 4, 2, 10, al("center")), xf(7, 3, 0, 0, al()), xf(0, 0, 0, 3), xf(0, 0, 0, 10), xf(0, 2, 0, 0, al(null, 1))];
  const dfill = (c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor rgb="FF${c}"/></patternFill></fill>`;
  const dxfs = [
    `<dxf><font><color rgb="FF${T.text}"/></font><border><bottom style="thin"><color rgb="FF${T.hair}"/></bottom><horizontal style="thin"><color rgb="FF${T.hair}"/></horizontal></border></dxf>`,
    `<dxf><font><b/><color rgb="FF${T.white}"/></font>${dfill(T.navy)}</dxf>`,
    `<dxf>${dfill(T.panel)}</dxf>`,
    `<dxf><font><b/><color rgb="FF${T.navy}"/></font>${dfill(T.track)}<border><top style="thin"><color rgb="FF${T.gold}"/></top></border></dxf>`,
    `<dxf><font><b/><color rgb="FF${T.navy}"/></font></dxf>`,
  ];
  const tStyle = `<tableStyles count="1" defaultTableStyle="Deck3" defaultPivotStyle="Deck3"><tableStyle name="Deck3" count="6"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="1"/><tableStyleElement type="totalRow" dxfId="3"/><tableStyleElement type="firstRowStripe" dxfId="2"/><tableStyleElement type="pageFieldLabels" dxfId="4"/><tableStyleElement type="pageFieldValues" dxfId="4"/></tableStyle></tableStyles>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00%"/></numFmts><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>${tStyle}</styleSheet>`;
};

// ---------- sheet plan ----------
const S = { index: "الفهرس", sep1: "|", pop: "المجتمع", sample: "العينة", sep2: "||", stats: "الإحصائيات", sep3: "|||", source: "المصدر" };
const ORDER = [S.index, S.sep1, S.pop, S.sample, S.sep2, S.stats, S.sep3, S.source];
const sheetId = (n) => ORDER.indexOf(n) + 1;
const SEPS = new Set([S.sep1, S.sep2, S.sep3]);

const popCols = ["المنفذ", "نوع المنفذ", "المجموعة", "السنة", "الشهر", "عدد الصور"];
const smpCols = ["المنفذ", "المجموعة", "السنة", "الشهر", "حالة الصورة", "التوائم"];
const TABLE_ROW = 8; // 0-based row of the table header on data sheets (row 9)
const caches = {
  pop: { id: 1, table: "tblPopulation", cols: popCols, rows: population.map((r) => [r.port, r.type, r.group, r.year, r.month, r.images]), sheet: S.pop },
  smp: { id: 2, table: "tblSample", cols: smpCols, rows: studies.map((r) => [r.port, r.group, r.year ?? "", r.month, r.status, r.match]), sheet: S.sample },
};

const slide = {
  popSample: "المجتمع والعينة المدروسة في ميناء جدة الإسلامي",
  results: "نتائج دراسة صور ميناء جدة الإسلامي",
  compare: "نسبة التوائم: ميناء جدة الإسلامي مقابل جميع المنافذ",
  timeline: "الخط الزمني لنسبة التوائم في ميناء جدة الإسلامي",
};
// Stats grid: 2 blocks per row, 3 rows. Block = pivot (3 cols) + gap + chart (5 cols) + gutter.
const BLOCK = { cols: [1, 11], rows: [7, 26, 45] };
const pivots = [
  { sheet: S.pop, at: [TABLE_ROW, 8], cache: "pop", rows: "المنفذ", data: [["عدد الصور", "sum", "مجموع الصور", 3]], title: "مجموع الصور لكل منفذ", chart: { dataIx: 0, kind: "bar", fmt: "#,##0", color: T.navy, at: [TABLE_ROW, 16, TABLE_ROW + 26, 25] } },
  { sheet: S.sample, at: [TABLE_ROW, 8], cache: "smp", rows: "المنفذ", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], title: "الدراسات ونسبة التوائم لكل منفذ", chart: { dataIx: 1, kind: "bar", fmt: "0.0%", color: T.gold, at: [TABLE_ROW, 16, TABLE_ROW + 26, 25] } },
  { sheet: S.stats, block: [0, 0], cache: "pop", rows: "المجموعة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "المجتمع حسب المجموعة", chart: { dataIx: 0, kind: "col", fmt: "#,##0", color: T.navy } },
  { sheet: S.stats, block: [0, 1], cache: "pop", page: ["المنفذ", SEL], rows: "السنة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "مجتمع الميناء حسب السنة", chart: { dataIx: 0, kind: "col", fmt: "#,##0", color: T.blue } },
  { sheet: S.stats, block: [1, 0], cache: "smp", page: ["المنفذ", SEL], rows: "حالة الصورة", data: [["حالة الصورة", "count", "عدد الدراسات", 3]], feeds: slide.results, title: "نتائج دراسة صور الميناء", chart: { dataIx: 0, kind: "bar", fmt: "#,##0", color: T.navy } },
  { sheet: S.stats, block: [1, 1], cache: "smp", rows: "المجموعة", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], feeds: slide.compare, title: "نسبة التوائم حسب المجموعة", chart: { dataIx: 1, kind: "col", fmt: "0.0%", color: T.gold } },
  { sheet: S.stats, block: [2, 0], cache: "smp", page: ["المنفذ", SEL], rows: "السنة", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], feeds: slide.timeline, title: "عينة الميناء ونسبة التوائم حسب السنة", chart: { dataIx: 1, kind: "col", fmt: "0.0%", color: T.green } },
];
for (const p of pivots) if (p.block) {
  const t = BLOCK.rows[p.block[0]], c = BLOCK.cols[p.block[1]];
  p.titleAt = [t, c];
  p.at = [t + 3, c];
  p.chart.at = [t, c + 4, t + 17, c + 9];
}
// slicers: pivot slicers (x14) and table slicers (x15)
const slicers = [
  { name: "Slicer_PopGroup", kind: "pivot", sheet: S.pop, cache: "pop", field: "المجموعة", pivots: [1], at: [TABLE_ROW, 12, TABLE_ROW + 11, 15] },
  { name: "Slicer_PopYear", kind: "table", sheet: S.pop, cache: "pop", field: "السنة", at: [TABLE_ROW + 13, 12, TABLE_ROW + 22, 15] },
  { name: "Slicer_SmpGroup", kind: "pivot", sheet: S.sample, cache: "smp", field: "المجموعة", pivots: [2], at: [TABLE_ROW, 12, TABLE_ROW + 11, 15] },
  { name: "Slicer_SmpYear", kind: "table", sheet: S.sample, cache: "smp", field: "السنة", at: [TABLE_ROW + 13, 12, TABLE_ROW + 22, 15] },
  { name: "Slicer_StatsYear", kind: "pivot", sheet: S.stats, cache: "smp", field: "السنة", pivots: [5, 7], at: [BLOCK.rows[2] + 3, BLOCK.cols[1], BLOCK.rows[2] + 13, BLOCK.cols[1] + 3] },
];

// bisect switches: T8_SLICERS=none|pivot|table|all (default all)
const SL = process.env.T8_SLICERS ?? "all";
for (let i = slicers.length - 1; i >= 0; i--) if (SL === "none" || (SL !== "all" && slicers[i].kind !== SL)) slicers.splice(i, 1);

// ---------- figures (المصدر + verification) ----------
const g = (label) => m.groups.find((x) => x.label === label);
const y = (yr) => m.years.find((x) => x.year === yr);
const figures = [
  ["مجتمع جميع المنافذ", m.allPorts.population, "pivot1", "مجموع الصور", [], S.pop, "عدد الصور", "بدون", "مجموع"],
  ["مجتمع ميناء جدة الإسلامي", m.selected.population, "pivot1", "مجموع الصور", ["المنفذ", SEL], S.pop, "عدد الصور", `المنفذ = ${SEL}`, "مجموع"],
  ["مجتمع المنافذ البرية", g("منفذ بري").population, "pivot3", "مجموع الصور", ["المجموعة", "منفذ بري"], S.pop, "عدد الصور", "المجموعة = منفذ بري", "مجموع"],
  ["مجتمع المنافذ البحرية", g("منفذ بحري").population, "pivot3", "مجموع الصور", ["المجموعة", "منفذ بحري"], S.pop, "عدد الصور", "المجموعة = منفذ بحري", "مجموع"],
  ["عينة جميع المنافذ", m.allPorts.image.studied, "pivot2", "عدد الدراسات", [], S.sample, "حالة الصورة", "بدون", "عدد"],
  ["عينة ميناء جدة الإسلامي", m.selected.image.studied, "pivot2", "عدد الدراسات", ["المنفذ", SEL], S.sample, "حالة الصورة", `المنفذ = ${SEL}`, "عدد"],
  ["نسبة توائم ميناء جدة الإسلامي", m.selected.image.accuracy, "pivot2", "نسبة التوائم", ["المنفذ", SEL], S.sample, "التوائم", `المنفذ = ${SEL}`, "متوسط"],
  ["نسبة توائم جميع المنافذ", m.allPorts.image.accuracy, "pivot2", "نسبة التوائم", [], S.sample, "التوائم", "بدون", "متوسط"],
  ["اشتباه صحيح في الميناء", m.selected.image.trueSuspicion, "pivot5", "عدد الدراسات", ["حالة الصورة", "اشتباه صحيح"], S.sample, "حالة الصورة", `المنفذ = ${SEL}، الحالة = اشتباه صحيح`, "عدد"],
  ["اشتباه خاطئ في الميناء", m.selected.image.falseSuspicion, "pivot5", "عدد الدراسات", ["حالة الصورة", "اشتباه خاطئ"], S.sample, "حالة الصورة", `المنفذ = ${SEL}، الحالة = اشتباه خاطئ`, "عدد"],
  ["اشتباه فائت في الميناء", m.selected.image.missed, "pivot5", "عدد الدراسات", ["حالة الصورة", "اشتباه فائت"], S.sample, "حالة الصورة", `المنفذ = ${SEL}، الحالة = اشتباه فائت`, "عدد"],
  ["سليمة صحيحة في الميناء", m.selected.image.trueClear, "pivot5", "عدد الدراسات", ["حالة الصورة", "سليمة صحيحة"], S.sample, "حالة الصورة", `المنفذ = ${SEL}، الحالة = سليمة صحيحة`, "عدد"],
  ["نسبة توائم المنافذ البرية", g("منفذ بري").image.accuracy, "pivot6", "نسبة التوائم", ["المجموعة", "منفذ بري"], S.sample, "التوائم", "المجموعة = منفذ بري", "متوسط"],
  ["نسبة توائم المنافذ البحرية", g("منفذ بحري").image.accuracy, "pivot6", "نسبة التوائم", ["المجموعة", "منفذ بحري"], S.sample, "التوائم", "المجموعة = منفذ بحري", "متوسط"],
  ...[2024, 2025, 2026].flatMap((yr) => [
    [`مجتمع الميناء ${yr}`, y(yr).population, "pivot4", "مجموع الصور", ["السنة", yr], S.pop, "عدد الصور", `المنفذ = ${SEL}، السنة = ${yr}`, "مجموع"],
    [`عينة الميناء ${yr}`, y(yr).image.studied, "pivot7", "عدد الدراسات", ["السنة", yr], S.sample, "حالة الصورة", `المنفذ = ${SEL}، السنة = ${yr}`, "عدد"],
    [`نسبة توائم الميناء ${yr}`, y(yr).image.accuracy, "pivot7", "نسبة التوائم", ["السنة", yr], S.sample, "التوائم", `المنفذ = ${SEL}، السنة = ${yr}`, "متوسط"],
  ]),
];
writeFileSync(join(out, "figures.json"), JSON.stringify(figures.map(([label, value, pivot, dataField, filter]) => ({ label, value, pivot, dataField, filter }))));

// ---------- per-sheet design state ----------
const design = Object.fromEntries(ORDER.map((n) => [n, { cells: new Map(), heights: new Map(), widths: [], maxCol: 26, freeze: null, links: [], merges: [] }]));
const put = (sheet, r, c, s) => design[sheet].cells.set(A1(r, c), s);
const rect = (sheet, r1, c1, r2, c2, s) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) put(sheet, r, c, s); };

// ---------- SheetJS workbook ----------
const wb = XLSX.utils.book_new();
const sheets = {};
const text = (ws, r, c, v) => XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: { r, c } });
const band = (ws, name, title, sub, lastCol, titleStyle = X.BAND_TITLE, tc = 2) => {
  const d = design[name];
  d.heights.set(0, 8).set(1, 34).set(2, 22).set(3, 8).set(4, 10).set(5, 24).set(6, 10);
  rect(name, 0, 0, 3, lastCol, X.BAND);
  text(ws, 1, tc, title); put(name, 1, tc, titleStyle); d.merges.push({ s: { r: 1, c: tc }, e: { r: 1, c: Math.min(lastCol, 12) } });
  text(ws, 2, tc, sub); put(name, 2, tc, X.BAND_SUB); d.merges.push({ s: { r: 2, c: tc }, e: { r: 2, c: Math.min(lastCol, 12) } });
};
const back = (ws, name) => {
  text(ws, 5, 1, "العودة إلى الفهرس"); put(name, 5, 1, X.BACK);
  ws[A1(5, 1)].l = { Target: `#'${S.index}'!A1`, Tooltip: "العودة إلى الفهرس" };
};

// cover
{
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const n = S.index, d = design[n];
  band(ws, n, `تقرير أعمال ${m.displayName}`, `مصنف بيانات التقرير  |  ${m.periodLabel}`, 10, X.COVER_TITLE, 3);
  d.heights.set(1, 44);
  d.widths = [3, 16, 16, 16, 16, 16, 16, 16, 16, 3, 3];
  text(ws, 5, 1, `تاريخ الإصدار: ${ISSUED}`); put(n, 5, 1, X.NOTE); d.merges.push({ s: { r: 5, c: 1 }, e: { r: 5, c: 4 } });
  text(ws, 7, 1, "حقائق التقرير الأساسية"); put(n, 7, 1, X.SECTION); d.heights.set(7, 24);
  const kpis = [["مجتمع الميناء (صورة)", m.selected.population, X.KPI_VALUE], ["العينة المدروسة (صورة)", m.selected.image.studied, X.KPI_VALUE], ["نسبة التوائم", m.selected.image.accuracy, X.KPI_PCT], ["مجتمع جميع المنافذ (صورة)", m.allPorts.population, X.KPI_VALUE]];
  kpis.forEach(([label, v, s], i) => {
    const c = 1 + i * 2;
    text(ws, 8, c, label); rect(n, 8, c, 8, c + 1, X.KPI_LABEL); d.merges.push({ s: { r: 8, c }, e: { r: 8, c: c + 1 } });
    text(ws, 9, c, v); rect(n, 9, c, 9, c + 1, s); d.merges.push({ s: { r: 9, c }, e: { r: 9, c: c + 1 } });
  });
  d.heights.set(8, 24).set(9, 40).set(10, 14);
  text(ws, 11, 1, "أجزاء المصنف"); put(n, 11, 1, X.SECTION); d.heights.set(11, 24);
  const nav = [
    [S.pop, "المجتمع الكامل: صف لكل منفذ وشهر بعدد الصور الواردة، مع جدول محوري ورسم ومقسمات"],
    [S.sample, "العينة المدروسة: صف لكل صورة مدروسة بحالتها والتوائم، مع جدول محوري ورسم ومقسمات"],
    [S.stats, "حسابات التقرير جداول محورية في شبكة، بجانب كل جدول رسمه والشريحة التي يغذيها"],
    [S.source, "مصدر كل رقم في التقرير: الورقة والحقل والتصفية والمقياس والجدول المحوري"],
  ];
  nav.forEach(([sheet, desc], i) => {
    const r = 12 + i * 2;
    text(ws, r, 1, sheet); rect(n, r, 1, r, 2, X.BUTTON); d.merges.push({ s: { r, c: 1 }, e: { r, c: 2 } });
    ws[A1(r, 1)].l = { Target: `#'${sheet}'!A1`, Tooltip: `الانتقال إلى ${sheet}` };
    text(ws, r, 3, desc); put(n, r, 3, X.DESC); d.merges.push({ s: { r, c: 3 }, e: { r, c: 8 } });
    d.heights.set(r, 30).set(r + 1, 8);
  });
  ws["!ref"] = "A1:K20";
  sheets[n] = ws;
}
for (const n of [S.sep1, S.sep2, S.sep3]) sheets[n] = XLSX.utils.aoa_to_sheet([]);

// data sheets
for (const c of [caches.pop, caches.smp]) {
  const n = c.sheet, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(ws, [c.cols, ...c.rows], { origin: { r: TABLE_ROW, c: 1 } });
  c.ref = `B${TABLE_ROW + 1}:${col(c.cols.length)}${TABLE_ROW + 1 + c.rows.length}`;
  band(ws, n, n === S.pop ? "المجتمع الكامل" : "العينة المدروسة", n === S.pop ? `${population.length.toLocaleString("en-US")} صف: منفذ وشهر وعدد الصور الواردة` : `${studies.length.toLocaleString("en-US")} صف: صورة مدروسة وحالتها والتوائم`, 25);
  back(ws, n);
  d.widths = n === S.pop ? [3, 26, 13, 13, 8, 10, 12, 3, 26, 14, 14, 3, 11, 11, 11, 3] : [3, 26, 13, 8, 10, 13, 9, 3, 26, 14, 14, 3, 11, 11, 11, 3];
  d.widths.push(...Array(10).fill(10));
  d.freeze = TABLE_ROW + 1;
  d.heights.set(TABLE_ROW - 1, 22);
  text(ws, TABLE_ROW - 1, 1, "جدول البيانات"); put(n, TABLE_ROW - 1, 1, X.SECTION);
  text(ws, TABLE_ROW - 1, 12, "المقسمات"); put(n, TABLE_ROW - 1, 12, X.SECTION);
  text(ws, TABLE_ROW - 1, 16, "الرسم"); put(n, TABLE_ROW - 1, 16, X.SECTION);
  if (n === S.pop) for (let i = 0; i < c.rows.length; i++) put(n, TABLE_ROW + 1 + i, 6, X.BODY_NUM);
  sheets[n] = ws;
}
for (const p of pivots.filter((p) => p.sheet !== S.stats)) { text(sheets[p.sheet], TABLE_ROW - 1, p.at[1], p.title); put(p.sheet, TABLE_ROW - 1, p.at[1], X.SECTION); }

// stats
{
  const n = S.stats, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  band(ws, n, "الإحصائيات", "كل حسابات التقرير جداول محورية، بجانب كل جدول رسمه والشريحة التي يغذيها", 21, X.BAND_TITLE, 3);
  back(ws, n);
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
  ws["!ref"] = "A1:V64";
  sheets[n] = ws;
}

// source
{
  const n = S.source, d = design[n];
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const head = ["الرقم", "القيمة في التقرير", "الورقة", "الحقل", "التصفية", "المقياس", "الجدول المحوري"];
  XLSX.utils.sheet_add_aoa(ws, [head, ...figures.map(([label, value, pivot, , , sheet, field, filter, measure]) => [label, value, sheet, field, filter, measure, pivot])], { origin: { r: TABLE_ROW, c: 1 } });
  band(ws, n, "مصدر الأرقام", "كل رقم في التقرير، والورقة والحقل والتصفية والمقياس التي يأتي منها", 9);
  back(ws, n);
  d.widths = [3, 30, 16, 12, 14, 48, 10, 14, 3];
  d.freeze = TABLE_ROW + 1;
  figures.forEach((f, i) => put(n, TABLE_ROW + 1 + i, 2, typeof f[1] === "number" && !Number.isInteger(f[1]) ? X.BODY_PCT : X.BODY_NUM));
  text(ws, TABLE_ROW - 1, 1, "الأرقام ومصادرها"); put(n, TABLE_ROW - 1, 1, X.SECTION);
  caches.src = { table: "tblSource", cols: head, sheet: n, ref: `B${TABLE_ROW + 1}:H${TABLE_ROW + 1 + figures.length}`, noPivot: true };
  sheets[n] = ws;
}

for (const n of ORDER) {
  const ws = sheets[n];
  if (design[n].merges.length) ws["!merges"] = design[n].merges;
  XLSX.utils.book_append_sheet(wb, ws, n);
}
const base = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
const tSheet = Date.now();

// ---------- post-process ----------
const zip = await JSZip.loadAsync(base);
const ct = [];
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const addRel = async (path, id, type, target) => {
  const f = zip.file(path);
  const xml = f ? await f.async("string") : `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(path, xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type.startsWith("http") ? type : REL + type}" Target="${target}"/></Relationships>`));
};
zip.file("xl/styles.xml", stylesXml());
zip.file("xl/media/logo.png", LOGO);

// tables
let tableN = 0;
for (const c of Object.values(caches)) {
  c.tableN = ++tableN;
  const cols = c.cols.map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`).join("");
  zip.file(`xl/tables/table${c.tableN}.xml`, `${XML}<table ${NS} id="${c.tableN}" name="${c.table}" displayName="${c.table}" ref="${c.ref}" totalsRowShown="0"><autoFilter ref="${c.ref}"/><tableColumns count="${c.cols.length}">${cols}</tableColumns><tableStyleInfo name="Deck3" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`);
  ct.push([`/xl/tables/table${c.tableN}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"]);
}

// pivot caches (saveData="0" + refreshOnLoad="1": no records part, Excel builds the cache on open)
const pivotCaches = Object.entries(caches).filter(([, c]) => !c.noPivot);
for (const [key, c] of pivotCaches) {
  const axes = new Set([...pivots.filter((p) => p.cache === key).flatMap((p) => [p.rows, p.page?.[0]].filter(Boolean)), ...slicers.filter((s) => s.cache === key && s.kind === "pivot").map((s) => s.field)]);
  c.items = {};
  const fields = c.cols.map((h, i) => {
    const vals = c.rows.map((r) => r[i]);
    const nums = vals.filter((v) => typeof v === "number");
    const hasBlank = vals.some((v) => v === "" || v === null);
    const allNum = nums.length > 0 && nums.length === vals.filter((v) => v !== "" && v !== null).length;
    const numAttrs = allNum ? ` containsSemiMixedTypes="0" containsString="0" containsNumber="1"${nums.every(Number.isInteger) ? ' containsInteger="1"' : ""} minValue="${nums.reduce((a, b) => Math.min(a, b))}" maxValue="${nums.reduce((a, b) => Math.max(a, b))}"${hasBlank ? ' containsBlank="1"' : ""}` : hasBlank ? ' containsBlank="1"' : "";
    if (!axes.has(h)) return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${numAttrs}/></cacheField>`;
    const uniq = [...new Set(vals.map((v) => (v === null ? "" : v)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    c.items[h] = uniq;
    const items = uniq.map((v) => (v === "" ? "<m/>" : typeof v === "number" ? `<n v="${v}"/>` : `<s v="${esc(v)}"/>`)).join("");
    return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${numAttrs} count="${uniq.length}">${items}</sharedItems></cacheField>`;
  });
  zip.file(`xl/pivotCache/pivotCacheDefinition${c.id}.xml`, `${XML}<pivotCacheDefinition ${NS} saveData="0" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="0"><cacheSource type="worksheet"><worksheetSource name="${c.table}"/></cacheSource><cacheFields count="${fields.length}">${fields.join("")}</cacheFields><extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotCacheDefinition pivotCacheId="${c.id}"/></ext></extLst></pivotCacheDefinition>`);
  ct.push([`/xl/pivotCache/pivotCacheDefinition${c.id}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"]);
  await addRel("xl/_rels/workbook.xml.rels", `rIdPc${c.id}`, "pivotCacheDefinition", `pivotCache/pivotCacheDefinition${c.id}.xml`);
}

// expected pivot output (for chart caches): same aggregation the pivot does
const aggregate = (p) => {
  const c = caches[p.cache];
  const fi = (h) => c.cols.indexOf(h);
  const rowsIn = p.page ? c.rows.filter((r) => r[fi(p.page[0])] === p.page[1]) : c.rows;
  return c.items[p.rows].map((item) => {
    const rs = rowsIn.filter((r) => r[fi(p.rows)] === item);
    return p.data.map(([f, sub]) => (sub === "sum" ? rs.reduce((s, r) => s + r[fi(f)], 0) : sub === "count" ? rs.length : rs.reduce((s, r) => s + r[fi(f)], 0) / rs.length));
  });
};

// pivot tables
const sheetPivots = {};
pivots.forEach((p, i) => {
  const n = i + 1;
  p.name = `pivot${n}`;
  const c = caches[p.cache];
  const fIdx = (h) => c.cols.indexOf(h);
  const rowItems = c.items[p.rows];
  const dataSet = new Set(p.data.map((d) => d[0]));
  const slicerFields = new Set(slicers.filter((s) => s.kind === "pivot" && s.pivots.includes(n)).map((s) => s.field));
  const pf = c.cols.map((h) => {
    const dataAttr = dataSet.has(h) ? ' dataField="1"' : "";
    const axis = h === p.rows ? ' axis="axisRow"' : h === p.page?.[0] ? ' axis="axisPage"' : "";
    if (!axis && !slicerFields.has(h)) return `<pivotField${dataAttr} showAll="0"/>`;
    const its = c.items[h].map((_, k) => `<item x="${k}"/>`).join("");
    return `<pivotField${axis}${dataAttr} showAll="0"><items count="${c.items[h].length + 1}">${its}<item t="default"/></items></pivotField>`;
  }).join("");
  const r0 = p.page ? p.at[0] + 2 : p.at[0];
  const c0 = p.at[1];
  const nd = p.data.length;
  const first = r0 + (nd > 1 ? 2 : 1); // 0-based row of the first item
  p.out = { labelCol: c0, first, last: first + rowItems.length - 1, valueCol: (k) => c0 + 1 + k };
  const ref = `${A1(r0, c0)}:${A1(first + rowItems.length, c0 + nd)}`;
  const loc = `<location ref="${ref}" firstHeaderRow="${nd > 1 ? 1 : 1}" firstDataRow="${nd > 1 ? 2 : 1}" firstDataCol="1"${p.page ? ' rowPageCount="1" colPageCount="1"' : ""}/>`;
  const ri = `<rowItems count="${rowItems.length + 1}">${rowItems.map((_, k) => (k ? `<i><x v="${k}"/></i>` : "<i><x/></i>")).join("")}<i t="grand"><x/></i></rowItems>`;
  const cf = nd > 1 ? `<colFields count="1"><field x="-2"/></colFields><colItems count="${nd}">${p.data.map((_, k) => (k ? `<i i="${k}"><x v="${k}"/></i>` : "<i><x/></i>")).join("")}</colItems>` : `<colItems count="1"><i/></colItems>`;
  const pg = p.page ? `<pageFields count="1"><pageField fld="${fIdx(p.page[0])}" item="${c.items[p.page[0]].indexOf(p.page[1])}" hier="-1"/></pageFields>` : "";
  const df = `<dataFields count="${nd}">${p.data.map(([f, sub, name, fmt]) => `<dataField name="${esc(name)}" fld="${fIdx(f)}"${sub === "sum" ? "" : ` subtotal="${sub}"`} baseField="0" baseItem="0" numFmtId="${fmt}"/>`).join("")}</dataFields>`;
  zip.file(`xl/pivotTables/pivotTable${n}.xml`, `${XML}<pivotTableDefinition ${NS} name="${p.name}" cacheId="${c.id}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0" dataCaption="القيم" grandTotalCaption="الإجمالي" rowHeaderCaption="${esc(p.rows)}" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">${loc}<pivotFields count="${c.cols.length}">${pf}</pivotFields><rowFields count="1"><field x="${fIdx(p.rows)}"/></rowFields>${ri}${cf}${pg}${df}<pivotTableStyleInfo name="Deck3" showRowHeaders="1" showColHeaders="1" showRowStripes="1" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`);
  ct.push([`/xl/pivotTables/pivotTable${n}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"]);
  zip.file(`xl/pivotTables/_rels/pivotTable${n}.xml.rels`, `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${c.id}.xml"/></Relationships>`);
  (sheetPivots[p.sheet] ??= []).push(n);
});

// charts, bound to the pivot output cells, caches filled with the same aggregation
const rpr = (sz, color, b) => `<a:defRPr sz="${sz}"${b ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr>`;
const txPr = (sz, color, b) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${rpr(sz, color, b)}</a:pPr><a:endParaRPr lang="ar-SA"/></a:p></c:txPr>`;
const chartsMeta = [];
const chartXml = (p, cats, vals) => {
  const ch = p.chart, name = p.data[ch.dataIx][2];
  const catF = abs(p.sheet, p.out.first, p.out.labelCol, p.out.last), valF = abs(p.sheet, p.out.first, p.out.valueCol(ch.dataIx), p.out.last);
  const strCache = `<c:strCache><c:ptCount val="${cats.length}"/>${cats.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache>`;
  const isBar = ch.kind === "bar";
  const noLine = `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>`;
  return `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL.slice(0, -1)}"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${rpr(1100, T.navy, 1)}</a:pPr><a:r><a:rPr lang="ar-SA" sz="1100" b="1"><a:solidFill><a:srgbClr val="${T.navy}"/></a:solidFill><a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr><a:t>${esc(p.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="${isBar ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${ch.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:dLbls><c:numFmt formatCode="${ch.fmt}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, T.text)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:cat><c:strRef><c:f>${esc(catF)}</c:f>${strCache}</c:strRef></c:cat><c:val><c:numRef><c:f>${esc(valF)}</c:f>${numCache}</c:numRef></c:val></c:ser><c:gapWidth val="60"/><c:axId val="101"/><c:axId val="102"/></c:barChart><c:catAx><c:axId val="101"/><c:scaling><c:orientation val="${isBar ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${isBar ? "r" : "b"}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="${T.hair}"/></a:solidFill></a:ln></c:spPr>${txPr(800, T.text)}<c:crossAx val="102"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="102"/><c:scaling><c:orientation val="${isBar ? "maxMin" : "minMax"}"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="${isBar ? "t" : "r"}"/><c:numFmt formatCode="${ch.fmt}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${noLine}<c:crossAx val="101"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx><c:spPr><a:noFill/></c:spPr></c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="${T.white}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${T.hair}"/></a:solidFill></a:ln></c:spPr>${txPr(900, T.text)}</c:chartSpace>`;
};

// drawings: one per content sheet (logo + charts + slicer frames)
const anchor = (r1, c1, r2, c2, body, edit = "oneCell") => `<xdr:twoCellAnchor editAs="${edit}"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const EMU = 9525;
const logoXml = (id) => `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>${6 * EMU}</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>${4 * EMU}</xdr:rowOff></xdr:from><xdr:ext cx="${180 * EMU}" cy="${40 * EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${180 * EMU}" cy="${40 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
const frame = (id, name, uri, inner) => `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic></xdr:graphicFrame>`;
const slicerAnchor = (id, s) => {
  const [req, ns] = s.kind === "pivot" ? ["a14", 'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"'] : ["sle15", 'xmlns:sle15="http://schemas.microsoft.com/office/drawing/2012/slicer"'];
  const [r1, c1, r2, c2] = s.at;
  const choice = anchor(r1, c1, r2, c2, frame(id, s.name, "http://schemas.microsoft.com/office/drawing/2010/slicer", `<sle:slicer xmlns:sle="http://schemas.microsoft.com/office/drawing/2010/slicer" name="${s.name}"/>`));
  const fb = anchor(r1, c1, r2, c2, `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ar-SA" sz="1100"/><a:t>مقسم</a:t></a:r></a:p></xdr:txBody></xdr:sp>`);
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice ${ns} Requires="${req}">${choice}</mc:Choice><mc:Fallback>${fb}</mc:Fallback></mc:AlternateContent>`;
};
let chartN = 0, drawingN = 0;
const sheetDrawing = {};
for (const n of ORDER.filter((x) => !SEPS.has(x))) {
  const dn = ++drawingN;
  const rels = `xl/drawings/_rels/drawing${dn}.xml.rels`;
  await addRel(rels, "rIdLogo", "image", "../media/logo.png");
  let id = 2;
  const parts = [logoXml(id++)];
  for (const p of pivots.filter((p) => p.sheet === n)) {
    const cn = ++chartN;
    const agg = aggregate(p);
    const cats = caches[p.cache].items[p.rows].map(String);
    const vals = agg.map((r) => r[p.chart.dataIx]);
    zip.file(`xl/charts/chart${cn}.xml`, chartXml(p, cats, vals));
    ct.push([`/xl/charts/chart${cn}.xml`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml"]);
    await addRel(rels, `rIdCh${cn}`, "chart", `../charts/chart${cn}.xml`);
    const [r1, c1, r2, c2] = p.chart.at;
    parts.push(anchor(r1, c1, r2, c2, frame(id++, `Chart ${cn}`, "http://schemas.openxmlformats.org/drawingml/2006/chart", `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdCh${cn}"/>`)));
    chartsMeta.push({ sheet: n, chart: cn, pivot: p.name, dataField: p.data[p.chart.dataIx][2], cats, vals });
  }
  for (const s of slicers.filter((s) => s.sheet === n)) parts.push(slicerAnchor(id++, s));
  zip.file(`xl/drawings/drawing${dn}.xml`, `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL.slice(0, -1)}">${parts.join("")}</xdr:wsDr>`);
  ct.push([`/xl/drawings/drawing${dn}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
  sheetDrawing[n] = dn;
}
writeFileSync(join(out, "charts.json"), JSON.stringify(chartsMeta));

// slicer caches and slicer parts
const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
const X15 = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const pivotCacheRefs = [], tableCacheRefs = [];
for (const [i, s] of slicers.entries()) {
  const k = i + 1;
  const c = caches[s.cache];
  let body;
  if (s.kind === "pivot") {
    const pts = s.pivots.map((n) => `<pivotTable tabId="${sheetId(pivots[n - 1].sheet)}" name="pivot${n}"/>`).join("");
    const items = c.items[s.field].map((_, x) => `<i x="${x}" s="1"/>`).join("");
    body = `<pivotTables>${pts}</pivotTables><data><tabular pivotCacheId="${c.id}"><items count="${c.items[s.field].length}">${items}</items></tabular></data>`;
    pivotCacheRefs.push(k);
  } else {
    body = `<extLst><x:ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}" xmlns:x15="${X15}"><x15:tableSlicerCache tableId="${c.tableN}" column="${c.cols.indexOf(s.field) + 1}"/></x:ext></extLst>`;
    tableCacheRefs.push(k);
  }
  zip.file(`xl/slicerCaches/slicerCache${k}.xml`, `${XML}<slicerCacheDefinition xmlns="${X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${s.name}" sourceName="${esc(s.field)}">${body}</slicerCacheDefinition>`);
  ct.push([`/xl/slicerCaches/slicerCache${k}.xml`, "application/vnd.ms-excel.slicerCache+xml"]);
  await addRel("xl/_rels/workbook.xml.rels", `rIdSc${k}`, "http://schemas.microsoft.com/office/2007/relationships/slicerCache", `slicerCaches/slicerCache${k}.xml`);
  s.k = k;
}
let slicerPartN = 0;
const sheetSlicerExt = {};
for (const n of ORDER) {
  const exts = [];
  for (const kind of ["pivot", "table"]) {
    const list = slicers.filter((s) => s.sheet === n && s.kind === kind);
    if (!list.length) continue;
    const pn = ++slicerPartN;
    const items = list.map((s) => `<slicer name="${s.name}" cache="${s.name}" caption="${esc(s.field)}" rowHeight="241300" style="SlicerStyleLight6"/>`).join("");
    zip.file(`xl/slicers/slicer${pn}.xml`, `${XML}<slicers xmlns="${X14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x xr10" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10">${items}</slicers>`);
    ct.push([`/xl/slicers/slicer${pn}.xml`, "application/vnd.ms-excel.slicer+xml"]);
    await addRel(`xl/worksheets/_rels/sheet${sheetId(n)}.xml.rels`, `rIdSl${pn}`, "http://schemas.microsoft.com/office/2007/relationships/slicer", `../slicers/slicer${pn}.xml`);
    exts.push(kind === "pivot"
      ? `<ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}" xmlns:x14="${X14}"><x14:slicerList><x14:slicer r:id="rIdSl${pn}"/></x14:slicerList></ext>`
      : `<ext uri="{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}" xmlns:x15="${X15}"><x14:slicerList xmlns:x14="${X14}"><x14:slicer r:id="rIdSl${pn}"/></x14:slicerList></ext>`);
  }
  if (exts.length) sheetSlicerExt[n] = `<extLst>${exts.join("")}</extLst>`;
}

// workbook.xml: defined names for slicers, pivot caches, slicer cache lists
let wbXml = await zip.file("xl/workbook.xml").async("string");
if (!wbXml.includes("xmlns:r=")) wbXml = wbXml.replace("<workbook ", `<workbook xmlns:r="${REL.slice(0, -1)}" `);
const names = slicers.map((s) => `<definedName name="${s.name}">#N/A</definedName>`).join("");
if (names) wbXml = wbXml.includes("<definedNames>") ? wbXml.replace("</definedNames>", `${names}</definedNames>`) : wbXml.replace("</sheets>", `</sheets><definedNames>${names}</definedNames>`);
const pcXml = `<pivotCaches>${pivotCaches.map(([, c]) => `<pivotCache cacheId="${c.id}" r:id="rIdPc${c.id}"/>`).join("")}</pivotCaches>`;
const wbExtP = pivotCacheRefs.length ? `<ext uri="{BBE1A952-AA13-448e-AADC-164F8A28A991}" xmlns:x14="${X14}"><x14:slicerCaches>${pivotCacheRefs.map((k) => `<x14:slicerCache r:id="rIdSc${k}"/>`).join("")}</x14:slicerCaches></ext>` : "";
const wbExtT = tableCacheRefs.length ? `<ext uri="{46BE6895-7355-4a93-B00E-2C351335B9C9}" xmlns:x15="${X15}"><x15:slicerCaches xmlns:x14="${X14}">${tableCacheRefs.map((k) => `<x14:slicerCache r:id="rIdSc${k}"/>`).join("")}</x15:slicerCaches></ext>` : "";
const wbExt = wbExtP || wbExtT ? `<extLst>${wbExtP}${wbExtT}</extLst>` : "";
wbXml = wbXml.replace("</workbook>", `${pcXml}${wbExt}</workbook>`);
zip.file("xl/workbook.xml", wbXml);

// worksheets: styles on cells, row heights, cols, views, drawing, tables, slicers
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
  const seen = new Set();
  let sd = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/);
  let inner = sd[1] ?? "";
  inner = inner.replace(/<row r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, (all, rr, cells) => {
    const r = Number(rr) - 1;
    if (!touched.has(r)) return all;
    seen.add(r);
    return fixRow(r, cells ?? "");
  });
  const missing = [...touched].filter((r) => !seen.has(r)).sort((a, b) => a - b);
  if (missing.length) {
    const rows = [...inner.matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)].map((mm) => ({ r: Number(mm[1]) - 1, xml: mm[0] }));
    for (const r of missing) rows.push({ r, xml: fixRow(r, "") });
    rows.sort((a, b) => a.r - b.r);
    inner = rows.map((x) => x.xml).join("");
  }
  return xml.replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, `<sheetData>${inner}</sheetData>`);
};
for (const [i, n] of ORDER.entries()) {
  const path = `xl/worksheets/sheet${i + 1}.xml`;
  const rels = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
  let xml = await zip.file(path).async("string");
  if (!xml.includes("xmlns:r=")) xml = xml.replace("<worksheet ", `<worksheet xmlns:r="${REL.slice(0, -1)}" `);
  const d = design[n];
  const sep = SEPS.has(n);
  // sheetPr (tab colour) must be the first child
  xml = xml.replace(/<sheetPr[^>]*\/>|<sheetPr[^>]*>[\s\S]*?<\/sheetPr>/, "");
  xml = xml.replace(/(<worksheet [^>]*>)/, `$1<sheetPr>${sep ? '<tabColor rgb="FF000000"/>' : `<tabColor rgb="FF${n === S.index ? T.gold : T.navy}"/>`}</sheetPr>`);
  const pane = d.freeze ? `<pane ySplit="${d.freeze}" topLeftCell="A${d.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${d.freeze + 1}" sqref="A${d.freeze + 1}"/>` : "";
  const view = `<sheetViews><sheetView showGridLines="0"${sep ? ' showRowColHeaders="0"' : ""} rightToLeft="1"${i === 0 ? ' tabSelected="1"' : ""} workbookViewId="0">${pane}</sheetView></sheetViews>`;
  xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, "");
  xml = /<dimension [^>]*\/>/.test(xml) ? xml.replace(/(<dimension [^>]*\/>)/, `$1${view}`) : xml.replace(/(<sheetPr>[\s\S]*?<\/sheetPr>)/, `$1${view}`);
  // cols: widths + background style (black on separators)
  const bgStyle = sep ? X.BLACK : X.BG;
  const widths = d.widths;
  const colXml = `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w + 0.7}" style="${bgStyle}" customWidth="1"/>`).join("")}<col min="${widths.length + 1}" max="16384" width="9.14" style="${bgStyle}"/></cols>`;
  xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, "");
  xml = xml.replace(/(<sheetFormatPr[^>]*\/>)/, "");
  xml = xml.replace(/(<sheetViews>[\s\S]*?<\/sheetViews>)/, `$1<sheetFormatPr defaultRowHeight="15"/>${colXml}`);
  if (sep) xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, "<sheetData/>").replace(/<dimension [^>]*\/>/, '<dimension ref="A1"/>');
  else xml = styleRows(xml, n);
  // tail: drawing, tableParts, extLst
  let tail = "";
  if (sheetDrawing[n]) { tail += `<drawing r:id="rIdDr"/>`; await addRel(rels, "rIdDr", "drawing", `../drawings/drawing${sheetDrawing[n]}.xml`); }
  const c = Object.values(caches).find((x) => x.sheet === n);
  if (c) { tail += `<tableParts count="1"><tablePart r:id="rIdTbl${c.tableN}"/></tableParts>`; await addRel(rels, `rIdTbl${c.tableN}`, "table", `../tables/table${c.tableN}.xml`); }
  tail += sheetSlicerExt[n] ?? "";
  for (const pn of sheetPivots[n] ?? []) await addRel(rels, `rIdPt${pn}`, "pivotTable", `../pivotTables/pivotTable${pn}.xml`);
  xml = xml.replace("</worksheet>", `${tail}</worksheet>`);
  zip.file(path, xml);
}

let ctXml = await zip.file("[Content_Types].xml").async("string");
if (!ctXml.includes('Extension="png"')) ctXml = ctXml.replace("<Override", '<Default Extension="png" ContentType="image/png"/><Override');
ctXml = ctXml.replace("</Types>", ct.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("") + "</Types>");
zip.file("[Content_Types].xml", ctXml);

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
writeFileSync(join(out, process.env.T8_OUT ?? "report.xlsx"), buf);
console.log(`report.xlsx ${(buf.length / 1024).toFixed(0)} KB; ${ORDER.length} sheets, ${pivots.length} pivots, ${chartN} charts, ${slicers.length} slicers, ${figures.length} figures; sheetjs ${tSheet - t0} ms, post-process ${Date.now() - tSheet} ms`);
