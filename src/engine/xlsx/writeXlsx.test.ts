import { beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import { pipeline, sha, sheetAoa, sheetFormulas, unzip } from "../__fixtures__/xlsxKit";
import { ENGINE_VERSION } from "../version";
import { SOURCE_KEY_HEADER, planWorkbook } from "./planWorkbook";
import type { WorkbookPlan } from "./planWorkbook";
import { DEFAULT_COMPANION_FILE, WorkbookRefused, writeXlsx } from "./writeXlsx";
import type { XlsxOutput } from "./writeXlsx";

const OPTS = { title: "تقرير المنافذ", issuedAt: "2026-11-05T09:00:00Z" };

async function build(): Promise<{ out: XlsxOutput; plan: WorkbookPlan; p: ReturnType<typeof pipeline> }> {
  const p = pipeline();
  const plan = planWorkbook(p.files, p.f.spec, p.processed, p.values, p.doc);
  const out = await writeXlsx(plan, { files: p.files, spec: p.f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: p.f.theme }, OPTS);
  return { out, plan, p };
}

let a: Awaited<ReturnType<typeof build>>;
beforeAll(async () => { a = await build(); });

describe("writeXlsx", () => {
  it("returns two workbooks: the report and its companion raw workbook", () => {
    expect(a.out.report.byteLength).toBeGreaterThan(0);
    expect(a.out.companion.byteLength).toBeGreaterThan(0);
    expect(a.out.companionFileName).toBe(DEFAULT_COMPANION_FILE);
  });

  it("raw sheet keeps upload headers and every cell untouched, including the two type-error cells", () => {
    const aoa = sheetAoa(a.out.companion, "studies.xlsx نتائج الدراسة");
    expect(aoa[0]).toEqual(FIXTURE_FILES[0].sheets[0].headers);
    expect(aoa.slice(1)).toEqual(FIXTURE_FILES[0].sheets[0].rows);
    expect(aoa.slice(1).flat()).toEqual(expect.arrayContaining(["غير متوفر", "12,5"]));
  });

  it("the report holds no raw sheet; the companion holds no processed one", async () => {
    const report = await unzip(a.out.report);
    expect(report.text("xl/workbook.xml")).not.toContain("studies.xlsx");
    expect((await unzip(a.out.companion)).list(/^xl\/tables\//)).toEqual([]);
  });

  it("step sheets show in - removed = out in B4:D4 and the removed rows", () => {
    const s1 = sheetAoa(a.out.report, "استبعاد الحالة الفارغة");
    expect(s1[2].slice(1, 4)).toEqual(["قبل", "المستبعد", "بعد"]);
    expect(s1[3].slice(1, 4)).toEqual([12, 1, 11]);
    expect(s1[8].slice(0, 4)).toEqual(["المنفذ", "نوع المنفذ", "الحالة", "العدد"]);
    expect(s1[9].slice(0, 2)).toEqual(["البطحاء", "بري"]);
    const s2 = sheetAoa(a.out.report, "حذف التكرار");
    expect(s2[3].slice(1, 4)).toEqual([11, 1, 10]);
    expect(s2[9].slice(0, 4)).toEqual(["جدة", "بحري", "مطابق", 600]);
  });

  it("every non-raw sheet opens with the header block", () => {
    for (const name of ["الفهرس", "استبعاد الحالة الفارغة", "الدراسات", "الإحصائيات", "المصدر"]) {
      const aoa = sheetAoa(a.out.report, name);
      expect([aoa[2][0], aoa[3][0], aoa[4][0], aoa[5][0]]).toEqual(["الصفوف", "العدد", "يقرأ من", "القاعدة"]);
    }
  });

  it("links to the companion with relative external hyperlinks from the cover and each processing sheet", async () => {
    const z = await unzip(a.out.report);
    const encoded = encodeURI(DEFAULT_COMPANION_FILE);
    const sheetNo = (name: string) => a.plan.sheets.findIndex((s) => s.name === name) + 1;
    for (const name of ["الفهرس", "استبعاد الحالة الفارغة", "حذف التكرار"]) {
      const rels = z.text(`xl/worksheets/_rels/sheet${sheetNo(name)}.xml.rels`);
      expect(rels).toContain(`Target="${encoded}"`);
      expect(rels).toContain('TargetMode="External"');
    }
    const back = (await unzip(a.out.companion)).text("xl/worksheets/_rels/sheet1.xml.rels");
    expect(back).toContain(`Target="${encodeURI("مصنف التقرير.xlsx")}"`);
  });

  it("table and pivot parts match the plan counts; caches have saveData=0 refreshOnLoad=1 and no records", async () => {
    const z = await unzip(a.out.report);
    expect(z.list(/^xl\/tables\/table\d+\.xml$/)).toHaveLength(2);
    expect(z.list(/^xl\/pivotTables\/pivotTable\d+\.xml$/)).toHaveLength(a.plan.sheets.flatMap((s) => s.pivots ?? []).length);
    const caches = z.list(/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/);
    expect(caches).toHaveLength(3);
    caches.forEach((p) => {
      expect(z.text(p)).toContain('saveData="0"');
      expect(z.text(p)).toContain('refreshOnLoad="1"');
    });
    expect(z.list(/pivotCacheRecords/)).toEqual([]);
    expect(z.text("xl/tables/table1.xml")).toContain('name="جدول_الدراسات"');
    expect(z.text("xl/tables/table2.xml")).toContain('name="جدول_مصدر_الأرقام"');
  });

  it("every pivot field names a column of its source table", async () => {
    const z = await unzip(a.out.report);
    for (const p of z.list(/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/)) {
      const table = /worksheetSource name="([^"]+)"/.exec(z.text(p))?.[1];
      const t = z.list(/^xl\/tables\/table\d+\.xml$/).map((x) => z.text(x)).find((x) => x.includes(`name="${table}"`)) ?? "";
      const tableCols = [...t.matchAll(/<tableColumn [^>]*name="([^"]+)"/g)].map((m) => m[1]);
      const cacheCols = [...z.text(p).matchAll(/<cacheField name="([^"]+)"/g)].map((m) => m[1]);
      expect(cacheCols).toEqual(tableCols);
    }
  });

  it("الإحصائيات carries the translated Excel formula for matchRate", () => {
    expect(sheetFormulas(a.out.report, "الإحصائيات")).toContain('IFERROR(COUNTIFS(جدول_الدراسات[الحالة],"مطابق")/COUNTIFS(جدول_الدراسات[الحالة],"<>"),"-")');
  });

  it("a measure Excel cannot express keeps the engine value and an engine-only note", async () => {
    const f = twoSlideFixture();
    f.spec.model.measures.push({ id: "ports", label: "عدد المنافذ", datasetId: "studies", formula: "distinctCount([المنفذ])", format: { kind: "int", digits: 0 } });
    f.spec.pages[0].visuals[1].wells.values?.push({ measure: "ports" });
    const p = pipeline(f);
    const plan = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc);
    const out = await writeXlsx(plan, { files: p.files, spec: f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: f.theme }, OPTS);
    const row = sheetAoa(out.report, "الإحصائيات").find((r) => r[3] === "عدد المنافذ");
    expect(row?.slice(5, 7)).toEqual([3, 3]);
    expect(String(row?.[7])).toContain("الصيغة في المحرك فقط");
  });

  it("a top-N total (limit others:false) is engine-only: no formula, the engine value cached, labelled «(أعلى N)»", async () => {
    const f = twoSlideFixture();
    // Five ports, the first with four matched rows and an unmatched one, so the kept-rows rate differs from the full one.
    const files = structuredClone(FIXTURE_FILES);
    const rows: unknown[][] = [];
    for (let i = 0; i < 5; i++) for (let c = 0; c < (i === 0 ? 4 : 2); c++) rows.push([`منفذ ${i}`, "بري", i === 4 ? "غير مطابق" : "مطابق", i * 10 + c]);
    files[0].sheets[0].rows = rows;
    for (const pg of f.spec.pages) for (const v of pg.visuals) if (v.type === "barChart") v.limit = { topN: 3, others: false };
    const p = pipeline(f, files);
    const total = [...p.values.values()].find((v) => v.key.includes("~top3"));
    if (total === undefined) throw new Error("no top-N total");
    const plan = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc);
    const out = await writeXlsx(plan, { files: p.files, spec: f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: f.theme }, OPTS);
    const aoa = sheetAoa(out.report, "الإحصائيات");
    const r = aoa.findIndex((row) => String(row[3]).includes("(أعلى 3)"));
    expect(r).toBeGreaterThan(-1);
    expect(aoa[r].slice(5, 7)).toEqual([total.value, total.value]);
    expect(String(aoa[r][7])).toContain("الصيغة في المحرك فقط");
    const ws = XLSX.read(out.report, { type: "array", cellFormula: true }).Sheets["الإحصائيات"]!;
    expect(ws[XLSX.utils.encode_cell({ r, c: 6 })]?.f).toBeUndefined();
  });

  it("المصدر has one row per layout figure, a value key column first and the engine version", () => {
    const aoa = sheetAoa(a.out.report, "المصدر");
    const h = aoa.findIndex((r) => r[0] === SOURCE_KEY_HEADER);
    expect(aoa.length - h - 1).toBe(a.p.doc.figures.length);
    expect(aoa[h + 1]).toContain(ENGINE_VERSION);
    expect(aoa.slice(h + 1).map((r) => r[0])).toEqual(a.p.doc.figures.map((f) => f.valueKey));
  });

  it("[Content_Types].xml declares every added part and no dangling relationship", async () => {
    const z = await unzip(a.out.report);
    const ct = z.text("[Content_Types].xml");
    z.list(/^xl\/(tables|pivotTables|pivotCache)\/.+\.xml$/).forEach((p) => expect(ct).toContain(`PartName="/${p}"`));
    expect(ct).not.toContain('Extension="bin"');
    for (const rels of z.list(/\.rels$/)) {
      const dir = rels.replace(/_rels\/[^/]*\.rels$/, "");
      for (const m of z.text(rels).matchAll(/<Relationship [^>]*\/>/g)) {
        if (m[0].includes('TargetMode="External"')) continue;
        const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? "";
        const parts = (dir + target).split("/").reduce<string[]>((acc, s) => (s === ".." ? acc.slice(0, -1) : [...acc, s]), []);
        expect(z.names).toContain(parts.join("/"));
      }
    }
  });

  it("keeps the package root relationships in both workbooks (regression: clean-up emptied _rels/.rels)", async () => {
    for (const bytes of [a.out.report, a.out.companion]) {
      const rels = (await unzip(bytes)).text("_rels/.rels");
      expect(rels).toContain('Target="xl/workbook.xml"');
      expect(rels).toContain('Target="docProps/core.xml"');
      expect(rels).toContain('Target="docProps/app.xml"');
    }
  });

  it("package clean-up drops a relationship to a missing part and its override", async () => {
    const JSZip = (await import("jszip")).default;
    const { cleanPackage } = await import("./ooxmlParts");
    const zip = await JSZip.loadAsync(a.out.report);
    zip.remove("xl/metadata.xml");
    await cleanPackage(zip);
    expect(await zip.file("xl/_rels/workbook.xml.rels")?.async("string")).not.toContain("metadata.xml");
    expect(await zip.file("[Content_Types].xml")?.async("string")).not.toContain("/xl/metadata.xml");
  });

  it("styles: theme font as Normal, the Deck3 table style, right-to-left views, black separators", async () => {
    const z = await unzip(a.out.report);
    expect(z.text("xl/styles.xml")).toMatch(new RegExp(`<fonts count="\\d+"><font><sz val="11"/><color rgb="[0-9A-F]{8}"/><name val="${a.p.f.theme.font}"/>`));
    expect(z.text("xl/styles.xml")).toContain('defaultTableStyle="Deck3"');
    const sep = a.plan.sheets.findIndex((s) => s.name === "|") + 1;
    expect(z.text(`xl/worksheets/sheet${sep}.xml`)).toContain('showRowColHeaders="0"');
    expect(z.text(`xl/worksheets/sheet${sep}.xml`)).toContain("<sheetData/>");
    expect(z.text(`xl/worksheets/sheet${sep}.xml`)).toContain('<tabColor indexed="8"/>');
    z.list(/^xl\/worksheets\/sheet\d+\.xml$/).forEach((p) => expect(z.text(p)).toContain('rightToLeft="1"'));
  });

  it("zip entries and core dates come from issuedAt", async () => {
    const z = await unzip(a.out.report);
    expect(z.text("docProps/core.xml")).toContain("2026-11-05T09:00:00Z");
    const JSZip = (await import("jszip")).default;
    const raw = await JSZip.loadAsync(a.out.report);
    const dates = new Set(Object.values(raw.files).map((f) => f.date.getTime()));
    expect(dates.size).toBe(1);
  });

  it("refuses to write when a visible name looks like an id or a numbered step", async () => {
    const f = twoSlideFixture();
    f.spec.datasets[0].steps[0].label = "خطوة 1 تنظيف";
    const p = pipeline(f);
    const plan = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc);
    await expect(writeXlsx(plan, { files: p.files, spec: f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: f.theme }, OPTS))
      .rejects.toBeInstanceOf(WorkbookRefused);
  });

  it("byte-identical across two calls", async () => {
    const b = await build();
    expect(sha(b.out.report)).toBe(sha(a.out.report));
    expect(sha(b.out.companion)).toBe(sha(a.out.companion));
  });
});

