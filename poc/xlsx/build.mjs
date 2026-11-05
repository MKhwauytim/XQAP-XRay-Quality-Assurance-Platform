// T8 step 2: write the report workbook with SheetJS, then post-process the zip with JSZip
// to add what the community build cannot write: Excel tables (ListObjects), pivot caches,
// pivot tables, frozen header panes and right-to-left sheet views.
//
// Inputs (read only): out/rows.json from extract.mjs, ../port-pptx/out/model.json.
// Output: out/report.xlsx, out/figures.json (the figures verify.ps1 compares).
//
// Column placement in an RTL sheet: column A is drawn at the right edge. The data table
// starts at A (it is read first), one empty spacer column follows, and the pivot starts
// after it (H on both data sheets). On screen that puts the pivot to the LEFT of the table.

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
const SEL = m.port;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i) => XLSX.utils.encode_col(i);

// ---------- sheets and data ----------
const S = { index: "الفهرس", pop: "المجتمع", sample: "العينة", stats: "الإحصائيات", source: "المصدر" };
const popCols = ["المنفذ", "نوع المنفذ", "المجموعة", "السنة", "الشهر", "عدد الصور"];
const popAoa = [popCols, ...population.map((r) => [r.port, r.type, r.group, r.year, r.month, r.images])];
const smpCols = ["المنفذ", "المجموعة", "السنة", "الشهر", "حالة الصورة", "التوائم"];
const smpAoa = [smpCols, ...studies.map((r) => [r.port, r.group, r.year ?? "", r.month, r.status, r.match])];

const slide = {
  popSample: "المجتمع والعينة المدروسة في ميناء جدة الإسلامي",
  results: "نتائج دراسة صور ميناء جدة الإسلامي",
  compare: "نسبة التوائم: ميناء جدة الإسلامي مقابل جميع المنافذ",
  timeline: "الخط الزمني لنسبة التوائم في ميناء جدة الإسلامي",
};

// Pivot specs. cache: which table; rows/page: field names; data: [field, subtotal, name, numFmtId].
const pivots = [
  { sheet: S.pop, at: [2, 7], cache: "pop", rows: "المنفذ", data: [["عدد الصور", "sum", "مجموع الصور", 3]], title: "مجموع الصور لكل منفذ" },
  { sheet: S.sample, at: [2, 7], cache: "smp", rows: "المنفذ", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], title: "الدراسات ونسبة التوائم لكل منفذ" },
  { sheet: S.stats, at: [4, 0], cache: "pop", rows: "المجموعة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "المجتمع حسب المجموعة" },
  { sheet: S.stats, at: [4, 4], cache: "pop", page: ["المنفذ", SEL], rows: "السنة", data: [["عدد الصور", "sum", "مجموع الصور", 3]], feeds: slide.popSample, title: "مجتمع الميناء حسب السنة" },
  { sheet: S.stats, at: [4, 8], cache: "smp", page: ["المنفذ", SEL], rows: "حالة الصورة", data: [["حالة الصورة", "count", "عدد الدراسات", 3]], feeds: slide.results, title: "نتائج دراسة صور الميناء" },
  { sheet: S.stats, at: [4, 12], cache: "smp", rows: "المجموعة", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], feeds: slide.compare, title: "نسبة التوائم حسب المجموعة" },
  { sheet: S.stats, at: [4, 17], cache: "smp", page: ["المنفذ", SEL], rows: "السنة", data: [["حالة الصورة", "count", "عدد الدراسات", 3], ["التوائم", "average", "نسبة التوائم", 10]], feeds: slide.timeline, title: "عينة الميناء ونسبة التوائم حسب السنة" },
];
const caches = {
  pop: { id: 1, table: "tblPopulation", cols: popCols, aoa: popAoa, sheet: S.pop },
  smp: { id: 2, table: "tblSample", cols: smpCols, aoa: smpAoa, sheet: S.sample },
};

// ---------- figures for المصدر and for verification ----------
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

