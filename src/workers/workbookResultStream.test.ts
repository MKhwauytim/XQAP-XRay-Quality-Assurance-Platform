import { describe, expect, it } from "vitest";
import {
  WORKBOOK_ROW_CHUNK_SIZE,
  createWorkbookResultAccumulator,
  streamRowsInChunks,
  type BiFileShell,
  type RiskWorkbookShell
} from "./workbookResultStream";
import type { BiWorkbookResult } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedBiRow } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";

// Minimal but REAL row shapes -- `rawRow` is deliberately populated on every
// fixture row, because it is the field that dominates the payload size this
// module exists to bound (riskDataNormalizer.ts:261, biDataNormalizer.ts:281).
function riskRow(index: number): NormalizedRiskRow {
  return {
    movementType: "بحري",
    portCode: "JED", portName: "ميناء جدة الإسلامي", portType: null,
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: null, transitDeclarationNumber: null,
    declarationDate: null, declarationHijriDate: null,
    manifestNumber: null, manifestType: null, manifestDate: null,
    plateOrContainerNumber: null, finalDestination: null,
    entryDate: null, exitDate: null,
    chassisNumber: null, reportNumber: null, hasReport: false,
    xrayLevelOneResult: null, xrayLevelTwoResult: null, inspectorResult: null,
    oppositeInspectorResult: null, liveMeansResult: null,
    xrayImageId: `XR-${index}`, xrayEntryDate: null,
    targetedByRiskEngine: null, riskMessage: null, stage: null,
    rawRow: { "رقم الأشعة": `XR-${index}`, "عمود إضافي": `v${index}` },
    sourceSheetName: "بحري وارد",
    sourceRowNumber: index + 2
  };
}

function biRow(index: number): NormalizedBiRow {
  return {
    source: "بحري وارد",
    xrayImageId: `XR-${index}`, xrayEntryDate: null,
    portType: null, portCode: null, portName: null,
    movementNumber: null, movementDate: null, movementHijriDate: null,
    declarationNumber: null, preliminaryDeclarationNumber: null,
    declarationDate: null, declarationHijriDate: null,
    inboundOutboundType: null, declarationType: null, declarationStatus: null,
    plateOrContainerNumber: null, chassisNumber: null, governance: null,
    levelOneEmployee: null, levelTwoEmployee: null,
    levelOneResultCode: null, levelTwoResultCode: null,
    levelOneResult: null, levelTwoResult: null,
    manualInspectionResultCode: null, manualInspectionResult: null,
    oppositeInspectionEmployee: null, oppositeInspectionResultCode: null,
    oppositeInspectionResult: null,
    liveMeansEmployee: null, liveMeansResultCode: null, liveMeansResult: null,
    notes: null,
    rawRow: { "رقم الأشعة": `XR-${index}` },
    sourceSheetName: "بحري وارد",
    sourceRowNumber: index + 2
  };
}

function riskResult(rowCount: number): RiskWorkbookResult {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => riskRow(i)),
    sheetSummaries: [{
      sheetName: "بحري وارد", movementType: "بحري",
      originalRowCount: rowCount, normalizedRowCount: rowCount,
      excludedMissingXrayIdCount: 0
    }],
    unknownSheetNames: [],
    totalOriginalRows: rowCount,
    totalNormalizedRows: rowCount,
    totalExcludedMissingXrayIdCount: 0
  };
}

function biResult(rowCount: number): BiWorkbookResult {
  return {
    rows: Array.from({ length: rowCount }, (_, i) => biRow(i)),
    sheetSummaries: [{
      sheetName: "بحري وارد", source: "بحري وارد",
      originalRowCount: rowCount, normalizedRowCount: rowCount,
      excludedMissingXrayIdCount: 0
    }],
    unknownSheetNames: [],
    unmatchedSheetNames: [],
    totalOriginalRows: rowCount,
    totalNormalizedRows: rowCount,
    totalExcludedMissingXrayIdCount: 0
  };
}

describe("streamRowsInChunks", () => {
  it("splits into ceil(n / chunkSize) contiguous, in-order chunks", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => i);
    const chunks: number[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk), 5);

    expect(chunks.map((c) => c.length)).toEqual([5, 5, 2]);
    expect(chunks.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("emits exactly one chunk when the row count equals the chunk size", async () => {
    const chunks: number[][] = [];
    await streamRowsInChunks([1, 2, 3], (chunk) => chunks.push(chunk), 3);
    expect(chunks).toEqual([[1, 2, 3]]);
  });

  it("emits nothing at all for an empty row array", async () => {
    const chunks: number[][] = [];
    await streamRowsInChunks([], (chunk) => chunks.push(chunk), 5);
    expect(chunks).toEqual([]);
  });

  it("passes the SAME row object references through -- never a per-row copy", async () => {
    const rows = [riskRow(0), riskRow(1)];
    const original0 = rows[0];
    const chunks: NormalizedRiskRow[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk), 5);
    expect(chunks[0][0]).toBe(original0);
  });

  it("RELEASES each emitted slice from the source array as it goes (the memory contract)", async () => {
    // This is the half of the fix that keeps the worker from holding the full
    // dataset while the window builds its own copy. Without it, batching alone
    // still leaves both sides fully resident at the same moment.
    const rows = Array.from({ length: 6 }, (_, i) => i);
    const sourceLengthsSeen: Array<Array<number | undefined>> = [];
    await streamRowsInChunks(
      rows,
      () => { sourceLengthsSeen.push([...rows]); },
      2
    );

    // After the LAST emit, every slot the emitter has already handed off is
    // cleared. (The final chunk's own slots are cleared after its emit
    // returns, so the post-call state is the strongest assertion.)
    expect(rows).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    // ...and the release is incremental, not a single wipe at the end: by the
    // time the 2nd chunk is emitted, the 1st chunk's slots are already gone.
    expect(sourceLengthsSeen[1].slice(0, 2)).toEqual([undefined, undefined]);
  });

  it("defaults to WORKBOOK_ROW_CHUNK_SIZE when no size is given", async () => {
    const rows = Array.from({ length: WORKBOOK_ROW_CHUNK_SIZE + 1 }, (_, i) => i);
    const chunks: number[][] = [];
    await streamRowsInChunks(rows, (chunk) => chunks.push(chunk));
    expect(chunks.map((c) => c.length)).toEqual([WORKBOOK_ROW_CHUNK_SIZE, 1]);
  });

  it("keeps the default chunk size bounded -- a regression guard on the whole fix", () => {
    // If a future edit sets this to Infinity/0/NaN the protocol silently
    // reverts to one monolithic message and the OOM comes straight back,
    // with no other test in the repo noticing.
    expect(Number.isInteger(WORKBOOK_ROW_CHUNK_SIZE)).toBe(true);
    expect(WORKBOOK_ROW_CHUNK_SIZE).toBeGreaterThan(0);
    expect(WORKBOOK_ROW_CHUNK_SIZE).toBeLessThanOrEqual(10_000);
  });
});

