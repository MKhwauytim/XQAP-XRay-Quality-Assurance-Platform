// `buildAnswerStatusFilter` — the queue table's «الحالة» column filter, tested
// without rendering the page. See the module header in answerStatusFilter.ts
// for the two regressions this locks in.

import { describe, expect, it } from "vitest";
import { buildAnswerStatusFilter } from "./answerStatusFilter";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { toEmployeeMirrorRowStub, type PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import type { TemplateSchema } from "../../../../../../data/templates/templateTypes";
import { HAS_IMAGE_FIELD_LABEL } from "../../../../../../data/answers/noImageAnswer";
import type { AnyFilter } from "../../../../../../components/DataTable/utils";

function makeRow(): PreparedPopulationRow {
  return {
    xrayImageId: "IMG-1",
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

function entry(overrides: Partial<DistributionEntry> = {}): DistributionEntry {
  return {
    xrayImageId: "IMG-1",
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-01T00:00:00.000Z",
    row: toEmployeeMirrorRowStub(makeRow()),
    ...overrides,
  };
}

function template(): TemplateSchema {
  return {
    templateId: "t1",
    templateName: "test",
    version: 1,
    createdAt: "",
    createdBy: "",
    updatedAt: "",
    updatedBy: "",
    fields: [
      { fieldId: "f-has-image", label: HAS_IMAGE_FIELD_LABEL, type: "dropdown", required: true, options: ["نعم", "لا"] },
    ],
  };
}

function answer(overrides: Partial<ItemAnswer> = {}): ItemAnswer {
  return {
    xrayImageId: "IMG-1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f-has-image", value: "نعم" }],
    lastSavedAt: "2026-08-25T00:00:00.000Z",
    submittedAt: "2026-08-25T00:00:00.000Z",
    answeredBy: "emp-1",
    status: "submitted",
    ...overrides,
  };
}

function statusFilter(value: string): AnyFilter {
  return { kind: "status", value };
}

describe("buildAnswerStatusFilter", () => {
  it("returns null for any other column or filter kind, deferring to DataTable's default matching", () => {
    const match = buildAnswerStatusFilter(new Map(), null);
    expect(match(entry(), "xrayImageId", statusFilter("submitted"))).toBeNull();
    expect(match(entry(), "answerStatus", { kind: "text", value: "x" })).toBeNull();
  });

  it("'all' (and an empty filter) matches every row", () => {
    const match = buildAnswerStatusFilter(new Map(), null);
    expect(match(entry(), "answerStatus", statusFilter("all"))).toBe(true);
    expect(match(entry(), "answerStatus", statusFilter(""))).toBe(true);
  });

  describe("مستبدلة (replaced) — regression: used to match every row, not just replaced ones", () => {
    it("matches a replaced entry", () => {
      const match = buildAnswerStatusFilter(new Map(), null);
      expect(match(entry({ status: "replaced" }), "answerStatus", statusFilter("replaced"))).toBe(true);
    });

    it("rejects a non-replaced entry", () => {
      const match = buildAnswerStatusFilter(new Map(), null);
      expect(match(entry({ status: "pending" }), "answerStatus", statusFilter("replaced"))).toBe(false);
      expect(match(entry({ status: "completed" }), "answerStatus", statusFilter("replaced"))).toBe(false);
    });

    it("a replaced entry never matches any other status filter", () => {
      const match = buildAnswerStatusFilter(new Map(), null);
      const replaced = entry({ status: "replaced" });
      expect(match(replaced, "answerStatus", statusFilter("submitted"))).toBe(false);
      expect(match(replaced, "answerStatus", statusFilter("on_hold"))).toBe(false);
      expect(match(replaced, "answerStatus", statusFilter("pending"))).toBe(false);
    });
  });

  describe("معلق (on_hold) vs. مكتملة (submitted) — regression: 'submitted' used to match both", () => {
    it("a real completion matches 'submitted' and not 'on_hold'", () => {
      const map = new Map([[`IMG-1::emp-1`, answer()]]);
      const match = buildAnswerStatusFilter(map, template());
      expect(match(entry(), "answerStatus", statusFilter("submitted"))).toBe(true);
      expect(match(entry(), "answerStatus", statusFilter("on_hold"))).toBe(false);
    });

    it("a submitted لا يوجد صورة answer matches 'on_hold' and not 'submitted'", () => {
      const onHold = answer({ answers: [{ fieldId: "f-has-image", value: "لا" }] });
      const map = new Map([[`IMG-1::emp-1`, onHold]]);
      const match = buildAnswerStatusFilter(map, template());
      expect(match(entry(), "answerStatus", statusFilter("on_hold"))).toBe(true);
      expect(match(entry(), "answerStatus", statusFilter("submitted"))).toBe(false);
    });

    it("without a template to read the gate field, a submitted answer is never on_hold", () => {
      const onHold = answer({ answers: [{ fieldId: "f-has-image", value: "لا" }] });
      const map = new Map([[`IMG-1::emp-1`, onHold]]);
      const match = buildAnswerStatusFilter(map, null);
      expect(match(entry(), "answerStatus", statusFilter("submitted"))).toBe(true);
      expect(match(entry(), "answerStatus", statusFilter("on_hold"))).toBe(false);
    });
  });

  describe("قيد الانتظار (pending)", () => {
    it("matches when there is no answer at all", () => {
      const match = buildAnswerStatusFilter(new Map(), template());
      expect(match(entry(), "answerStatus", statusFilter("pending"))).toBe(true);
      expect(match(entry(), "answerStatus", statusFilter("submitted"))).toBe(false);
      expect(match(entry(), "answerStatus", statusFilter("on_hold"))).toBe(false);
    });

    it("matches a draft (not yet submitted) answer", () => {
      const draft = answer({ status: "draft" });
      const map = new Map([[`IMG-1::emp-1`, draft]]);
      const match = buildAnswerStatusFilter(map, template());
      expect(match(entry(), "answerStatus", statusFilter("pending"))).toBe(true);
    });
  });
});