describe("writeXlsx fix round 1", () => {
  it("writes XML-invalid characters as _xHHHH_ and keeps newlines in attributes", async () => {
    const { esc } = await import("./ooxmlParts");
    expect(esc("a\x0Bb\x01c\nd")).toBe("a_x000B_b_x0001_c&#10;d");
    const f = twoSlideFixture();
    f.spec.datasets[0].columns[1].label = "نوع\x0B المنفذ\n";
    const files = structuredClone(FIXTURE_FILES);
    files[0].sheets[0].rows[0][1] = "بحري\x01";
    const p = pipeline(f, files);
    const plan = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc);
    const out = await writeXlsx(plan, { files: p.files, spec: f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: f.theme }, OPTS);
    const z = await unzip(out.report);
    const parts = z.list(/^xl\/(tables|pivotTables|pivotCache)\/.+\.xml$/).map((x) => z.text(x));
    expect(parts.join("")).toContain("نوع_x000B_ المنفذ&#10;");
    // eslint-disable-next-line no-control-regex -- asserts no raw control character survives
    parts.forEach((x) => expect(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(x)).toBe(false));
    expect(parts.join("")).toContain("بحري_x0001_");
  });

  it("dedupes cache items that differ only by case or surrounding spaces", async () => {
    const files = structuredClone(FIXTURE_FILES);
    const rows = files[0].sheets[0].rows;
    rows[0][1] = "Sea"; rows[1][1] = "SEA"; rows[6][1] = " sea "; rows[10][1] = "Sea"; rows[11][1] = "Sea";
    const p = pipeline(twoSlideFixture(), files);
    const plan = planWorkbook(p.files, p.f.spec, p.processed, p.values, p.doc);
    const out = await writeXlsx(plan, { files: p.files, spec: p.f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: p.f.theme }, OPTS);
    const z = await unzip(out.report);
    const cache = z.text("xl/pivotCache/pivotCacheDefinition1.xml");
    const items = [...cache.matchAll(/<s v="([^"]*)"\/>/g)].map((m) => m[1].trim().toLowerCase());
    expect(items.filter((i) => i === "sea")).toHaveLength(1);
    const pivot = z.text("xl/pivotTables/pivotTable1.xml");
    const k = /<sharedItems[^>]*count="(\d+)"/.exec(cache)?.[1];
    expect(pivot).toContain(`<items count="${Number(k) + 1}">`);
  });
});
