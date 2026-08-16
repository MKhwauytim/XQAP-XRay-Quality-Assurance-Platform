import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getPopulationMonthDir, getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { POPULATION_SUBFOLDERS } from "../workspace/workspacePaths";
import type { PopulationFinalData } from "../population/monthTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { appendDistributionEvents } from "../distribution/distributionStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { upsertItemAnswer } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import { runPowerBiExport } from "./exportManager";
import type { ExportManifest } from "./exportTypes";

/**
 * GOLDEN MASTER (Slice 0) — `runPowerBiExport`.
 *
 * The Power BI export is an external-contract surface: another tool ingests
 * these CSVs by column name and position. This pins the exact bytes produced
 * for a fixed workspace — header order, row order, escaping/BOM, boolean
 * encoding, and which rows land in which file — as OBSERVED today.
 *
 * `manifest.exportedAt` is excluded from assertions (it is the only
 * non-deterministic value). Everything else is fixed input.
 */

const MONTH = "5-May-2026";
const TEMPLATE_ID = "t1";
// DEFAULT_EXEC_CONFIG.expertResultFieldId — with `template: null` (which is
// what runPowerBiExport always passes) this fallback field id is the ONLY
// answer field the executive row builder can resolve.
const EXPERT_FIELD = "qualityImageResult";

function popRow(over: Partial<PreparedPopulationRow> & { xrayImageId: string }): PreparedPopulationRow {
  return {
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: "1",
    xrayEntryDate: "2026-05-02",
    portCode: "P1",
    portType: "بري",
    declarationNumber: "D-1",
    declarationDate: "2026-05-01",
    plateOrContainerNumber: "PLATE-1",
    chassisNumber: "CH-1",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: "R-1",
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: "L1",
    levelTwoEmployee: "L2",
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
    ...over,
  };
}

const POPULATION_ROWS: PreparedPopulationRow[] = [
  // Sampled + assigned + submitted, expert agrees it is clean.
  popRow({ xrayImageId: "img-1" }),
  // Sampled + assigned + submitted, L2 flagged suspicion the expert confirms.
  popRow({ xrayImageId: "img-2", xrayLevelTwoResult: "اشتباه" }),
  // Sampled + assigned, no answer.
  popRow({ xrayImageId: "img-3", portName: "بحري", portCode: "P2" }),
  // Not sampled. Carries a comma and a leading "=" to exercise CSV escaping
  // and the formula-injection guard.
  popRow({ xrayImageId: "img-4", portName: "بري, الشرقية", stage: "=2+2" }),
];

const SAMPLE: SampleMasterData = {
  rngSeed: "golden",
  samplingAlgorithmVersion: "1.0",
  totalRequested: 3,
  totalActual: 3,
  certScanRequested: 0,
  nonCertScanRequested: 3,
  certScanActual: 0,
  nonCertScanActual: 3,
  portAllocations: [],
  stageAllocations: [],
  certScanShortfalls: [],
  drawnAt: "2026-05-01T00:00:00.000Z",
  drawnBy: "admin",
  rows: POPULATION_ROWS.slice(0, 3),
};

function assignEvent(id: string, xrayImageId: string, assignedTo: string, at: string): DistributionEvent {
  return {
    eventId: id,
    eventSchemaVersion: 1,
    eventType: "assigned",
    xrayImageId,
    assignedTo,
    eventAt: at,
    eventBy: "admin",
  };
}

function answer(xrayImageId: string, expert: "سليمة" | "اشتباه"): ItemAnswer {
  return {
    xrayImageId,
    templateId: TEMPLATE_ID,
    templateVersion: 1,
    answers: [{ fieldId: EXPERT_FIELD, value: expert }],
    lastSavedAt: "2026-05-06T00:00:00.000Z",
    submittedAt: "2026-05-06T00:00:00.000Z",
    answeredBy: "emp-a",
    status: "submitted",
  };
}

