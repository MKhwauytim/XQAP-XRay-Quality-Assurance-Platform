import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import type { PreparedPopulationRow } from "./populationTypes";
import type { PopulationFinalData } from "./monthTypes";
import { saveSampleMaster, loadSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrentForRead,
} from "../distribution/distributionStorage";
import { buildAssignEvent, buildCompletedEvent } from "../distribution/distributionLog";
import { readWorkspaceActions } from "../audit/actionLog";
import { getLabels } from "../labels/labelsStore";
import {
  applyPopulationFieldCorrections,
  computeCorrectionPreview,
  loadCorrectionPopulationIndex,
  parseImportRows,
} from "./populationCorrections";
import { XRAY_IMAGE_ID_HEADER, CORRECTABLE_FIELD_LABEL_KEYS } from "./pendingCorrections";

const MONTH = "5-May-2026";

function makeRow(id: string, portName: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName,
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: "OLD-DECL",
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

async function writePopulationFinal(root: DirectoryHandleLike, rows: PreparedPopulationRow[]): Promise<void> {
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, { create: true });
  const final: PopulationFinalData = {
    sourceMonthFolder: MONTH,
    processedAt: new Date().toISOString(),
    processedBy: "admin",
    totalRows: rows.length,
    certScanRows: 0,
    nonCertScanRows: rows.length,
    rows: rows as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(processedDir, "population.final.json", final);
}

function makeSample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows,
  };
}

/** Population + sample + assignment + completed event, so A1 is a real
 *  distributed row whose embedded mirror stub can be inspected pre/post fix. */
async function seed(root: DirectoryHandleLike): Promise<void> {
  const rows = [makeRow("A1", "الميناء القديم"), makeRow("A2", "ميناء ب")];
  await writePopulationFinal(root, rows);
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
  ]);
}

describe("parseImportRows + computeCorrectionPreview", () => {
  it("matches by xrayImageId, ignores blank cells, and reports unmatched ids", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    const labels = getLabels();
    const portHeader = labels[CORRECTABLE_FIELD_LABEL_KEYS.portName];
    const declHeader = labels[CORRECTABLE_FIELD_LABEL_KEYS.declarationNumber];
    const headerRow = [XRAY_IMAGE_ID_HEADER, portHeader, declHeader];

    const rows = [
      { [XRAY_IMAGE_ID_HEADER]: "A1", [portHeader]: "الميناء الجديد", [declHeader]: "" },
      { [XRAY_IMAGE_ID_HEADER]: "A2", [portHeader]: "ميناء ب", [declHeader]: "OLD-DECL" }, // no real change
      { [XRAY_IMAGE_ID_HEADER]: "ZZZ", [portHeader]: "غير موجود", [declHeader]: "" },
    ];

    const parsed = parseImportRows(rows, headerRow, labels);
    const index = await loadCorrectionPopulationIndex(root, MONTH);
    const preview = computeCorrectionPreview(parsed, index);

    expect(preview.matchedIds.sort()).toEqual(["A1", "A2"]);
    expect(preview.unmatchedIds).toEqual(["ZZZ"]);
    expect(preview.unchangedIds).toEqual(["A2"]);
    expect(preview.changes).toEqual([
      { xrayImageId: "A1", field: "portName", oldValue: "الميناء القديم", newValue: "الميناء الجديد" },
    ]);
  });
});

describe("applyPopulationFieldCorrections", () => {
  it("patches population.final.json, sample.master.json, and the distribution mirror; logs one audit entry per field", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const result = await applyPopulationFieldCorrections({
      directoryHandle: root,
      monthFolderName: MONTH,
      changes: [
        { xrayImageId: "A1", field: "portName", oldValue: "الميناء القديم", newValue: "الميناء الجديد" },
        { xrayImageId: "A1", field: "declarationNumber", oldValue: "OLD-DECL", newValue: "NEW-DECL" },
      ],
      actorUsername: "sup1",
      actorRole: "supervisor",
    });
    expect(result.ok).toBe(true);

    const sample = await loadSampleMaster(root, MONTH);
    const sampleRow = sample!.rows.find((r) => r.xrayImageId === "A1")!;
    expect(sampleRow.portName).toBe("الميناء الجديد");
    expect(sampleRow.declarationNumber).toBe("NEW-DECL");
    // Untouched field survives the patch.
    const a2 = sample!.rows.find((r) => r.xrayImageId === "A2")!;
    expect(a2.portName).toBe("ميناء ب");

    // Distribution mirror must reflect the correction too — this is the part
    // that would silently stay stale without invalidateDistributionCacheForFieldEdit,
    // because sampleRowsFingerprint is id-set based, not content based.
    const current = await loadOrDeriveDistributionCurrentForRead(root, MONTH, sample!.rows);
    const entry = current?.entries.find((e) => e.xrayImageId === "A1");
    expect(entry?.row.portName).toBe("الميناء الجديد");
    expect(entry?.row.declarationNumber).toBe("NEW-DECL");

    const actions = await readWorkspaceActions(root);
    const applied = actions.filter((a) => a.action === "pending-correction-applied" && a.target === "A1");
    expect(applied).toHaveLength(2);
    expect(applied.some((a) => a.details?.field === "portName" && a.details?.newValue === "الميناء الجديد")).toBe(true);
    expect(applied.some((a) => a.details?.field === "declarationNumber" && a.details?.newValue === "NEW-DECL")).toBe(true);
  });

  it("is a no-op when there are no changes to apply", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);
    const result = await applyPopulationFieldCorrections({
      directoryHandle: root,
      monthFolderName: MONTH,
      changes: [],
      actorUsername: "sup1",
      actorRole: "supervisor",
    });
    expect(result.ok).toBe(true);
    const actions = await readWorkspaceActions(root);
    expect(actions.some((a) => a.action === "pending-correction-applied")).toBe(false);
  });
});
