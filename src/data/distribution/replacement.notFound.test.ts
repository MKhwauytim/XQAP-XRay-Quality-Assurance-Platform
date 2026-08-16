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
import { executeReplacement } from "./replacement";
import { loadSampleMaster, saveSampleMaster } from "../sampling/sampleStorage";
import { appendDistributionEvent, loadDistributionLog } from "./distributionStorage";
import { __resetWrittenSegmentsForTests } from "./distributionEventStore";
import { buildAssignEvent } from "./distributionLog";
import { getRecentErrors } from "../storage/errorLogger";

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

  it("no longer reports a partial write when the read-back never confirms", async () => {
    // This test used to assert failure — and that assertion WAS the bug.
    //
    // `close()` had already resolved, so the events were durable; only the
    // post-close read-back could not see them yet. Reporting failure aborted
    // the append before its projection, so the revision never advanced, the
    // assignee's mirror was judged current, and the assignment stayed invisible
    // to them through reloads while the operator was told to retry — a retry
    // that then ran against a stale snapshot and could duplicate events.
    //
    // A read-back that cannot see the file is now inconclusive, not failed,
    // PROVIDED the pre-append baseline was trustworthy (it is here: fresh
    // writer session, no prior segment). The next test covers the case where it
    // is not.
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

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sample and events agree — the state the old failure path left inconsistent.
    expect(result.updatedSample.rows.map((row) => row.xrayImageId)).toEqual(["img-1", "img-2"]);
    const persisted = await loadSampleMaster(root, MONTH);
    expect(persisted?.rows.map((row) => row.xrayImageId)).toEqual(["img-1", "img-2"]);
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.map((event) => event.eventType)).toEqual(["assigned", "replaced"]);

    // Silent success would be wrong too: the lag is recorded for an admin.
    expect(
      getRecentErrors().some((entry) => entry.context.includes("XQ-DIST-007"))
    ).toBe(true);
  });

  it("STILL fails, in Arabic with no raw DOMException text, when the baseline was not trustworthy", async () => {
    // The data-loss backstop, and the reason the relaxation above is
    // conditional. Here the segment was already written in this session, so the
    // pre-append re-read falls back to "" — meaning this append rewrites the
    // file WITHOUT lines that may still be on the share. An unconfirmable
    // read-back is then the only signal that events may have just been dropped,
    // and it must stay fatal.
    //
    // This also preserves this file's original guard: whatever the user is
    // shown here is Arabic and carries a code, never raw Chromium wording.
    __resetWrittenSegmentsForTests();
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1");
    const replacementRow = makeRow("img-2");
    await seed(root, deadRow);

    // First append succeeds, so the writer now KNOWS it wrote this segment.
    await appendDistributionEvent(
      root,
      MONTH,
      buildAssignEvent({ xrayImageId: "img-1", assignedTo: "expert1", eventBy: "supervisor1" })
    );

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

    expect(result.error).toContain("تمت إضافة البديل للعينة لكن فشل تسجيل الحدث");
    expect(result.error).not.toContain("XQ-IO-028");
    // The original, unchanged point of this file: no untranslated Chromium or
    // internal wording ever reaches the Arabic UI.
    expect(result.error).not.toMatch(/NotFoundError|Simulated|could not be found/);
  });
});
