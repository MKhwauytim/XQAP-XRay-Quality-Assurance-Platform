import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildIndicatorWorkbook,
  IndicatorTemplateError,
  POPULATION_COLUMNS,
  quarterIndexForMonth,
  SAMPLE_COLUMNS,
  scanIndicatorWorkbook,
} from "./indicatorTemplate";
import { entryText, openZip } from "./zipContainer";

/** A deflated ZIP from name → text, written the way Excel does (no ZIP64, sizes in headers). */
function makeZip(parts: Record<string, string>): Blob {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc32(raw), 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    chunks.push(local, nameBytes, data);
    central.push(record, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([Buffer.concat([...chunks, directory, end])]);
}

const SHARED = ["FIRST_STAGE", "THIRD_STAGE", "IMG-1", "IMG-2", "سليمة"];
const shared = (value: string) => SHARED.indexOf(value);

function table(id: number, name: string, ref: string, columns: string[], calculated: Record<string, string> = {}): string {
  const cols = columns
    .map((column, index) =>
      calculated[column]
        ? `<tableColumn id="${index + 1}" name="${column}"><calculatedColumnFormula>${calculated[column]}</calculatedColumnFormula></tableColumn>`
        : `<tableColumn id="${index + 1}" name="${column}"/>`
    )
    .join("");
  return `<table xmlns="x" id="${id}" name="${name}" displayName="${name}" ref="${ref}"><autoFilter ref="${ref}"/><tableColumns count="${columns.length}">${cols}</tableColumns></table>`;
}

const sheet = (dimension: string, rows: string) =>
  `<worksheet xmlns="x"><dimension ref="${dimension}"/><sheetData>${rows}</sheetData><tableParts count="1"/></worksheet>`;

const POP_COLUMNS = [POPULATION_COLUMNS.stage, POPULATION_COLUMNS.imageId, POPULATION_COLUMNS.month];
const SAMPLE_COLS = [SAMPLE_COLUMNS.stage, SAMPLE_COLUMNS.imageId, SAMPLE_COLUMNS.entryDate, SAMPLE_COLUMNS.captureMonth];

function populationRow(row: number, stage: string, id: string, month: number): string {
  return `<row r="${row}"><c r="A${row}" s="3" t="s"><v>${shared(stage)}</v></c><c r="B${row}" s="3" t="s"><v>${shared(id)}</v></c><c r="C${row}" s="4"><v>${month}</v></c></row>`;
}

function makeWorkbook(): Blob {
  const header = '<row r="2"><c r="A2" t="s"><v>0</v></c></row>';
  const quarterSheets: Record<string, string> = {};
  const rels: string[] = ['<Relationship Id="rId1" Type="t/worksheet" Target="worksheets/sheet1.xml"/>'];
  const sheets: string[] = ['<sheet name="بطاقة العمل" sheetId="1" r:id="rId1"/>'];
  const rowsByQuarter = [
    [populationRow(3, "FIRST_STAGE", "IMG-1", 12), populationRow(4, "THIRD_STAGE", "IMG-2", 1)],
    [populationRow(3, "THIRD_STAGE", "IMG-1", 3)],
    [populationRow(3, "THIRD_STAGE", "IMG-1", 6)],
    [populationRow(3, "FIRST_STAGE", "IMG-1", 9)],
  ];
  rowsByQuarter.forEach((rows, index) => {
    const n = index + 2;
    const quarter = index + 1;
    quarterSheets[`xl/worksheets/sheet${n}.xml`] = sheet(`A1:C${2 + rows.length}`, header + rows.join(""));
    quarterSheets[`xl/worksheets/_rels/sheet${n}.xml.rels`] =
      `<Relationships><Relationship Id="rId1" Type="t/table" Target="../tables/table${quarter}.xml"/></Relationships>`;
    quarterSheets[`xl/tables/table${quarter}.xml`] = table(quarter, `Q${quarter}_`, `A2:C${2 + rows.length}`, POP_COLUMNS);
    rels.push(`<Relationship Id="rId${n}" Type="t/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    sheets.push(`<sheet name="Q${quarter}" sheetId="${n}" r:id="rId${n}"/>`);
  });
  const sampleRow =
    '<row r="3"><c r="A3" s="7" t="s"><v>1</v></c><c r="B3" s="7" t="s"><v>2</v></c><c r="C3" s="9"><v>46053</v></c>' +
    '<c r="D3" s="7"><f>MONTH(Samples[[#This Row],[تاريخ ووقت دخول للاشعة]])</f><v>1</v></c></row>';
  rels.push('<Relationship Id="rId6" Type="t/worksheet" Target="worksheets/sheet6.xml"/>');
  sheets.push('<sheet name="العينة" sheetId="6" r:id="rId6"/>');
  const card =
    '<worksheet xmlns="x"><sheetData><row r="1"><c r="A1"><v>12</v></c><c r="B1"><v>1</v></c></row>' +
    '<row r="6"><c r="G6"><f>COUNTIFS(Q1_[Month],$A$1)</f><v>1</v></c><c r="L6"><f>COUNTIFS(Q1_[Month],$B$1)</f><v>1</v></c></row>' +
    '<row r="7"><c r="F7"><v>2500</v></c></row><row r="8"><c r="F8"><v>1875</v></c></row><row r="9"><c r="F9"><v>1800</v></c></row></sheetData></worksheet>';
  return makeZip({
    "xl/workbook.xml": `<workbook xmlns="x" xmlns:r="r"><sheets>${sheets.join("")}</sheets><definedNames><definedName name="ExternalData_4">العينة!$A$2:$D$3</definedName></definedNames><calcPr calcId="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${rels.join("")}</Relationships>`,
    "xl/worksheets/sheet1.xml": card,
    ...quarterSheets,
    "xl/worksheets/sheet6.xml": sheet("A1:D3", header + sampleRow),
    "xl/worksheets/_rels/sheet6.xml.rels":
      '<Relationships><Relationship Id="rId1" Type="t/table" Target="../tables/table5.xml"/></Relationships>',
    "xl/tables/table5.xml": table(5, "Samples", "A2:D3", SAMPLE_COLS, {
      [SAMPLE_COLUMNS.captureMonth]: "MONTH(Samples[[#This Row],[تاريخ ووقت دخول للاشعة]])",
    }),
    "xl/sharedStrings.xml": `<sst xmlns="x">${SHARED.map((text) => `<si><t>${text}</t></si>`).join("")}</sst>`,
    "xl/styles.xml": "<styleSheet/>",
  });
}

describe("indicator workbook", () => {
  it("maps data months to the quarter tables, with quarters starting in December", () => {
    expect([12, 1, 2].map(quarterIndexForMonth)).toEqual([0, 0, 0]);
    expect([3, 5, 6, 8, 9, 11].map(quarterIndexForMonth)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("reads the counts, the studied ids, the targets and the card months", async () => {
    const baseline = await scanIndicatorWorkbook(makeWorkbook(), "model.xlsx");
    expect(baseline.population).toEqual({
      "12": { FIRST_STAGE: 1 },
      "1": { THIRD_STAGE: 1 },
      "3": { THIRD_STAGE: 1 },
      "6": { THIRD_STAGE: 1 },
      "9": { FIRST_STAGE: 1 },
    });
    expect(baseline.samples).toEqual({ "1": { THIRD_STAGE: 1 } });
    expect(baseline.sampleIds).toEqual(["IMG-1"]);
    expect(baseline.targets).toEqual({ second: 2500, third: 1875, fourth: 1800 });
    expect(baseline.cardMonths.sort((a, b) => a - b)).toEqual([1, 12]);
    expect(baseline.populationTables.map((t) => t.tableName)).toEqual(["Q1_", "Q2_", "Q3_", "Q4_"]);
  });

  it("refuses a workbook that is not the indicator model", async () => {
    const other = makeZip({ "xl/workbook.xml": "<workbook/>", "xl/_rels/workbook.xml.rels": "<Relationships/>" });
    await expect(scanIndicatorWorkbook(other, "other.xlsx")).rejects.toBeInstanceOf(IndicatorTemplateError);
    await expect(scanIndicatorWorkbook(new Blob(["not a zip"]), "x.xlsx")).rejects.toBeInstanceOf(IndicatorTemplateError);
  });

  it("appends rows under the tables and leaves the other parts byte-identical", async () => {
    const file = makeWorkbook();
    const baseline = await scanIndicatorWorkbook(file, "model.xlsx");
    const out = await buildIndicatorWorkbook(file, baseline, [
      {
        tableName: "Q4_",
        rows: [
          {
            [POPULATION_COLUMNS.stage]: { kind: "text", value: "THIRD_STAGE" },
            [POPULATION_COLUMNS.imageId]: { kind: "text", value: "IMG-<9>&" },
            [POPULATION_COLUMNS.month]: { kind: "number", value: 10 },
          },
        ],
      },
      {
        tableName: "Samples",
        rows: [
          {
            [SAMPLE_COLUMNS.stage]: { kind: "text", value: "FIRST_STAGE" },
            [SAMPLE_COLUMNS.imageId]: { kind: "text", value: "IMG-NEW" },
            [SAMPLE_COLUMNS.entryDate]: { kind: "number", value: 46300 },
            [SAMPLE_COLUMNS.captureMonth]: { kind: "number", value: 10 },
          },
        ],
      },
    ]);

    const rescanned = await scanIndicatorWorkbook(out, "out.xlsx");
    expect(rescanned.population["10"]).toEqual({ THIRD_STAGE: 1 });
    expect(rescanned.population["9"]).toEqual({ FIRST_STAGE: 1 });
    expect(rescanned.samples).toEqual({ "1": { THIRD_STAGE: 1 }, "10": { FIRST_STAGE: 1 } });
    expect(rescanned.sampleIds).toEqual(["IMG-1", "IMG-NEW"]);

    const before = await openZip(file);
    const after = await openZip(out);
    expect(after.entries.map((entry) => entry.name)).toEqual(before.entries.map((entry) => entry.name));
    for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/sharedStrings.xml", "xl/styles.xml"]) {
      expect(await entryText(after, name)).toBe(await entryText(before, name));
    }

    const samples = await entryText(after, "xl/worksheets/sheet6.xml");
    expect(samples).toContain('<dimension ref="A1:D4"/>');
    // The calculated column keeps the table formula, the style comes from the row above.
    expect(samples).toContain(
      '<c r="D4" s="7"><f>MONTH(Samples[[#This Row],[تاريخ ووقت دخول للاشعة]])</f><v>10</v></c>'
    );
    expect(samples).toContain('<c r="C4" s="9"><v>46300</v></c>');
    expect(await entryText(after, "xl/worksheets/sheet5.xml")).toContain("IMG-&lt;9&gt;&amp;");
    expect(await entryText(after, "xl/tables/table5.xml")).toContain('ref="A2:D4"');
    expect(await entryText(after, "xl/tables/table4.xml")).toContain('<autoFilter ref="A2:C4"/>');
    const workbook = await entryText(after, "xl/workbook.xml");
    expect(workbook).toContain("العينة!$A$2:$D$4");
    expect(workbook).toContain('<calcPr fullCalcOnLoad="1" calcId="1"/>');
  });

  it("returns the same parts when there is nothing to append", async () => {
    const file = makeWorkbook();
    const baseline = await scanIndicatorWorkbook(file, "model.xlsx");
    const out = await buildIndicatorWorkbook(file, baseline, [{ tableName: "Q1_", rows: [] }]);
    const before = await openZip(file);
    const after = await openZip(out);
    for (const entry of before.entries) expect(await entryText(after, entry.name)).toBe(await entryText(before, entry.name));
  });
});

// Run against the owner's real workbook: INDICATOR_FILE="C:/…/المؤشر بعد التعديل.xlsx" npx vitest run <this file>
const realFile = process.env.INDICATOR_FILE;
describe.skipIf(!realFile)("indicator workbook — real file", () => {
  it("matches the card's own cached figures and survives an append", async () => {
    const file = new Blob([readFileSync(realFile as string)]);
    const baseline = await scanIndicatorWorkbook(file, "real.xlsx");
    console.log(JSON.stringify({ population: baseline.population, samples: baseline.samples, targets: baseline.targets, cardMonths: baseline.cardMonths, sampleIds: baseline.sampleIds.length }));
    // بطاقة العمل, block «يناير» (data month 12): G6:G9 and I6:I9.
    expect(baseline.population["12"]).toEqual({ FIRST_STAGE: 384, SECOND_STAG: 2829, THIRD_STAGE: 55178, FORTH_STAGE: 13628 });
    expect(baseline.samples["12"]).toEqual({ FIRST_STAGE: 140, SECOND_STAG: 2589, THIRD_STAGE: 5310, FORTH_STAGE: 3817 });
    expect(baseline.sampleIds.length).toBeGreaterThan(80000);

    const out = await buildIndicatorWorkbook(file, baseline, [
      {
        tableName: "Q4_",
        rows: [
          {
            [POPULATION_COLUMNS.stage]: { kind: "text", value: "FIRST_STAGE" },
            [POPULATION_COLUMNS.imageId]: { kind: "text", value: "TEST-IMG-1" },
            [POPULATION_COLUMNS.month]: { kind: "number", value: 10 },
          },
        ],
      },
      {
        tableName: "Samples",
        rows: [
          {
            [SAMPLE_COLUMNS.stage]: { kind: "text", value: "FIRST_STAGE" },
            [SAMPLE_COLUMNS.imageId]: { kind: "text", value: "TEST-IMG-1" },
            [SAMPLE_COLUMNS.entryDate]: { kind: "number", value: 46300.5 },
            [SAMPLE_COLUMNS.captureMonth]: { kind: "number", value: 10 },
          },
        ],
      },
    ]);
    const rescanned = await scanIndicatorWorkbook(out, "out.xlsx");
    expect(rescanned.population["10"]).toEqual({ FIRST_STAGE: 1 });
    expect(rescanned.population["12"]).toEqual(baseline.population["12"]);
    expect(rescanned.sampleIds.length).toBe(baseline.sampleIds.length + 1);
    if (process.env.INDICATOR_OUT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.INDICATOR_OUT, Buffer.from(await out.arrayBuffer()));
    }
  }, 900_000);
});
