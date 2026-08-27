import { describe, expect, it } from "vitest";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { ItemAnswer } from "../answers/answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import { buildPendingExportRows, isPendingReferralEntry } from "./pendingCorrections";

const HAS_IMAGE_FIELD_ID = "hasImage";

const TEMPLATE: TemplateSchema = {
  templateId: "t1",
  templateName: "نموذج",
  version: 1,
  fields: [
    { fieldId: HAS_IMAGE_FIELD_ID, label: "هل يوجد صورة", type: "select", options: ["نعم", "لا"], required: true },
  ],
} as unknown as TemplateSchema;

function makeEntry(id: string, assignedTo: string, status: DistributionEntry["status"] = "completed"): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo,
    status,
    replacedById: null,
    lastEventAt: "2026-05-01T00:00:00.000Z",
    row: {
      stage: "l1",
      portName: "بري",
      xrayEntryDate: "2026-05-01",
      plateOrContainerNumber: "P1",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "سليمة",
      certScanStatus: "NonCertscan",
      declarationNumber: "D1",
      declarationDate: "2026-05-01",
      chassisNumber: "C1",
      movementType: "LAND",
      portCode: "PC1",
      portType: "بري",
      targetedByRiskEngine: null,
      riskMessage: null,
      biEnrichmentStatus: "BI Not Provided",
      reportNumber: "R1",
    },
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

describe("isPendingReferralEntry", () => {
  it("is true only for a submitted لا-يوجد-صورة answer on a non-completed entry", () => {
    const entry = makeEntry("A1", "emp1", "pending");
    const answers = new Map([["A1::emp1", noImageAnswer("A1", "emp1")]]);
    expect(isPendingReferralEntry(entry, answers, TEMPLATE)).toBe(true);
  });

  it("is false when the distribution entry is already completed (wins over the answer)", () => {
    const entry = makeEntry("A1", "emp1", "completed");
    const answers = new Map([["A1::emp1", noImageAnswer("A1", "emp1")]]);
    expect(isPendingReferralEntry(entry, answers, TEMPLATE)).toBe(false);
  });

  it("is false for a normal submitted (image exists) answer", () => {
    const entry = makeEntry("A1", "emp1", "pending");
    const answers = new Map([["A1::emp1", normalAnswer("A1", "emp1")]]);
    expect(isPendingReferralEntry(entry, answers, TEMPLATE)).toBe(false);
  });

  it("is false with no answer at all", () => {
    const entry = makeEntry("A1", "emp1", "pending");
    expect(isPendingReferralEntry(entry, new Map(), TEMPLATE)).toBe(false);
  });
});

describe("buildPendingExportRows", () => {
  it("exports only pending rows, with xrayImageId plus every correctable field", () => {
    const entries = [makeEntry("A1", "emp1", "pending"), makeEntry("A2", "emp1", "pending")];
    const answers = new Map([
      ["A1::emp1", noImageAnswer("A1", "emp1")],
      ["A2::emp1", normalAnswer("A2", "emp1")],
    ]);
    const rows = buildPendingExportRows(entries, answers, TEMPLATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.xrayImageId).toBe("A1");
    expect(rows[0]!.portName).toBe("بري");
    expect(rows[0]!.declarationNumber).toBe("D1");
  });

  it("returns an empty array when nothing is pending", () => {
    const entries = [makeEntry("A1", "emp1", "completed")];
    const answers = new Map([["A1::emp1", normalAnswer("A1", "emp1")]]);
    expect(buildPendingExportRows(entries, answers, TEMPLATE)).toEqual([]);
  });
});