describe("createWorkbookResultAccumulator", () => {
  it("round-trips a risk result + several BI results back to an IDENTICAL object graph", async () => {
    const risk = riskResult(12);
    const bi0 = biResult(7);
    const bi1 = biResult(0);
    // Snapshot BEFORE streaming -- the emitter deliberately releases (mutates)
    // its source arrays, so the expectation has to be captured up front.
    const expectedRisk = structuredClone(risk);
    const expectedBi0 = structuredClone(bi0);
    const expectedBi1 = structuredClone(bi1);

    const accumulator = createWorkbookResultAccumulator();

    const { rows: riskRows, ...riskShell } = risk;
    await streamRowsInChunks(riskRows, (chunk) => accumulator.acceptRiskRows(chunk), 5);

    const { rows: bi0Rows, ...bi0Shell } = bi0;
    await streamRowsInChunks(bi0Rows, (chunk) => accumulator.acceptBiRows(0, chunk), 5);

    const { rows: bi1Rows, ...bi1Shell } = bi1;
    await streamRowsInChunks(bi1Rows, (chunk) => accumulator.acceptBiRows(1, chunk), 5);

    const biShells: BiFileShell[] = [
      { fileName: "bi-a.xlsx", result: bi0Shell },
      { fileName: "bi-b.csv", result: bi1Shell }
    ];

    const finalized = accumulator.finalize({
      riskResult: riskShell as RiskWorkbookShell,
      biResults: biShells
    });

    expect(finalized.riskResult).toEqual(expectedRisk);
    expect(finalized.biResults).toEqual([
      { fileName: "bi-a.xlsx", result: expectedBi0 },
      { fileName: "bi-b.csv", result: expectedBi1 }
    ]);
  });

  it("carries a SOFT per-file BI failure through untouched (result: null + error)", async () => {
    // biFiles are optional: workbookWorker.ts:51-59 turns a per-file throw into
    // `{ result: null, error }` rather than failing the import. That shape must
    // survive the new protocol byte for byte, since applyBiFileResults keys the
    // red error row off it (usePhaseOneUploads.ts:400-411).
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "broken.xlsx", result: null, error: "ملف تالف" }]
    });

    expect(finalized.biResults).toEqual([
      { fileName: "broken.xlsx", result: null, error: "ملف تالف" }
    ]);
    expect(finalized.biResults[0].result).toBeNull();
  });

  it("does not invent an `error` key on a file that succeeded", async () => {
    const accumulator = createWorkbookResultAccumulator();
    const { rows, ...shell } = biResult(2);
    await streamRowsInChunks(rows, (chunk) => accumulator.acceptBiRows(0, chunk), 5);
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "ok.xlsx", result: shell }]
    });
    expect(Object.prototype.hasOwnProperty.call(finalized.biResults[0], "error")).toBe(false);
  });

  it("keys BI rows by fileIndex, so interleaved chunks never cross-contaminate", async () => {
    // postMessage ordering makes real interleaving impossible today, but keying
    // on fileIndex rather than arrival order is what makes that a property of
    // the code instead of a property of the transport.
    const accumulator = createWorkbookResultAccumulator();
    accumulator.acceptBiRows(1, [biRow(100)]);
    accumulator.acceptBiRows(0, [biRow(0)]);
    accumulator.acceptBiRows(1, [biRow(101)]);
    accumulator.acceptBiRows(0, [biRow(1)]);

    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [
        { fileName: "a.xlsx", result: { ...biResult(0) } },
        { fileName: "b.xlsx", result: { ...biResult(0) } }
      ]
    });

    expect(finalized.biResults[0].result?.rows.map((r) => r.xrayImageId)).toEqual(["XR-0", "XR-1"]);
    expect(finalized.biResults[1].result?.rows.map((r) => r.xrayImageId)).toEqual(["XR-100", "XR-101"]);
  });

  it("gives a BI file that sent no chunks an empty rows array, not undefined", async () => {
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: [{ fileName: "empty.xlsx", result: { ...biResult(0) } }]
    });
    expect(finalized.biResults[0].result?.rows).toEqual([]);
  });

  it("gives an empty risk stream an empty rows array, not undefined", () => {
    const accumulator = createWorkbookResultAccumulator();
    const finalized = accumulator.finalize({
      riskResult: { ...riskResult(0) } as RiskWorkbookShell,
      biResults: []
    });
    expect(finalized.riskResult.rows).toEqual([]);
  });
});