// ---------- SheetJS workbook ----------
const wb = XLSX.utils.book_new();
const descs = [
  [S.pop, "المجتمع الكامل: صف لكل منفذ وشهر بعدد الصور الواردة، مع جدول محوري لمجموع الصور لكل منفذ"],
  [S.sample, "العينة المدروسة: صف لكل صورة مدروسة بحالتها والتوائم، مع جدول محوري للدراسات ونسبة التوائم لكل منفذ"],
  [S.stats, "كل حسابات التقرير جداول محورية، كل جدول معنون بالشريحة التي يغذيها"],
  [S.source, "مصدر كل رقم في التقرير: الورقة والحقل والتصفية والمقياس"],
];
const idx = XLSX.utils.aoa_to_sheet([["الورقة", "المحتوى"], ...descs.map(([n, d]) => [n, d])]);
descs.forEach(([n], i) => { idx[`A${i + 2}`].l = { Target: `#'${n}'!A1`, Tooltip: `الانتقال إلى ${n}` }; });
idx["!cols"] = [{ wch: 18 }, { wch: 100 }];
XLSX.utils.book_append_sheet(wb, idx, S.index);

for (const c of [caches.pop, caches.smp]) {
  const ws = XLSX.utils.aoa_to_sheet(c.aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 16 }, { wch: 20 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 3 }, { wch: 26 }, { wch: 14 }, { wch: 14 }];
  c.ref = `A1:${col(c.cols.length - 1)}${c.aoa.length}`;
  XLSX.utils.book_append_sheet(wb, ws, c.sheet);
}

const stats = XLSX.utils.aoa_to_sheet([["الإحصائيات: كل جدول محوري معنون بالشريحة التي يغذيها"]]);
for (const p of pivots.filter((p) => p.sheet === S.stats)) {
  XLSX.utils.sheet_add_aoa(stats, [[p.title], [`يغذي الشريحة: ${p.feeds}`]], { origin: { r: 1, c: p.at[1] } });
}
stats["!cols"] = Array.from({ length: 22 }, (_, i) => ({ wch: [3, 7, 11, 16].includes(i) ? 3 : 18 }));
XLSX.utils.book_append_sheet(wb, stats, S.stats);
for (const p of pivots.filter((p) => p.sheet !== S.stats)) {
  const ws = wb.Sheets[p.sheet];
  XLSX.utils.sheet_add_aoa(ws, [[p.title]], { origin: { r: 0, c: p.at[1] } });
}

const src = XLSX.utils.aoa_to_sheet([["الرقم", "القيمة في التقرير", "الورقة", "الحقل", "التصفية", "المقياس", "الجدول المحوري"],
  ...figures.map(([label, value, pivot, , , sheet, field, filter, measure]) => [label, value, sheet, field, filter, measure, pivot])]);
