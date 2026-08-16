// Regression test (P1-A): a replacement SUBSTITUTES a row in the sample, it
// does not ENLARGE the sample.
//
// `appendSampleRow` used to append the replacement row and set
// `totalActual = rows.length + 1` while leaving the dead row in `rows`, so
// every replacement grew `totalActual` by one, permanently. Consequences,
// all silent:
//   * `sampleReport.ts` `fulfillment = totalActual / totalRequested` read
//     above 100%;
//   * `executiveReportData.calculateExecutiveKPIs`
//     `remainingImages = totalSample - studiedImages` showed a phantom
//     backlog EXACTLY equal to the replacement count, because a retired row
//     can never acquire a submitted answer;
//   * `completionRate` never reached 100% on a fully-studied month.
//
// The chosen semantics: `totalActual` is "rows the sample currently consists
// of" — drawn rows minus rows retired by a replacement. `rows` stays
// append-only (it is the audit trail AND the replacement dedup set: see
// `buildExclusionSets`, which must keep excluding a retired row so it can
// never be re-drawn as somebody else's replacement), and the retired ids are
// tracked in the new `replacedRowIds`.

import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { executeReplacement } from "../distribution/replacement";
import { calculateExecutiveKPIs } from "../reporting/executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "../reporting/executiveReportTypes";
import type { ExecutiveReportRow } from "../reporting/executiveReportTypes";
import type { SampleMasterData } from "./sampleTypes";
import { appendSampleRow, loadSampleMaster, saveSampleMaster } from "./sampleStorage";

const MONTH = "5-may-2026";

function makeRow(
  id: string,
  port = "ميناء أ",
  stage = "المستوى الأول",
  certScan: "Certscan" | "NonCertscan" = "NonCertscan"
): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: port,
    certScanStatus: certScan,
    stage,
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
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
  };
}

/** A month whose draw asked for 2 and got 2 — a 100%-fulfilled sample. */
function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 2,
    totalActual: 2,
    certScanRequested: 0,
    nonCertScanRequested: 2,
    certScanActual: 0,
    nonCertScanActual: 2,
    portAllocations: [
      {
        portName: "ميناء أ",
        populationSize: 10,
        certScanCount: 0,
        nonCertScanCount: 10,
        allocatedQuota: 2,
        certScanQuota: 0,
        nonCertScanQuota: 2,
        actualCertScanDrawn: 0,
        actualNonCertScanDrawn: 2,
        actualTotalDrawn: 2,
      },
    ],
    stageAllocations: [
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        populationSize: 10,
        targetQuota: 2,
        actualDrawn: 2,
        certScanDrawn: 0,
        nonCertScanDrawn: 2,
      },
    ],
    drawnAt: "2026-05-01T00:00:00.000Z",
    drawnBy: "drawer",
    rows: [makeRow("IMG-1"), makeRow("IMG-2")],
  };
}

function deadEntryFor(row: PreparedPopulationRow): DistributionEntry {
  return {
    xrayImageId: row.xrayImageId,
    assignedTo: "emp1",
    status: "pending",
    replacedById: null,
    row,
    lastEventAt: "2026-05-02T00:00:00.000Z",
  };
}

