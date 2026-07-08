import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { MonthManifestData } from "../population/monthTypes";
import { getPopulationMonthDir } from "../workspace/workspacePaths";
import { safeWriteJson } from "../storage/safeWrite";
import {
  MonthClosedError,
  closeMonth,
  invalidateMonthLockCache,
} from "../population/monthLock";
import { saveSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import {
  appendDistributionEvents,
  loadDistributionLog,
} from "../distribution/distributionStorage";
import {
  buildAssignEvent,
  buildCompletedEvent,
  deriveCurrentDistribution,
} from "../distribution/distributionLog";
import { readWorkspaceActions } from "../audit/actionLog";
import type { ItemAnswer } from "./answerTypes";
import { loadEmployeeAnswers, reopenItemAnswer, upsertItemAnswer } from "./answerStorage";
import { reopenSubmittedAnswer } from "./reopenAnswer";

const MONTH = "5-May-2026";
const EMP = "emp1";
const IMG = "A1";

function makeRow(id: string): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: "NonCertscan",
    stage: null,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1
  };
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

function makeSubmittedAnswer(): ItemAnswer {
  return {
    xrayImageId: IMG,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f1", value: "سليمة" }],
    lastSavedAt: new Date().toISOString(),
    submittedAt: "2026-05-10T10:00:00.000Z",
    answeredBy: EMP,
    status: "submitted",
  };
}

/** Sample + assignment + completed event + submitted answer. */
async function seed(root: DirectoryHandleLike): Promise<void> {
  await saveSampleMaster(root, MONTH, makeSample([makeRow(IMG)]));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: IMG, assignedTo: EMP, eventBy: "admin" }),
    buildCompletedEvent({ xrayImageId: IMG, assignedTo: EMP, eventBy: EMP }),
  ]);
  await upsertItemAnswer(root, MONTH, EMP, makeSubmittedAnswer());
}

describe("reopenAnswer", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("reopenItemAnswer flips submitted → draft with history; second call is a no-op", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await upsertItemAnswer(root, MONTH, EMP, makeSubmittedAnswer());

    const first = await reopenItemAnswer(root, MONTH, EMP, IMG, "sup1", "خطأ في الإجابة");
    expect(first.ok).toBe(true);

    let file = await loadEmployeeAnswers(root, MONTH, EMP);
    let item = file.items.find((i) => i.xrayImageId === IMG)!;
    expect(item.status).toBe("draft");
    expect(item.submittedAt).toBeNull();
    expect(item.answers).toHaveLength(1); // answers preserved
    expect(item.history).toHaveLength(1);
    expect(item.history![0]!.previousSubmittedAt).toBe("2026-05-10T10:00:00.000Z");
    expect(item.history![0]!.by).toBe("sup1");

    const second = await reopenItemAnswer(root, MONTH, EMP, IMG, "sup1", "تكرار");
    expect(second.ok).toBe(true);
    file = await loadEmployeeAnswers(root, MONTH, EMP);
    item = file.items.find((i) => i.xrayImageId === IMG)!;
    expect(item.history).toHaveLength(1); // no-op, no second entry
  });

  it("full flow: answer → draft, distribution entry back to pending, audit entry recorded", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const result = await reopenSubmittedAnswer({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: EMP,
      xrayImageId: IMG,
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "تصحيح النتيجة",
    });
    expect(result.ok).toBe(true);

    const file = await loadEmployeeAnswers(root, MONTH, EMP);
    expect(file.items[0]!.status).toBe("draft");

    const log = await loadDistributionLog(root, MONTH);
    const reopened = log.events.filter((e) => e.eventType === "reopened");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]!.sourceRequestId).toBe(`reopen-${IMG}-2026-05-10T10:00:00.000Z`);

    const current = deriveCurrentDistribution(log, [makeRow(IMG)]);
    expect(current.entries[0]!.status).toBe("pending");
    expect(current.entries[0]!.assignedTo).toBe(EMP);

    const actions = await readWorkspaceActions(root);
    expect(actions.some((a) => a.action === "answer-reopened" && a.target === IMG)).toBe(true);
  });

  it("retry after the answer flipped but the event failed appends exactly one reopened event", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    // Simulate the partial-failure state: answer already flipped, no event.
    await reopenItemAnswer(root, MONTH, EMP, IMG, "sup1", "تصحيح");
    expect((await loadDistributionLog(root, MONTH)).events.filter((e) => e.eventType === "reopened")).toHaveLength(0);

    // Retry the orchestrator — must emit exactly one event (key from history).
    const result = await reopenSubmittedAnswer({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: EMP,
      xrayImageId: IMG,
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "تصحيح",
    });
    expect(result.ok).toBe(true);
    expect((await loadDistributionLog(root, MONTH)).events.filter((e) => e.eventType === "reopened")).toHaveLength(1);

    // A further retry emits nothing new (replay guard).
    await reopenSubmittedAnswer({
      directoryHandle: root,
      monthFolderName: MONTH,
      employeeUsername: EMP,
      xrayImageId: IMG,
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "تصحيح",
    });
    expect((await loadDistributionLog(root, MONTH)).events.filter((e) => e.eventType === "reopened")).toHaveLength(1);
  });

  it("closed month blocks reopen with MonthClosedError", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const monthDir = await getPopulationMonthDir(root, MONTH, true);
    const manifest: MonthManifestData = {
      monthFolderName: MONTH, month: 5, year: 2026,
      processedAt: new Date().toISOString(), processedBy: "admin",
      riskFileName: null, biFileName: null, certScanUsed: false,
      templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: 1,
      status: "distributed",
    };
    await safeWriteJson(monthDir, "month.manifest.json", manifest);
    await closeMonth(root, MONTH, "admin");

    await expect(
      reopenSubmittedAnswer({
        directoryHandle: root,
        monthFolderName: MONTH,
        employeeUsername: EMP,
        xrayImageId: IMG,
        reopenedBy: "sup1",
        reopenedByRole: "supervisor",
        reason: "تصحيح",
      })
    ).rejects.toThrow(MonthClosedError);

    // Nothing changed.
    const file = await loadEmployeeAnswers(root, MONTH, EMP);
    expect(file.items[0]!.status).toBe("submitted");
  });
});