async function seedWorkspace(): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as DirectoryHandleLike;

  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const processedDir = await monthDir.getDirectoryHandle(POPULATION_SUBFOLDERS.processed, {
    create: true,
  });
  const finalData: PopulationFinalData = {
    sourceMonthFolder: MONTH,
    processedAt: "2026-05-01T00:00:00.000Z",
    processedBy: "admin",
    totalRows: POPULATION_ROWS.length,
    certScanRows: 0,
    nonCertScanRows: POPULATION_ROWS.length,
    rows: POPULATION_ROWS as unknown as Array<Record<string, unknown>>,
  };
  await safeWriteJson(processedDir, "population.final.json", finalData);

  await saveSampleMaster(root, MONTH, SAMPLE);
  await appendDistributionEvents(root, MONTH, [
    assignEvent("e1", "img-1", "emp-a", "2026-05-04T08:00:00.000Z"),
    assignEvent("e2", "img-2", "emp-a", "2026-05-04T08:00:01.000Z"),
    assignEvent("e3", "img-3", "emp-b", "2026-05-04T08:00:02.000Z"),
    {
      eventId: "e4",
      eventSchemaVersion: 1,
      eventType: "completed",
      xrayImageId: "img-1",
      assignedTo: "emp-a",
      eventAt: "2026-05-06T08:00:00.000Z",
      eventBy: "emp-a",
    },
  ]);

  await upsertItemAnswer(root, MONTH, "emp-a", answer("img-1", "سليمة"));
  await upsertItemAnswer(root, MONTH, "emp-a", answer("img-2", "اشتباه"));

  return root;
}

async function readCsv(root: DirectoryHandleLike, fileName: string): Promise<string> {
  const sys = await getSystemRoot(root, false);
  const expRoot = await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: false });
  const dir = await expRoot.getDirectoryHandle(MONTH, { create: false });
  const handle = await dir.getFileHandle(fileName, { create: false });
  return (await handle.getFile()).text();
}

async function readCsvBytes(root: DirectoryHandleLike, fileName: string): Promise<ArrayBuffer> {
  const sys = await getSystemRoot(root, false);
  const expRoot = await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: false });
  const dir = await expRoot.getDirectoryHandle(MONTH, { create: false });
  const handle = await dir.getFileHandle(fileName, { create: false });
  return (await handle.getFile()).arrayBuffer();
}

/** Drops the only non-deterministic field on the manifest. */
function omitExportedAt(manifest: ExportManifest): Omit<ExportManifest, "exportedAt"> {
  const copy: Partial<ExportManifest> = { ...manifest };
  delete copy.exportedAt;
  return copy as Omit<ExportManifest, "exportedAt">;
}

