// End-to-end cover for the reported bug: on a UNC/SMB share, executeReplacement
// wrote the replacement sample row, wrote the distribution events, and then
// reported failure because the post-close verification could not yet see its
// own file — leaving the user with
// "تمت إضافة البديل للعينة لكن فشل تسجيل الحدث … A requested file or directory
//  could not be found at the time an operation was processed."
//
// Two things had to change: the transient case must now succeed, and the
// genuinely-failed case must not put raw English DOMException text on an Arabic
// screen.
import { describe, expect, it } from "vitest";
import { createMemoryDirectory, setSimulatedFaults } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "./distributionTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getLabels } from "../labels/labelsStore";
import { executeReplacement } from "./replacement";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { loadDistributionLog } from "./distributionStorage";
import { __resetWrittenSegmentsForTests } from "./distributionEventStore";

const MONTH = "5-May-2026";
const SEGMENT_SUFFIX = ".ndjson";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    stage: "المستوى الأول",
    portName: "PortA",
    certScanStatus: "Certscan",
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
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
    sourceSheetName: "PortA",
    sourceRowNumber: 1,
  } as PreparedPopulationRow;
}

async function seed(root: DirectoryHandleLike, deadRow: PreparedPopulationRow): Promise<void> {
  const sample: SampleMasterData = {
    rngSeed: "123",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 0,
    certScanActual: 0,
    nonCertScanActual: 0,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: new Date().toISOString(),
    drawnBy: "admin",
    rows: [deadRow],
  };
  await saveSampleMaster(root, MONTH, sample);
}

function deadEntryFor(row: PreparedPopulationRow): DistributionEntry {
  return {
    xrayImageId: row.xrayImageId,
    assignedTo: "expert1",
    status: "pending",
    replacedById: null,
    row,
    lastEventAt: new Date().toISOString(),
  };
}

describe("executeReplacement on a flaky network share", () => {
  it("succeeds when the event-segment verification transiently reports NotFoundError", async () => {
    __resetWrittenSegmentsForTests();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1");
    const replacementRow = makeRow("img-2");
    await seed(root, deadRow);

    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        nameSuffix: SEGMENT_SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: 2,
      },
    ]);

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: MONTH,
      deadEntry: deadEntryFor(deadRow),
      replacementRow,
      reason: "صورة غير واضحة",
      eventBy: "supervisor1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The sample row is written exactly once: the append succeeded on the first
    // pass, so nothing about the retry path can duplicate it.
    expect(result.updatedSample.rows.map((row) => row.xrayImageId)).toEqual(["img-1", "img-2"]);
    const persisted = await loadSampleMaster(root, MONTH);
    expect(persisted?.rows.map((row) => row.xrayImageId)).toEqual(["img-1", "img-2"]);

    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((event) => event.eventType)).toEqual(["assigned", "replaced"]);
  });

  it("reports an Arabic failure with no raw DOMException text when the share never recovers", async () => {
    __resetWrittenSegmentsForTests();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1");
    const replacementRow = makeRow("img-2");
    await seed(root, deadRow);

    setSimulatedFaults(root, [
      {
        operation: "getFileHandle",
        nameSuffix: SEGMENT_SUFFIX,
        create: false,
        errorName: "NotFoundError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: MONTH,
      deadEntry: deadEntryFor(deadRow),
      replacementRow,
      reason: "صورة غير واضحة",
      eventBy: "supervisor1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.partialSampleWrite).toBe(true);
    expect(result.error).toContain("تمت إضافة البديل للعينة لكن فشل تسجيل الحدث");
    // Was `msg_unexpected_write_error` — the generic "something failed while
    // saving". `appendDistributionEvents` used to return the raw `.message`
    // here, so the identifying code it had already computed was discarded and
    // the UI fell back to that generic sentence (and to the XQ-IO-028
    // catch-all, which is what got reported from the field). It now classifies
    // the throw, so this NotFoundError arrives as its own Arabic sentence and
    // its own code. Asserting the specific pair is the stronger check.
    // Narrower still than XQ-IO-027: after the retry ladder is exhausted the
    // directory is PROBED, and here it is reachable and writable — so this is a
    // share that lost sight of one entry, and "retry shortly" is correct advice.
    // Had the probe found the directory itself gone, the user would instead be
    // told to re-pick the workspace folder (XQ-IO-030), because retrying could
    // never work. Same DOMException, opposite remedies.
    expect(result.error).toContain(getLabels().err_io_031_share_lost_entry);
    expect(result.error).toContain("XQ-IO-031");
    expect(result.error).not.toContain("XQ-IO-028");
    // The whole point, unchanged: no untranslated Chromium/internal wording
    // reaches the UI. Adding the code must not smuggle the raw detail in with it.
    expect(result.error).not.toMatch(/NotFoundError|Simulated|could not be found/);

    // Reported once, and the partially-written sample row is not duplicated.
    const persisted = await loadSampleMaster(root, MONTH);
    expect(persisted?.rows.map((row) => row.xrayImageId)).toEqual(["img-1", "img-2"]);
  });
});
