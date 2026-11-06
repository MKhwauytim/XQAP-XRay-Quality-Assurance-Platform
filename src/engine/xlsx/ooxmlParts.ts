import JSZip from "jszip";
import type { Cell } from "../data/types";
import type { ThemeTokens } from "../spec/types";
import type { PivotSpec } from "./planWorkbook";

/**
 * OOXML post-processing of the SheetJS package: styles, Excel tables, pivot caches (no records) and
 * pivot tables, separator sheets, sheet views, and package clean-up. Follows `poc/xlsx/build.mjs`,
 * which Excel 365 opened without repair. Slicers, charts, logo and shape buttons wait for Milestone 2.
 */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAIN_NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"`;
const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
export const TABLE_STYLE = "Deck3";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function colName(c: number): string {
  let n = c + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const a1 = (r: number, c: number): string => `${colName(c)}${r + 1}`;

/** Cell format indexes in the styles part `addStyles` writes. */
export const XF = {
  normal: 0, title: 1, label: 2, int: 3, pct: 4, year: 5, black: 6, link: 7, dec: 8, note: 9,
} as const;
export type XfId = typeof XF[keyof typeof XF];

const argb = (hex: string): string => `FF${hex.replace(/^#/, "").toUpperCase()}`;

/** Styles: the theme font as the Normal font, deck3 ink colours, black separator fill, the `Deck3` table style. */
export function addStyles(zip: JSZip, theme: ThemeTokens): void {
  const ink = theme.ink;
  const name = esc(theme.font);
  const font = (sz: number, color: string, extra = "") => `<font>${extra}<sz val="${sz}"/><color rgb="${argb(color)}"/><name val="${name}"/><family val="2"/></font>`;
  const fonts = [font(11, ink.text), font(16, ink.navy, "<b/>"), font(11, ink.navy, "<b/>"), font(11, theme.tones.primary, "<u/>"), font(10, ink.muted, "<i/>")];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor indexed="8"/><bgColor indexed="64"/></patternFill></fill>'];
  const al = '<alignment vertical="center" readingOrder="2"/>';
  const xf = (numFmt: number, fontId: number, fillId: number) =>
    `<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""} applyAlignment="1">${al}</xf>`;
  // Order matches XF: normal, title, label, int, pct, year, black, link, dec, note.
  const xfs = [xf(0, 0, 0), xf(0, 1, 0), xf(0, 2, 0), xf(3, 0, 0), xf(10, 0, 0), xf(1, 0, 0), xf(0, 0, 2), xf(0, 3, 0), xf(4, 0, 0), xf(0, 4, 0)];
  const solid = (c: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${argb(c)}"/><bgColor rgb="${argb(c)}"/></patternFill></fill>`;
  const dxfs = [
    `<dxf><font><color rgb="${argb(ink.text)}"/></font><border><bottom style="thin"><color rgb="${argb(ink.hair)}"/></bottom><horizontal style="thin"><color rgb="${argb(ink.hair)}"/></horizontal></border></dxf>`,
    `<dxf><font><b/><color rgb="${argb(ink.bg)}"/></font>${solid(ink.navy)}</dxf>`,
    `<dxf>${solid(ink.panel)}</dxf>`,
    `<dxf><font><b/><color rgb="${argb(ink.navy)}"/></font><border><top style="thin"><color rgb="${argb(ink.gold)}"/></top></border></dxf>`,
  ];
  const tableStyle = `<tableStyles count="1" defaultTableStyle="${TABLE_STYLE}" defaultPivotStyle="${TABLE_STYLE}"><tableStyle name="${TABLE_STYLE}" count="4"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow" dxfId="1"/><tableStyleElement type="totalRow" dxfId="3"/><tableStyleElement type="firstRowStripe" dxfId="2"/></tableStyle></tableStyles>`;
  zip.file("xl/styles.xml", `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills>`
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + `<dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs>${tableStyle}</styleSheet>`);
}

/** The theme's major and minor Latin and complex-script fonts become the theme font, so pivots use it too. */
export async function setThemeFont(zip: JSZip, font: string): Promise<void> {
  const part = zip.file("xl/theme/theme1.xml");
  if (part === null) return;
  const f = esc(font);
  const xml = (await part.async("string"))
    .replace(/(<a:(?:major|minor)Font>\s*<a:latin typeface=")[^"]*"/g, `$1${f}"`)
    .replace(/(<a:(?:major|minor)Font>\s*<a:latin [^>]*\/>\s*<a:ea [^>]*\/>\s*<a:cs typeface=")[^"]*"/g, `$1${f}"`);
  zip.file("xl/theme/theme1.xml", xml);
}

const sheetPart = (n: number) => `xl/worksheets/sheet${n}.xml`;
const sheetRels = (n: number) => `xl/worksheets/_rels/sheet${n}.xml.rels`;

async function text(zip: JSZip, path: string): Promise<string | undefined> {
  const f = zip.file(path);
  return f === null ? undefined : f.async("string");
}

async function addRel(zip: JSZip, relsPath: string, id: string, type: string, target: string): Promise<void> {
  const xml = (await text(zip, relsPath))
    ?? `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(relsPath, xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`));
}

async function addOverride(zip: JSZip, part: string, type: string): Promise<void> {
  const xml = (await text(zip, "[Content_Types].xml")) ?? "";
  zip.file("[Content_Types].xml", xml.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`));
}

async function appendToSheet(zip: JSZip, n: number, xml: string): Promise<void> {
  const ws = (await text(zip, sheetPart(n))) ?? "";
  zip.file(sheetPart(n), ws.replace("</worksheet>", `${xml}</worksheet>`));
}

export interface TablePart {
  name: string;
  /** 1-based worksheet part number. */
  sheet: number;
  ref: string;
  columns: string[];
}

/** Excel tables with autofilter and the `Deck3` style; ids and part numbers follow the array order. */
export async function addTables(zip: JSZip, tables: TablePart[]): Promise<void> {
  const bySheet = new Map<number, number[]>();
  for (const [i, t] of tables.entries()) {
    const id = i + 1;
    const cols = t.columns.map((h, c) => `<tableColumn id="${c + 1}" name="${esc(h)}"/>`).join("");
    zip.file(`xl/tables/table${id}.xml`, `${XML}<table ${MAIN_NS} id="${id}" name="${esc(t.name)}" displayName="${esc(t.name)}" ref="${t.ref}" totalsRowShown="0"><autoFilter ref="${t.ref}"/><tableColumns count="${t.columns.length}">${cols}</tableColumns><tableStyleInfo name="${TABLE_STYLE}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`);
    await addOverride(zip, `xl/tables/table${id}.xml`, `${CT}.table+xml`);
    await addRel(zip, sheetRels(t.sheet), `rIdTbl${id}`, `${REL}/table`, `../tables/table${id}.xml`);
    bySheet.set(t.sheet, [...(bySheet.get(t.sheet) ?? []), id]);
  }
  for (const [sheet, ids] of bySheet) {
    await appendToSheet(zip, sheet, `<tableParts count="${ids.length}">${ids.map((id) => `<tablePart r:id="rIdTbl${id}"/>`).join("")}</tableParts>`);
  }
}

export interface PivotPart {
  spec: PivotSpec;
  sheet: number;
  /** Top-left cell (0-based) of the pivot's header row. */
  at: { r: number; c: number };
  /** The source table's column headers, in order. */
  columns: string[];
  /** Distinct row-field values in display order. */
  items: Cell[];
  /** The data field's numeric range, for a sum or average pivot. */
  numeric?: { min: number; max: number; integer: boolean };
}

function sharedItem(v: Cell): string {
  if (v === null || v === "") return "<m/>";
  if (typeof v === "number") return `<n v="${v}"/>`;
  if (typeof v === "boolean") return `<b v="${v ? 1 : 0}"/>`;
  return `<s v="${esc(v)}"/>`;
}

function itemAttrs(items: Cell[]): string {
  const nums = items.filter((v): v is number => typeof v === "number");
  const hasText = items.some((v) => typeof v === "string" && v !== "" || typeof v === "boolean");
  const blank = items.some((v) => v === null || v === "") ? ' containsBlank="1"' : "";
  if (nums.length === 0) return blank;
  const range = ` minValue="${Math.min(...nums)}" maxValue="${Math.max(...nums)}"`;
  const int = nums.every(Number.isInteger) ? ' containsInteger="1"' : "";
  return hasText ? ` containsMixedTypes="1" containsNumber="1"${int}${range}${blank}` : ` containsSemiMixedTypes="0" containsString="0" containsNumber="1"${int}${range}${blank}`;
}

function cacheXml(p: PivotPart, id: number): string {
  const fields = p.columns.map((h) => {
    if (h === p.spec.rowField) {
      return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems${itemAttrs(p.items)} count="${p.items.length}">${p.items.map(sharedItem).join("")}</sharedItems></cacheField>`;
    }
    if (h === p.spec.dataField && p.numeric) {
      const n = p.numeric;
      return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1"${n.integer ? ' containsInteger="1"' : ""} minValue="${n.min}" maxValue="${n.max}"/></cacheField>`;
    }
    return `<cacheField name="${esc(h)}" numFmtId="0"><sharedItems/></cacheField>`;
  });
  return `${XML}<pivotCacheDefinition ${MAIN_NS} saveData="0" refreshOnLoad="1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="0"><cacheSource type="worksheet"><worksheetSource name="${esc(p.spec.sourceTable)}"/></cacheSource><cacheFields count="${fields.length}">${fields.join("")}</cacheFields><extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotCacheDefinition pivotCacheId="${id}"/></ext></extLst></pivotCacheDefinition>`;
}

/** Rows a pivot occupies: its header, one per item, and the grand total. */
export const pivotHeight = (items: number): number => items + 2;

function pivotXml(p: PivotPart, id: number): string {
  const { spec } = p;
  const rowIx = p.columns.indexOf(spec.rowField);
  const dataIx = p.columns.indexOf(spec.dataField);
  const k = p.items.length;
  const fields = p.columns.map((_, i) => {
    const data = i === dataIx ? ' dataField="1"' : "";
    if (i !== rowIx) return `<pivotField${data} showAll="0"/>`;
    return `<pivotField axis="axisRow"${data} showAll="0"><items count="${k + 1}">${p.items.map((_v, x) => `<item x="${x}"/>`).join("")}<item t="default"/></items></pivotField>`;
  }).join("");
  const ref = `${a1(p.at.r, p.at.c)}:${a1(p.at.r + pivotHeight(k) - 1, p.at.c + 1)}`;
  const rowItems = `<rowItems count="${k + 1}">${p.items.map((_v, x) => (x ? `<i><x v="${x}"/></i>` : "<i><x/></i>")).join("")}<i t="grand"><x/></i></rowItems>`;
  const sub = spec.agg === "sum" ? "" : ` subtotal="${spec.agg}"`;
  return `${XML}<pivotTableDefinition ${MAIN_NS} name="${esc(spec.name)}" cacheId="${id}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0" dataCaption="القيم" grandTotalCaption="الإجمالي" rowHeaderCaption="${esc(spec.rowField)}" updatedVersion="6" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0">`
    + `<location ref="${ref}" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="${p.columns.length}">${fields}</pivotFields>`
    + `<rowFields count="1"><field x="${rowIx}"/></rowFields>${rowItems}<colItems count="1"><i/></colItems>`
    + `<dataFields count="1"><dataField name="${esc(dataFieldName(spec, p.columns))}" fld="${dataIx}"${sub} baseField="0" baseItem="0"/></dataFields>`
    + `<pivotTableStyleInfo name="${TABLE_STYLE}" showRowHeaders="1" showColHeaders="1" showRowStripes="1" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
}

/** The pivot's value caption. Excel refuses a data field named like a source field, so such a name is qualified. */
export function dataFieldName(spec: PivotSpec, columns: string[]): string {
  const base = spec.agg === "count" ? `عدد ${spec.dataField}` : spec.agg === "sum" ? `مجموع ${spec.dataField}` : `متوسط ${spec.dataField}`;
  const key = (s: string) => s.replace(/[أإآٱ]/g, "ا").toLowerCase();
  return columns.some((c) => key(c) === key(base)) ? `${base} في الجدول المحوري` : base;
}

/** Pivot caches (`saveData="0" refreshOnLoad="1"`, no records part) and pivot tables, one cache per pivot. */
export async function addPivots(zip: JSZip, pivots: PivotPart[]): Promise<void> {
  const caches: string[] = [];
  for (const [i, p] of pivots.entries()) {
    const id = i + 1;
    const cache = `xl/pivotCache/pivotCacheDefinition${id}.xml`;
    zip.file(cache, cacheXml(p, id));
    await addOverride(zip, cache, `${CT}.pivotCacheDefinition+xml`);
    await addRel(zip, "xl/_rels/workbook.xml.rels", `rIdPc${id}`, `${REL}/pivotCacheDefinition`, `pivotCache/pivotCacheDefinition${id}.xml`);
    caches.push(`<pivotCache cacheId="${id}" r:id="rIdPc${id}"/>`);
    const table = `xl/pivotTables/pivotTable${id}.xml`;
    zip.file(table, pivotXml(p, id));
    await addOverride(zip, table, `${CT}.pivotTable+xml`);
    await addRel(zip, `xl/pivotTables/_rels/pivotTable${id}.xml.rels`, "rId1", `${REL}/pivotCacheDefinition`, `../pivotCache/pivotCacheDefinition${id}.xml`);
    await addRel(zip, sheetRels(p.sheet), `rIdPt${id}`, `${REL}/pivotTable`, `../pivotTables/pivotTable${id}.xml`);
  }
  if (caches.length === 0) return;
  const wb = (await text(zip, "xl/workbook.xml")) ?? "";
  zip.file("xl/workbook.xml", wb.replace("</workbook>", `<pivotCaches>${caches.join("")}</pivotCaches></workbook>`));
}

export interface SheetView {
  tabColor: string | "black";
  /** 0-based row index of a table header to freeze below. */
  freezeBelowRow?: number;
  gridlines: boolean;
  selected: boolean;
}

/** Tab colour, right-to-left view, gridlines, frozen pane, and per-cell styles. SheetJS's own `s` indexes are dropped. */
export async function styleSheet(zip: JSZip, n: number, view: SheetView, styles: Map<string, XfId>): Promise<void> {
  let xml = (await text(zip, sheetPart(n))) ?? "";
  xml = xml.replace(/<sheetPr[^>]*\/>|<sheetPr[^>]*>[\s\S]*?<\/sheetPr>/, "");
  const tab = view.tabColor === "black" ? '<tabColor indexed="8"/>' : `<tabColor rgb="${argb(view.tabColor)}"/>`;
  xml = xml.replace(/(<worksheet [^>]*>)/, `$1<sheetPr>${tab}</sheetPr>`);
  const f = view.freezeBelowRow;
  const pane = f === undefined ? "" : `<pane ySplit="${f + 1}" topLeftCell="A${f + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${f + 2}" sqref="A${f + 2}"/>`;
  const sv = `<sheetViews><sheetView${view.gridlines ? "" : ' showGridLines="0"'} rightToLeft="1"${view.selected ? ' tabSelected="1"' : ""} workbookViewId="0">${pane}</sheetView></sheetViews>`;
  xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>|<sheetViews\/>/, sv);
  xml = xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)(\/?)>/g, (_all, ref: string, attrs: string, close: string) => {
    const kept = attrs.replace(/ s="\d+"/, "");
    const s = styles.get(ref);
    return `<c r="${ref}"${s === undefined || s === XF.normal ? "" : ` s="${s}"`}${kept}${close}>`;
  });
  zip.file(sheetPart(n), xml);
}

/** Separators: black tab and black cells, gridlines and headings hidden, nothing on the sheet. */
export async function addSeparators(zip: JSZip, sheets: number[]): Promise<void> {
  for (const n of sheets) {
    let xml = (await text(zip, sheetPart(n))) ?? "";
    xml = xml.replace(/<sheetPr[^>]*\/>|<sheetPr[^>]*>[\s\S]*?<\/sheetPr>/, "");
    xml = xml.replace(/(<worksheet [^>]*>)/, '$1<sheetPr><tabColor indexed="8"/></sheetPr>');
    xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>|<sheetViews\/>/, '<sheetViews><sheetView showGridLines="0" showRowColHeaders="0" rightToLeft="1" workbookViewId="0"/></sheetViews>');
    xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, "").replace(/<sheetData>[\s\S]*?<\/sheetData>|<sheetData\/>/, `<cols><col min="1" max="16384" width="9.140625" style="${XF.black}"/></cols><sheetData/>`);
    xml = xml.replace(/<dimension [^>]*\/>/, '<dimension ref="A1"/>').replace(/<ignoredErrors>[\s\S]*?<\/ignoredErrors>/, "");
    zip.file(sheetPart(n), xml);
  }
}

/** External hyperlink targets as URIs: SheetJS writes the raw file name. */
export async function encodeExternalTargets(zip: JSZip): Promise<void> {
  for (const path of Object.keys(zip.files).filter((p) => /^xl\/worksheets\/_rels\/.+\.rels$/.test(p)).sort()) {
    const xml = (await text(zip, path)) ?? "";
    zip.file(path, xml.replace(/(<Relationship [^>]*?Target=")([^"]*)("[^>]*TargetMode="External")/g, (_a, pre: string, target: string, post: string) => `${pre}${esc(encodeURI(target.replace(/&amp;/g, "&")))}${post}`));
  }
}

/**
 * PoC package fixes: a relationship to a missing part (SheetJS `metadata.xml`), an override for a missing
 * part, and the `.bin` default declared as a macro binary when no `.bin` part exists.
 */
export async function cleanPackage(zip: JSZip): Promise<void> {
  const parts = new Set(Object.keys(zip.files).filter((p) => !zip.files[p].dir));
  for (const relsPath of [...parts].filter((p) => p.endsWith(".rels")).sort()) {
    const dir = relsPath.replace(/_rels\/[^/]+\.rels$/, "");
    const xml = (await text(zip, relsPath)) ?? "";
    zip.file(relsPath, xml.replace(/<Relationship [^>]*\/>/g, (rel) => {
      if (/TargetMode="External"/.test(rel)) return rel;
      const target = /Target="([^"]*)"/.exec(rel)?.[1] ?? "";
      return parts.has(resolvePart(dir, target)) ? rel : "";
    }));
  }
  let ct = (await text(zip, "[Content_Types].xml")) ?? "";
  ct = ct.replace(/<Override PartName="\/([^"]+)"[^>]*\/>/g, (o, p: string) => (parts.has(p) ? o : ""));
  if (![...parts].some((p) => p.endsWith(".bin"))) ct = ct.replace(/<Default Extension="bin"[^>]*\/>/, "");
  zip.file("[Content_Types].xml", ct);
}

function resolvePart(dir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const out: string[] = dir.split("/").filter((s) => s !== "");
  for (const seg of target.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== ".") out.push(seg);
  }
  return out.join("/");
}

function entryRank(name: string): number {
  if (name === "[Content_Types].xml") return 0;
  if (name.startsWith("_rels/")) return 1;
  return 2;
}

/** Re-zips with every entry dated `issuedAt`, in a fixed order, so the same input gives the same bytes. */
export async function finishZip(zip: JSZip, issuedAt: string): Promise<Uint8Array> {
  const date = new Date(issuedAt);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
    .sort((a, b) => entryRank(a) - entryRank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const out = new JSZip();
  for (const n of names) out.file(n, await zip.files[n].async("uint8array"), { date, createFolders: false });
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
}
