import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import { invalidateMonthLockCache } from "../population/monthLock";
import { saveSampleMaster, loadSampleMaster } from "../sampling/sampleStorage";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { appendDistributionEvents, loadOrDeriveDistributionCurrentForRead } from "../distribution/distributionStorage";
import { buildAssignEvent, buildCompletedEvent } from "../distribution/distributionLog";
import { readWorkspaceActions } from "../audit/actionLog";
import { upsertItemAnswer, loadEmployeeAnswers } from "./answerStorage";
import type { ItemAnswer } from "./answerTypes";
import { bulkReopenPendingItems } from "./pendingBulkReopen";

const MONTH = "5-May-2026";
const HAS_IMAGE_FIELD_ID = "hasImage";

const TEMPLATE: TemplateSchema = {
  templateId: "t1",
  templateName: "نموذج",
  version: 1,
  fields: [
    { fieldId: HAS_IMAGE_FIELD_ID, label: "هل يوجد صورة", type: "select", options: ["نعم", "لا"], required: true },
  ],
} as unknown as TemplateSchema;

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

function noImageAnswer(id: string, assignedTo: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: HAS_IMAGE_FIELD_ID, value: "لا" }],
    lastSavedAt: "2026-05-01T00:00:00.000Z",
    submittedAt: "2026-05-01T00:00:00.000Z",
    answeredBy: assignedTo,
    status: "submitted",
  };
}

function normalAnswer(id: string, assignedTo: string): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: HAS_IMAGE_FIELD_ID, value: "نعم" }],
    lastSavedAt: "2026-05-01T00:00:00.000Z",
    submittedAt: "2026-05-01T00:00:00.000Z",
    answeredBy: assignedTo,
    status: "submitted",
  };
}

/**
 * Three distributed rows: A1/A2 are معلقة — assigned but NOT completed in
 * distribution (a real "لا يوجد صورة" submission never emits a "completed"
 * distribution event; see XrayReferrals.handleSave / reopenAnswer.ts's own
 * comment on this), with a submitted no-image answer. A3 IS a real
 * completion (assigned + completed event + a normal submitted answer), and
 * must never be touched by the bulk reopen.
 */
async function seed(root: DirectoryHandleLike): Promise<void> {
  const rows = [makeRow("A1"), makeRow("A2"), makeRow("A3")];
  await saveSampleMaster(root, MONTH, makeSample(rows));
  await appendDistributionEvents(root, MONTH, [
    buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "A2", assignedTo: "emp1", eventBy: "admin" }),
    buildAssignEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "admin" }),
    buildCompletedEvent({ xrayImageId: "A3", assignedTo: "emp1", eventBy: "emp1" }),
  ]);
  await upsertItemAnswer(root, MONTH, "emp1", noImageAnswer("A1", "emp1"));
  await upsertItemAnswer(root, MONTH, "emp1", noImageAnswer("A2", "emp1"));
  await upsertItemAnswer(root, MONTH, "emp1", normalAnswer("A3", "emp1"));
}

describe("bulkReopenPendingItems", () => {
  beforeEach(() => {
    invalidateMonthLockCache();
  });

  it("reopens only currently-معلقة items, leaves a real completion untouched, and logs per-id audit entries", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    await seed(root);

    const sample = await loadSampleMaster(root, MONTH);
    const current = await loadOrDeriveDistributionCurrentForRead(root, MONTH, sample!.rows);
    const answersFile = await loadEmployeeAnswers(root, MONTH, "emp1");
    const answersMap = new Map(answersFile.items.map((item) => [`${item.xrayImageId}::emp1`, item]));

    const result = await bulkReopenPendingItems({
      directoryHandle: root,
      monthFolderName: MONTH,
      entries: current!.entries,
      answersMap,
      template: TEMPLATE,
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "تصحيح جماعي",
    });

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toEqual([]);

    const after = await loadEmployeeAnswers(root, MONTH, "emp1");
    const byId = new Map(after.items.map((item) => [item.xrayImageId, item]));
    expect(byId.get("A1")!.status).toBe("draft");
    expect(byId.get("A2")!.status).toBe("draft");
    // The real completion (has an image) must be untouched.
    expect(byId.get("A3")!.status).toBe("submitted");

    const actions = await readWorkspaceActions(root);
    const bulkEntries = actions.filter((a) => a.action === "pending-bulk-reopened");
    expect(bulkEntries.map((a) => a.target).sort()).toEqual(["A1", "A2"]);
    // The underlying state-transition is still recorded too (per-item, by reopenAnswer.ts itself).
    const reopenedEntries = actions.filter((a) => a.action === "answer-reopened");
    expect(reopenedEntries.map((a) => a.target).sort()).toEqual(["A1", "A2"]);
  });

  it("is a no-op when nothing is currently معلقة", async () => {
    const root = createMemoryDirectory("root") as DirectoryHandleLike;
    const rows = [makeRow("A1")];
    await saveSampleMaster(root, MONTH, makeSample(rows));
    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "admin" }),
      buildCompletedEvent({ xrayImageId: "A1", assignedTo: "emp1", eventBy: "emp1" }),
    ]);
    await upsertItemAnswer(root, MONTH, "emp1", normalAnswer("A1", "emp1"));

    const current = await loadOrDeriveDistributionCurrentForRead(root, MONTH, rows);
    const answersFile = await loadEmployeeAnswers(root, MONTH, "emp1");
    const answersMap = new Map(answersFile.items.map((item) => [`${item.xrayImageId}::emp1`, item]));

    const result = await bulkReopenPendingItems({
      directoryHandle: root,
      monthFolderName: MONTH,
      entries: current!.entries,
      answersMap,
      template: TEMPLATE,
      reopenedBy: "sup1",
      reopenedByRole: "supervisor",
      reason: "لا يوجد",
    });
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: [] });
  });
});
