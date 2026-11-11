// The processed-data workbook: the owner's raw population and study rows after the engine's
// processing (one row per image id and month, level-1/level-2 employees corrected for the 2025
// sheets, study rows completed from the population, canonical port names), cut into one sheet per
// year-quarter (one per month when a quarter passes QUARTER_ROW_LIMIT rows), with an index and two
// dashboards (population and sample per period and port).
//
// It is written as streamed sheet XML (Blob parts, inline strings) so a population of several
// million rows never has to sit in memory as cell objects; JSZip packs the finished parts.

import JSZip from "jszip";
import type { PortStudyRow } from "./portReportModel";
import type { PopulationRow } from "./workloadAggregate";

/** A quarter above this many population rows is written one sheet per month (an Excel sheet holds 1,048,576 rows). */
export const QUARTER_ROW_LIMIT = 1_000_000;
/** Rows per sheet before a sheet rolls over to a «(2)» continuation. */
const SHEET_ROW_CAP = 1_048_575;

type Cell = string | number | null | undefined;

const xmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string).split("").filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join("");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

class SheetXml {
  rows = 0;
  private parts: BlobPart[] = [];
  private buf: string[] = [];
  readonly name: string;
  constructor(name: string, header: readonly string[]) {
    this.name = name;
    this.row(header);
  }
  row(values: readonly Cell[]): void {
    const r = ++this.rows;
    let x = `<row r="${r}">`;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || v === "") continue;
      const ref = colName(i) + r;
      x += typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(String(v))}</t></is></c>`;
    }
    this.buf.push(x + "</row>");
    if (this.buf.length >= 5000) this.flush();
  }
  private flush(): void {
    if (this.buf.length) this.parts.push(new Blob([this.buf.join("")]));
    this.buf = [];
  }
  blob(): Blob {
    this.flush();
    return new Blob([
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>',
      ...this.parts,
      "</sheetData></worksheet>",
    ]);
  }
}

/** A sheet family keyed by period; a sheet that fills up continues in «name (2)». */
class SheetSet {
  private bySheet = new Map<string, SheetXml[]>();
  private readonly header: readonly string[];
  constructor(header: readonly string[]) {
    this.header = header;
  }
  row(name: string, values: readonly Cell[]): void {
    let list = this.bySheet.get(name);
    if (!list) this.bySheet.set(name, (list = [new SheetXml(name, this.header)]));
    let s = list[list.length - 1];
    if (s.rows >= SHEET_ROW_CAP) list.push((s = new SheetXml(`${name} (${list.length + 1})`, this.header)));
    s.row(values);
  }
  sheets(): SheetXml[] {
    return [...this.bySheet.keys()].sort().flatMap((k) => this.bySheet.get(k) as SheetXml[]);
  }
}

const quarterOf = (ym: string) => `${ym.slice(0, 4)}-Q${Math.ceil(Number(ym.slice(5, 7)) / 3)}`;

export type DataWorkbookInput = {
  /** Streams every population row (after de-duplication) to `onRow`; called twice (sizes, then rows). */
  readPopulation: (onRow: (r: PopulationRow) => void) => Promise<void>;
  /** The processed study rows the report used. */
  studies: readonly PortStudyRow[];
  /** Raw population port name → the report's canonical name. */
  portNames: Readonly<Record<string, string>>;
  /** Population months to keep, the same months the report counts. */
  keepMonth: (ym: string) => boolean;
  excludeTransit: boolean;
  progress?: (stage: string) => void;
};

type PopAcc = { type: string; images: number; coded: number; suspicion: number; transit: number };
type LevelAcc = { n: number; ok: number; missed: number; falseS: number };
type SampleAcc = { group: string; image: LevelAcc; l1: LevelAcc; l2: LevelAcc };

const POP_HEADER = ["معرف الأشعة", "تاريخ الدخول", "السنة", "الربع", "الشهر", "المنفذ", "المنفذ في الملف", "نوع المنفذ", "كود موظف المستوى الأول", "كود موظف المستوى الثاني", "نتيجة المستوى الأول", "نتيجة المستوى الثاني", "اشتباه (أي مستوى)", "ترانزيت", "الورقة المصدر"];
const SAMPLE_HEADER = ["معرف الأشعة", "المنفذ", "نوع المنفذ", "سنة التقاط الصورة", "شهر الدخول", "الربع", "حالة نتيجة الصورة", "توائم الصورة", "كود موظف المستوى الأول", "موظف المستوى الأول", "حالة المستوى الأول", "توائم المستوى الأول", "كود موظف المستوى الثاني", "موظف المستوى الثاني", "حالة المستوى الثاني", "توائم المستوى الثاني"];

export async function buildDataWorkbook(input: DataWorkbookInput): Promise<Blob> {
  const say = input.progress ?? (() => undefined);
  const canon = (p: string) => input.portNames[p] ?? p;
  const kept = (r: PopulationRow) => input.keepMonth(r.day.slice(0, 7)) && !(input.excludeTransit && r.transit);

  // Pass 1 (counts only): rows per quarter decide quarter vs month sheets.
  say("حساب أحجام الأرباع");
  const perQuarter = new Map<string, number>();
  await input.readPopulation((r) => {
    if (!kept(r)) return;
    const q = quarterOf(r.day.slice(0, 7));
    perQuarter.set(q, (perQuarter.get(q) ?? 0) + 1);
  });
  const popKey = (ym: string) => ((perQuarter.get(quarterOf(ym)) ?? 0) > QUARTER_ROW_LIMIT ? `${quarterOf(ym)}-M${ym.slice(5, 7)}` : quarterOf(ym));

  // Pass 2: the rows themselves, and the population dashboard.
  say("كتابة بيانات المجتمع");
  const pop = new SheetSet(POP_HEADER);
  const popDash = new Map<string, Map<string, PopAcc>>();
  await input.readPopulation((r) => {
    if (!kept(r)) return;
    const ym = r.day.slice(0, 7);
    const key = popKey(ym);
    const port = canon(r.port);
    pop.row(`مجتمع ${key}`, [r.id, r.day, Number(ym.slice(0, 4)), quarterOf(ym).slice(5), Number(ym.slice(5, 7)), port, r.port === port ? "" : r.port, r.type, r.c1, r.c2, r.r1, r.r2, r.suspicious ? "نعم" : "لا", r.transit ? "نعم" : "", r.sheet]);
    const byPort = popDash.get(key) ?? new Map<string, PopAcc>();
    popDash.set(key, byPort);
    const a = byPort.get(port) ?? { type: r.type, images: 0, coded: 0, suspicion: 0, transit: 0 };
    a.images++;
    if (r.c1 || r.c2) a.coded++;
    if (r.suspicious) a.suspicion++;
    if (r.transit) a.transit++;
    byPort.set(port, a);
  });

  // Samples: one sheet per quarter of the entry month, and the sample dashboard.
  say("كتابة العينة");
  const sample = new SheetSet(SAMPLE_HEADER);
  const sampleDash = new Map<string, Map<string, SampleAcc>>();
  const lvl = (): LevelAcc => ({ n: 0, ok: 0, missed: 0, falseS: 0 });
  const add = (a: LevelAcc, status: string, match: boolean) => {
    a.n++;
    if (match) a.ok++;
    if (status === "اشتباه فائت") a.missed++;
    else if (status === "اشتباه خاطئ") a.falseS++;
  };
  for (const s of input.studies) {
    const key = s.monthKey ? quarterOf(s.monthKey) : "بدون تاريخ";
    sample.row(`عينة ${key}`, [s.id, s.port, s.group, s.year, s.monthKey, key.slice(5), s.imageStatus, s.imageMatch ? 1 : 0, s.l1?.code, s.l1?.name, s.l1?.status, s.l1 ? (s.l1.match ? 1 : 0) : null, s.l2?.code, s.l2?.name, s.l2?.status, s.l2 ? (s.l2.match ? 1 : 0) : null]);
    const byPort = sampleDash.get(key) ?? new Map<string, SampleAcc>();
    sampleDash.set(key, byPort);
    const a = byPort.get(s.port) ?? { group: s.group, image: lvl(), l1: lvl(), l2: lvl() };
    add(a.image, s.imageStatus, s.imageMatch);
    if (s.l1) add(a.l1, s.l1.status, s.l1.match);
    if (s.l2) add(a.l2, s.l2.status, s.l2.match);
    byPort.set(s.port, a);
  }

  // Dashboards: each period by port, then the period total.
  say("إعداد اللوحات");
  const share = (n: number, of: number) => (of ? Math.round((1000 * n) / of) / 10 : null);
  const popSheet = new SheetXml("لوحة المجتمع", ["الفترة", "المنفذ", "نوع المنفذ", "عدد الصور", "صور عليها كود موظف", "نسبة الصور عليها كود %", "صور مشتبه بها (أي مستوى)", "نسبة الاشتباه %", "صور ترانزيت"]);
  for (const key of [...popDash.keys()].sort()) {
    const byPort = popDash.get(key) as Map<string, PopAcc>;
    const t: PopAcc = { type: "", images: 0, coded: 0, suspicion: 0, transit: 0 };
    for (const [port, a] of [...byPort].sort((x, y) => y[1].images - x[1].images)) {
      popSheet.row([key, port, a.type, a.images, a.coded, share(a.coded, a.images), a.suspicion, share(a.suspicion, a.images), a.transit]);
      t.images += a.images; t.coded += a.coded; t.suspicion += a.suspicion; t.transit += a.transit;
    }
    popSheet.row([key, "الإجمالي", "", t.images, t.coded, share(t.coded, t.images), t.suspicion, share(t.suspicion, t.images), t.transit]);
  }
  const sampleSheet = new SheetXml("لوحة العينة", ["الربع", "المنفذ", "نوع المنفذ", "الحالات المدروسة", "نسبة التوائم %", "الاشتباهات الفائتة", "نسبة الفائت %", "الاشتباهات الخاطئة", "نسبة الخاطئ %", "إجابات المستوى الأول", "نسبة التوائم - الأول %", "الفائت - الأول", "الخاطئ - الأول", "إجابات المستوى الثاني", "نسبة التوائم - الثاني %", "الفائت - الثاني", "الخاطئ - الثاني"]);
  const sampleRow = (key: string, port: string, a: SampleAcc) => [key, port, a.group, a.image.n, share(a.image.ok, a.image.n), a.image.missed, share(a.image.missed, a.image.n), a.image.falseS, share(a.image.falseS, a.image.n), a.l1.n, share(a.l1.ok, a.l1.n), a.l1.missed, a.l1.falseS, a.l2.n, share(a.l2.ok, a.l2.n), a.l2.missed, a.l2.falseS];
  for (const key of [...sampleDash.keys()].sort()) {
    const byPort = sampleDash.get(key) as Map<string, SampleAcc>;
    const t: SampleAcc = { group: "", image: lvl(), l1: lvl(), l2: lvl() };
    for (const [port, a] of [...byPort].sort((x, y) => y[1].image.n - x[1].image.n)) {
      sampleSheet.row(sampleRow(key, port, a));
      for (const k of ["image", "l1", "l2"] as const) { t[k].n += a[k].n; t[k].ok += a[k].ok; t[k].missed += a[k].missed; t[k].falseS += a[k].falseS; }
    }
    sampleSheet.row(sampleRow(key, "الإجمالي", t));
  }

  const dataSheets = [...pop.sheets(), ...sample.sheets()];
  const index = new SheetXml("الفهرس", ["الورقة", "عدد الصفوف", "المحتوى"]);
  index.row(["لوحة المجتمع", popSheet.rows - 1, "عدد صور المجتمع لكل فترة ومنفذ، مع الصور التي عليها كود موظف والصور المشتبه بها."]);
  index.row(["لوحة العينة", sampleSheet.rows - 1, "الحالات المدروسة لكل ربع ومنفذ: نسبة التوائم والاشتباهات الفائتة والخاطئة للصورة ولكل مستوى."]);
  for (const s of dataSheets) index.row([s.name, s.rows - 1, s.name.startsWith("مجتمع") ? "صفوف المجتمع بعد المعالجة." : "صفوف نتائج الدراسة بعد المعالجة."]);
  index.row([]);
  for (const note of [
    "قواعد المعالجة:",
    "المجتمع: كل صورة مرة واحدة في الشهر (يُحذف تكرار معرف الأشعة نفسه في الشهر نفسه فقط).",
    `أوراق المجتمع حسب الربع، وإذا تجاوز الربع ${QUARTER_ROW_LIMIT.toLocaleString("en")} صف تُقسم حسب الشهر.`,
    "أوراق 2025: عمودا موظف المستوى الأول والثاني معكوسان في الملف الأصلي، وصُحِّحا هنا.",
    "العينة: الموظف الناقص في نتائج الدراسة يُكمل من المجتمع بنفس معرف الأشعة (أوراق 2026).",
    "أسماء المنافذ موحدة؛ عمود «المنفذ في الملف» يظهر الاسم الأصلي عند اختلافه.",
    input.excludeTransit ? "صفوف الترانزيت مستبعدة." : "صفوف الترانزيت مشمولة ومعلّمة في عمود «ترانزيت».",
  ]) index.row([note]);

  say("ضغط ملف Excel");
  const order = [index, popSheet, sampleSheet, ...dataSheets];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${order.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView rightToLeft="1"/></bookViews><sheets>${order.map((s, i) => `<sheet name="${xmlEsc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${order.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${order.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`);
  order.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.blob()));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 }, streamFiles: true, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