describe("P1-A — a replacement substitutes a sample row rather than enlarging the sample", () => {
  it("keeps totalActual at the drawn size and records the retired row id", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    const result = await appendSampleRow(dir, MONTH, makeRow("IMG-9"), undefined, "IMG-1");
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, MONTH);
    // Two images are still under study — IMG-2 and the replacement IMG-9.
    expect(reloaded?.totalActual).toBe(2);
    expect(reloaded?.nonCertScanActual).toBe(2);
    expect(reloaded?.replacedRowIds).toEqual(["IMG-1"]);
    // The dead row is NOT deleted: it is the audit trail and the dedup set.
    expect(reloaded?.rows.map((r) => r.xrayImageId)).toEqual(["IMG-1", "IMG-2", "IMG-9"]);
  });

  it("keeps sum(portAllocations.actualTotalDrawn) === totalActual across a cross-port replacement", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    // Replacement drawn from a DIFFERENT port — the cascade allows this.
    await appendSampleRow(dir, MONTH, makeRow("IMG-9", "ميناء ب"), undefined, "IMG-1");

    const reloaded = await loadSampleMaster(dir, MONTH);
    const portSum = (reloaded?.portAllocations ?? []).reduce((s, p) => s + p.actualTotalDrawn, 0);
    expect(portSum).toBe(reloaded?.totalActual);
    expect(reloaded?.portAllocations.find((p) => p.portName === "ميناء أ")?.actualTotalDrawn).toBe(1);
    expect(reloaded?.portAllocations.find((p) => p.portName === "ميناء ب")?.actualTotalDrawn).toBe(1);
  });

  it("is idempotent — replaying the same replacement retires the dead row exactly once", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    await appendSampleRow(dir, MONTH, makeRow("IMG-9"), undefined, "IMG-1");
    await appendSampleRow(dir, MONTH, makeRow("IMG-9"), undefined, "IMG-1");

    const reloaded = await loadSampleMaster(dir, MONTH);
    expect(reloaded?.totalActual).toBe(2);
    expect(reloaded?.replacedRowIds).toEqual(["IMG-1"]);
    expect(reloaded?.rows).toHaveLength(3);
  });

  it("executeReplacement threads the dead row id through, so the live path is fixed too", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    const result = await executeReplacement({
      directoryHandle: dir,
      monthFolderName: MONTH,
      deadEntry: deadEntryFor(makeRow("IMG-1")),
      replacementRow: makeRow("IMG-9"),
      reason: "الصورة غير متوفرة",
      eventBy: "emp1",
    });
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, MONTH);
    expect(reloaded?.totalActual).toBe(2);
    expect(reloaded?.replacedRowIds).toEqual(["IMG-1"]);
  });
});

describe("P1-A — the executive deck no longer shows a phantom backlog", () => {
  // `calculateExecutiveKPIs` is the consumer that made this defect visible in
  // the app's primary deliverable: `remainingImages = totalSample - studiedImages`
  // where `studiedImages` counts only sample rows carrying a SUBMITTED answer.
  // The retired row is in the sample-id set but can never be answered, so an
  // inflated `totalSample` becomes a permanent phantom backlog.
  function execRow(xrayImageId: string, studied: boolean): ExecutiveReportRow {
    return {
      xrayImageId,
      portCode: "P1", portName: "ميناء أ", portType: "بري", movementType: null,
      stage: "المستوى الأول",
      levelOneEmployeeId: null, levelTwoEmployeeId: null,
      levelOneResult: "سليمة", levelTwoResult: "سليمة", imageResult: "سليمة",
      selectedInSample: true,
      assignedTo: "emp1", distributionStatus: null, expertResult: null,
      imageAvailable: null, noImageReason: null, hasMarking: null,
      imageQuality: null, lowQualityReason: null, suspicionLevel: null,
      suspectedTypes: null, smuggleMethod: null,
      answerStatus: studied ? "submitted" : null,
      assignedAt: null, submittedAt: null,
      imageResultAccurate: null, levelOneAccurate: null, levelTwoAccurate: null,
      verificationCategory: null,
      otherResults: {
        manual: { result: null, employeeId: null },
        opposite: { result: null, employeeId: null },
        liveMeans: { result: null, employeeId: null },
      },
      notes: null,
    };
  }

  it("reports zero remaining images when every live sample row has been studied", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());
    await appendSampleRow(dir, MONTH, makeRow("IMG-9"), undefined, "IMG-1");
    const sample = await loadSampleMaster(dir, MONTH);

    // IMG-1 is retired and will never be answered; IMG-2 and IMG-9 are studied.
    const rows = [execRow("IMG-1", false), execRow("IMG-2", true), execRow("IMG-9", true)];

    const kpis = calculateExecutiveKPIs(rows, sample, DEFAULT_EXEC_CONFIG);
    expect(kpis.totalSample).toBe(2);
    expect(kpis.remainingImages).toBe(0);
    expect(kpis.completionRate).toBe(100);
  });
});