src["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 48 }, { wch: 10 }, { wch: 14 }];
XLSX.utils.book_append_sheet(wb, src, S.source);
const sheetOrder = [S.index, S.pop, S.sample, S.stats, S.source];
const base = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
const tSheet = Date.now();

// ---------- post-process ----------
const zip = await JSZip.loadAsync(base);
const ct = [];
const addRel = async (path, id, type, target) => {
  const rel = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const f = zip.file(path);
  const xml = f ? await f.async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(path, xml.replace("</Relationships>", `${rel}</Relationships>`));
};
const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

// tables
let tableN = 0;
for (const c of [caches.pop, caches.smp]) {
  c.tableN = ++tableN;
  const cols = c.cols.map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`).join("");
  zip.file(`xl/tables/table${c.tableN}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table ${NS} id="${c.tableN}" name="${c.table}" displayName="${c.table}" ref="${c.ref}" totalsRowShown="0"><autoFilter ref="${c.ref}"/><tableColumns count="${c.cols.length}">${cols}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`);
  ct.push([`/xl/tables/table${c.tableN}.xml`, "table"]);
}

const PARTS = process.env.T8_PARTS ?? "all";
if (process.env.T8_ONLY) { const keep = new Set(process.env.T8_ONLY.split(",").map(Number)); const kept = pivots.filter((_, i) => keep.has(i + 1)); pivots.length = 0; pivots.push(...kept); }
if (PARTS === "tables") { pivots.length = 0; for (const k of Object.keys(caches)) caches[k].skip = true; }
// pivot caches (no records part: saveData="0" + refreshOnLoad="1", Excel builds the cache on open)
const axisFields = (cache) => new Set(pivots.filter((p) => p.cache === cache).flatMap((p) => [p.rows, p.page?.[0]].filter(Boolean)));
for (const [key, c] of Object.entries(caches)) {
  if (c.skip) continue;
  const axes = axisFields(key);
  c.items = {};
  const fields = c.cols.map((h, i) => {
    const vals = c.aoa.slice(1).map((r) => r[i]);
    const nums = vals.filter((v) => typeof v === "number");
    const hasBlank = vals.some((v) => v === "" || v === null);
    const allNum = nums.length === vals.length - vals.filter((v) => v === "" || v === null).length && nums.length > 0;
    const numAttrs = allNum ? ` containsSemiMixedTypes="0" containsString="0" containsNumber="1"${nums.every(Number.isInteger) ? ' containsInteger="1"' : ""} minValue="${nums.reduce((a, b) => Math.min(a, b))}" maxValue="${nums.reduce((a, b) => Math.max(a, b))}"${hasBlank ? ' containsBlank="1"' : ""}` : hasBlank ? ' containsBlank="1"' : "";
    if (!axes.has(h)) return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${numAttrs}/></cacheField>`;
    const uniq = [...new Set(vals.map((v) => (v === null ? "" : v)))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    c.items[h] = uniq;
    const items = uniq.map((v) => (v === "" ? "<m/>" : typeof v === "number" ? `<n v="${v}"/>` : `<s v="${esc(v)}"/>`)).join("");
    return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${numAttrs} count="${uniq.length}">${items}</sharedItems></cacheField>`;
  });
  zip.file(`xl/pivotCache/pivotCacheDefinition${c.id}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition ${NS} saveData="0" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="0"><cacheSource type="worksheet"><worksheetSource name="${c.table}"/></cacheSource><cacheFields count="${fields.length}">${fields.join("")}</cacheFields></pivotCacheDefinition>`);
  ct.push([`/xl/pivotCache/pivotCacheDefinition${c.id}.xml`, "pivotCacheDefinition"]);
  await addRel("xl/_rels/workbook.xml.rels", `rIdPc${c.id}`, "pivotCacheDefinition", `pivotCache/pivotCacheDefinition${c.id}.xml`);
}
let wbXml = await zip.file("xl/workbook.xml").async("string");
const pcXml = PARTS === "tables" ? "" : `<pivotCaches>${Object.values(caches).map((c) => `<pivotCache cacheId="${c.id}" r:id="rIdPc${c.id}"/>`).join("")}</pivotCaches>`;
if (!wbXml.includes("xmlns:r=")) wbXml = wbXml.replace("<workbook ", `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
wbXml = wbXml.includes("<extLst>") ? wbXml.replace("<extLst>", `${pcXml}<extLst>`) : wbXml.replace("</workbook>", `${pcXml}</workbook>`);
zip.file("xl/workbook.xml", wbXml);

// pivot tables
const sheetPivots = {};
pivots.forEach((p, i) => {
  const n = i + 1;
  const c = caches[p.cache];
  const fIdx = (h) => c.cols.indexOf(h);
  const rowItems = c.items[p.rows];
  const dataSet = new Set(p.data.map((d) => d[0]));
  const pf = c.cols.map((h) => {
    const dataAttr = dataSet.has(h) ? ' dataField="1"' : "";
    const axis = h === p.rows ? "axisRow" : h === p.page?.[0] ? "axisPage" : null;
    if (!axis) return `<pivotField${dataAttr} showAll="0"/>`;
    const its = c.items[h].map((_, k) => `<item x="${k}"/>`).join("");
    return `<pivotField axis="${axis}"${dataAttr} showAll="0"><items count="${c.items[h].length + 1}">${its}<item t="default"/></items></pivotField>`;
  }).join("");
  const [r0, c0] = p.page ? [p.at[0] + 2, p.at[1]] : p.at;
  const nd = p.data.length;
  const ref = `${col(c0)}${r0 + 1}:${col(c0 + nd)}${r0 + 1 + rowItems.length + 1}`;
  const loc = `<location ref="${ref}" firstHeaderRow="${nd > 1 ? 0 : 1}" firstDataRow="1" firstDataCol="1"${p.page ? ' rowPageCount="1" colPageCount="1"' : ""}/>`;
  const ri = `<rowItems count="${rowItems.length + 1}">${rowItems.map((_, k) => (k ? `<i><x v="${k}"/></i>` : "<i><x/></i>")).join("")}<i t="grand"><x/></i></rowItems>`;
  const cf = nd > 1 ? `<colFields count="1"><field x="-2"/></colFields><colItems count="${nd}">${p.data.map((_, k) => (k ? `<i i="${k}"><x v="${k}"/></i>` : "<i><x/></i>")).join("")}</colItems>` : `<colItems count="1"><i/></colItems>`;
  const pg = p.page ? `<pageFields count="1"><pageField fld="${fIdx(p.page[0])}" item="${c.items[p.page[0]].indexOf(p.page[1])}" hier="-1"/></pageFields>` : "";
  const df = `<dataFields count="${nd}">${p.data.map(([f, sub, name, fmt]) => `<dataField name="${esc(name)}" fld="${fIdx(f)}"${sub === "sum" ? "" : ` subtotal="${sub}"`} baseField="0" baseItem="0" numFmtId="${fmt}"/>`).join("")}</dataFields>`;
  zip.file(`xl/pivotTables/pivotTable${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition ${NS} name="pivot${n}" cacheId="${c.id}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="القيم" grandTotalCaption="الإجمالي" rowHeaderCaption="${esc(p.rows)}" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">${loc}<pivotFields count="${c.cols.length}">${pf}</pivotFields><rowFields count="1"><field x="${fIdx(p.rows)}"/></rowFields>${ri}${cf}${pg}${df}<pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`);
  ct.push([`/xl/pivotTables/pivotTable${n}.xml`, "pivotTable"]);
  zip.file(`xl/pivotTables/_rels/pivotTable${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${c.id}.xml"/></Relationships>`);
  (sheetPivots[p.sheet] ??= []).push(n);
});

// sheet views (RTL + frozen header), table parts, sheet rels
for (const [i, name] of sheetOrder.entries()) {
  const path = `xl/worksheets/sheet${i + 1}.xml`;
  const rels = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
  let xml = await zip.file(path).async("string");
  const frozen = name === S.pop || name === S.sample || name === S.source;
  const view = `<sheetViews><sheetView rightToLeft="1"${i === 0 ? ' tabSelected="1"' : ""} workbookViewId="0">${frozen ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : ""}</sheetView></sheetViews>`;
  xml = /<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml) ? xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, view) : xml.replace(/(<dimension [^>]*\/>)/, `$1${view}`);
  if (!xml.includes("xmlns:r=")) xml = xml.replace("<worksheet ", `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" `);
  const c = Object.values(caches).find((x) => x.sheet === name);
  if (c) {
    xml = xml.replace("</worksheet>", `<tableParts count="1"><tablePart r:id="rIdTbl${c.tableN}"/></tableParts></worksheet>`);
    await addRel(rels, `rIdTbl${c.tableN}`, "table", `../tables/table${c.tableN}.xml`);
  }
  for (const n of sheetPivots[name] ?? []) await addRel(rels, `rIdPt${n}`, "pivotTable", `../pivotTables/pivotTable${n}.xml`);
  zip.file(path, xml);
}

let ctXml = await zip.file("[Content_Types].xml").async("string");
ctXml = ctXml.replace("</Types>", ct.map(([p, t]) => `<Override PartName="${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${t}+xml"/>`).join("") + "</Types>");
zip.file("[Content_Types].xml", ctXml);

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
writeFileSync(join(out, process.env.T8_OUT ?? "report.xlsx"), buf);
console.log(`report.xlsx ${(buf.length / 1024).toFixed(0)} KB; population ${population.length} rows, sample ${studies.length} rows, ${pivots.length} pivots, ${figures.length} figures; sheetjs ${tSheet - t0} ms, post-process ${Date.now() - tSheet} ms`);