describe("runPowerBiExport — golden master", () => {
  it("pins the manifest and the exported file set", async () => {
    const root = await seedWorkspace();
    const manifest = await runPowerBiExport(root, MONTH);
    const rest = omitExportedAt(manifest);
    expect(rest).toEqual({
      month: MONTH,
      files: [
        { fileName: "population.csv", rowCount: 4 },
        { fileName: "sample.csv", rowCount: 3 },
      ],
    });
  });

  it("pins the exact population.csv bytes", async () => {
    const root = await seedWorkspace();
    await runPowerBiExport(root, MONTH);
    const csv = await readCsv(root, "population.csv");

    // The file really does start with a UTF-8 BOM (so Excel opens the Arabic
    // correctly) — but `File.text()` decodes UTF-8 and strips it, which is why
    // the snapshot below starts straight at "xrayImageId". Checked on the raw
    // bytes instead.
    const raw = new Uint8Array(await readCsvBytes(root, "population.csv"));
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.charCodeAt(0)).toBe("x".charCodeAt(0));
    // Booleans are written as 1/0, nulls as empty cells.
    expect(csv).toContain(",1,emp-a,completed,");
    // Formula-injection guard: a leading "=" is neutralized with an apostrophe,
    // and a value containing a comma is quoted.
    expect(csv).toContain(`"بري, الشرقية",بري,'=2+2`);
    // SURPRISE: the `assignedAt` column is populated from
    // `DistributionEntry.lastEventAt` (executiveReportData.ts's row builder),
    // i.e. the timestamp of the LAST event on the image, not the assignment.
    // img-1 was assigned at 2026-05-04T08:00:00Z and completed at
    // 2026-05-06T08:00:00Z — the export reports the completion time under a
    // column named `assignedAt`, and it is the later of the two.
    expect(csv).toContain("submitted,2026-05-06T08:00:00.000Z,2026-05-06T00:00:00.000Z");

    expect(csv).toMatchInlineSnapshot(`
      "xrayImageId,portName,portType,stage,levelOneResult,levelTwoResult,imageResult,selectedInSample,assignedTo,distributionStatus,expertResult,imageAvailable,noImageReason,hasMarking,imageQuality,lowQualityReason,suspicionLevel,suspectedTypes,smuggleMethod,answerStatus,assignedAt,submittedAt,imageResultAccurate,levelOneAccurate,levelTwoAccurate,verificationCategory
      img-1,بري,بري,1,سليمة,سليمة,سليمة,1,emp-a,completed,سليمة,,,,,,,,,submitted,2026-05-06T08:00:00.000Z,2026-05-06T00:00:00.000Z,1,1,1,correct-clean
      img-2,بري,بري,1,سليمة,اشتباه,اشتباه,1,emp-a,pending,اشتباه,,,,,,,,,submitted,2026-05-04T08:00:01.000Z,2026-05-06T00:00:00.000Z,1,0,1,correct-suspicious
      img-3,بحري,بري,1,سليمة,سليمة,سليمة,1,emp-b,pending,,,,,,,,,,,2026-05-04T08:00:02.000Z,,,,,
      img-4,"بري, الشرقية",بري,'=2+2,سليمة,سليمة,سليمة,0,,,,,,,,,,,,,,,,,,"
    `);
  });

  it("pins the exact sample.csv bytes", async () => {
    const root = await seedWorkspace();
    await runPowerBiExport(root, MONTH);
    expect(await readCsv(root, "sample.csv")).toMatchInlineSnapshot(`
      "xrayImageId,portName,portType,stage,levelOneResult,levelTwoResult,imageResult,selectedInSample,assignedTo,distributionStatus,expertResult,imageAvailable,noImageReason,hasMarking,imageQuality,lowQualityReason,suspicionLevel,suspectedTypes,smuggleMethod,answerStatus,assignedAt,submittedAt,imageResultAccurate,levelOneAccurate,levelTwoAccurate,verificationCategory
      img-1,بري,بري,1,سليمة,سليمة,سليمة,1,emp-a,completed,سليمة,,,,,,,,,submitted,2026-05-06T08:00:00.000Z,2026-05-06T00:00:00.000Z,1,1,1,correct-clean
      img-2,بري,بري,1,سليمة,اشتباه,اشتباه,1,emp-a,pending,اشتباه,,,,,,,,,submitted,2026-05-04T08:00:01.000Z,2026-05-06T00:00:00.000Z,1,0,1,correct-suspicious
      img-3,بحري,بري,1,سليمة,سليمة,سليمة,1,emp-b,pending,,,,,,,,,,,2026-05-04T08:00:02.000Z,,,,,"
    `);
  });

  it("pins the export as a pure read — it never persists distribution.current.json", async () => {
    const root = await seedWorkspace();
    await runPowerBiExport(root, MONTH);
    const { getSampleMainDir } = await import("../workspace/workspacePaths");
    const mainDir = await getSampleMainDir(root, MONTH, false);
    await expect(
      mainDir.getFileHandle("distribution.current.json", { create: false })
    ).rejects.toThrow();
  });

  it("pins the empty-month behavior: both CSVs are header-only, still written", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const manifest = await runPowerBiExport(root, "9-September-2026");
    const rest = omitExportedAt(manifest);
    expect(rest).toEqual({
      month: "9-September-2026",
      files: [
        { fileName: "population.csv", rowCount: 0 },
        { fileName: "sample.csv", rowCount: 0 },
      ],
    });
  });

  it("is byte-stable across repeated exports", async () => {
    const root = await seedWorkspace();
    await runPowerBiExport(root, MONTH);
    const first = await readCsv(root, "population.csv");
    await runPowerBiExport(root, MONTH);
    expect(await readCsv(root, "population.csv")).toBe(first);
  });
});
