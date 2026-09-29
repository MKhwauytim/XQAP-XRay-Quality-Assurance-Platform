// C2: a row is CertScan when its port is flagged as a whole
// (PopulationConfig.certScanPorts) OR its id matches the pasted CertScan
// device list — a union. Unflagged ports keep today's list-only behaviour.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { processPopulation } from "./populationProcessor";
import { UNSPECIFIED_PORT } from "../../../../../data/distribution/portEligibility";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../riskData/riskDataTypes";

function riskRow(xrayImageId: string, portName: string, sourceRowNumber: number): NormalizedRiskRow {
  return {
    movementType: "بري",
    portCode: "P1",
    portName,
    portType: "بري",
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    transitDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    manifestDate: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    xrayImageId,
    xrayEntryDate: "2026-05-04",
    targetedByRiskEngine: null,
    riskMessage: null,
    stage: "FIRST_STAGE",
    sourceSheetName: "بري",
    sourceRowNumber,
  };
}

function workbook(rows: NormalizedRiskRow[]): RiskWorkbookResult {
  return {
    rows,
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0,
  };
}

// Device-code-anchored ids (shape A: [device][YYYYMMDD][sequence]); the paste
// lists device 96601PB04 for منفذ ب only.
const ROWS = [
  riskRow("96601PB04202605040001", "منفذ أ", 2),
  riskRow("96601PB04202605040002", "منفذ ب", 3),
  riskRow("77777XX99202605040003", "منفذ ب", 4),
  riskRow("55555YY11202605040004", "منفذ ج", 5),
];
const PASTE = "Port Name\tSystem S/N\nمنفذ ب\t96601PB04";

function statusById(rows: Array<{ xrayImageId: string; certScanStatus: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.xrayImageId, row.certScanStatus]));
}

describe("processPopulation — whole-port CertScan flags (C2)", () => {
  it("flags every row of a flagged port, unions with the pasted list, leaves other ports alone", async () => {
    const result = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
      certScanPorts: ["منفذ أ"],
    });
    expect(statusById(result.preparedRows)).toEqual({
      "96601PB04202605040001": "Certscan", // flagged port
      "96601PB04202605040002": "Certscan", // list match
      "77777XX99202605040003": "NonCertscan",
      "55555YY11202605040004": "NonCertscan",
    });
    expect(result.summary.certScanRows).toBe(2);
    expect(result.summary.nonCertScanRows).toBe(2);
    const flagged = result.preparedRows.find((row) => row.xrayImageId === "96601PB04202605040001")!;
    expect(flagged.certScanSnippet).toBeNull();
  });

  it("a flagged port alone (no paste) still counts as CertScan provided", async () => {
    const result = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: "",
      certScanPorts: ["منفذ ج"],
    });
    expect(statusById(result.preparedRows)["55555YY11202605040004"]).toBe("Certscan");
    expect(result.summary.certScanRows).toBe(1);
    expect(result.summary.certScanProvided).toBe(true);
  });

  it("no flagged ports: identical to the list-only behaviour", async () => {
    const withEmpty = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
      certScanPorts: [],
    });
    const withoutField = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: PASTE,
    });
    expect(statusById(withEmpty.preparedRows)).toEqual(statusById(withoutField.preparedRows));
    expect(statusById(withoutField.preparedRows)["96601PB04202605040001"]).toBe("NonCertscan");
    expect(withoutField.summary.certScanRows).toBe(1);
  });

  it("a flag with surrounding whitespace still matches (processor trims the flag set)", async () => {
    const result = await processPopulation({
      riskWorkbookResult: workbook(ROWS),
      biWorkbookResult: null,
      certScanPasteText: "",
      certScanPorts: ["  منفذ ج \t"],
    });
    expect(statusById(result.preparedRows)["55555YY11202605040004"]).toBe("Certscan");
    expect(result.summary.certScanRows).toBe(1);
  });
});

// Byte-identity guard: `preC2ProcessingSnapshot.json` is the full
// processPopulation output for ROWS captured BEFORE certScanPorts existed
// (empty paste and PASTE). An omitted or empty flag list must reproduce it
// exactly, so the C2 change can never silently alter default processing.
describe("processPopulation — default output is unchanged by C2", () => {
  const pinned = JSON.parse(
    readFileSync(new URL("./preC2ProcessingSnapshot.json", import.meta.url), "utf8")
  ) as Record<string, unknown>;
  const asPlainJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

  for (const [key, paste] of [["nopaste", ""], ["paste", PASTE]] as const) {
    it(`omitted certScanPorts deep-equals [] and both equal the pre-C2 snapshot (${key})`, async () => {
      const base = { riskWorkbookResult: workbook(ROWS), biWorkbookResult: null, certScanPasteText: paste };
      const omitted = await processPopulation(base);
      const empty = await processPopulation({ ...base, certScanPorts: [] });
      expect(asPlainJson(omitted)).toEqual(asPlainJson(empty));
      expect(asPlainJson(omitted)).toEqual(pinned[key]);
      expect(asPlainJson(empty)).toEqual(pinned[key]);
    });
  }
});

// Intentional: rows with no port are grouped under "غير محدد"
// (normalizePortName), so flagging that name is how an admin marks them.
describe("processPopulation — the unspecified-port flag (C2)", () => {
  it("flagging «غير محدد» marks rows whose port is null, and only those", async () => {
    const nullPortRow = { ...riskRow("88888ZZ22202605040005", "x", 6), portName: null };
    const result = await processPopulation({
      riskWorkbookResult: workbook([...ROWS, nullPortRow]),
      biWorkbookResult: null,
      certScanPasteText: "",
      certScanPorts: [UNSPECIFIED_PORT],
    });
    const status = statusById(result.preparedRows);
    expect(status["88888ZZ22202605040005"]).toBe("Certscan");
    expect(status["55555YY11202605040004"]).toBe("NonCertscan");
    expect(result.summary.certScanRows).toBe(1);
  });
});

