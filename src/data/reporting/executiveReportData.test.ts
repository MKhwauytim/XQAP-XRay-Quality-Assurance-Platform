import { describe, expect, it } from "vitest";

import type { EmployeeAnswerFile, FieldAnswer } from "../answers/answerTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import { buildExecutiveReportRows, calculateExecutiveKPIs } from "./executiveReportData";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";

const now = "2026-06-01T00:00:00.000Z";

function row(
  xrayImageId: string,
  overrides: Partial<PreparedPopulationRow> = {}
): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    portName: "منفذ الاختبار",
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
      liveMeans: { result: null, code: null, employeeId: null }
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

const template: TemplateSchema = {
  templateId: "default",
  templateName: "نموذج الاختبار",
  version: 1,
  createdAt: now,
  createdBy: "admin",
  updatedAt: now,
  updatedBy: "admin",
  fields: [
    { fieldId: "has-image", label: "هل يوجد صورة", type: "dropdown", required: true, options: ["نعم", "لا"] },
    { fieldId: "no-image-reason", label: "سبب عدم وجود الصورة", type: "text", required: false, options: [] },
    { fieldId: "has-marking", label: "هل يوجد تحديد", type: "dropdown", required: false, options: ["نعم", "لا"] },
    { fieldId: "image-quality", label: "مستوى جودة الصورة", type: "dropdown", required: false, options: ["عالي", "متوسط", "منخفض"] },
    { fieldId: "low-quality-reason", label: "اسباب انخفاض جودة الصورة", type: "text", required: false, options: [] },
    { fieldId: "result", label: "صحة النتيجة", type: "dropdown", required: true, options: ["سليمة", "اشتباه"] },
  ],
};

function answerFile(items: EmployeeAnswerFile["items"]): EmployeeAnswerFile {
  return {
    username: "emp",
    monthFolderName: "6-June-2026",
    items,
  };
}

function item(
  xrayImageId: string,
  status: "draft" | "submitted",
  answers: FieldAnswer[]
): EmployeeAnswerFile["items"][number] {
  return {
    xrayImageId,
    templateId: template.templateId,
    templateVersion: template.version,
    answers,
    lastSavedAt: now,
    submittedAt: status === "submitted" ? now : null,
    answeredBy: "emp",
    status,
  };
}

function sample(rows: PreparedPopulationRow[]): SampleMasterData {
  return {
    rngSeed: "seed",
    totalRequested: rows.length,
    totalActual: rows.length,
    certScanRequested: 0,
    nonCertScanRequested: rows.length,
    certScanActual: 0,
    nonCertScanActual: rows.length,
    portAllocations: [],
    stageAllocations: [],
    drawnAt: now,
    drawnBy: "admin",
    rows,
  };
}

describe("executive report data", () => {
  it("counts only submitted answers for completion and image-quality KPIs", () => {
    const populationRows = [row("XR-1"), row("XR-2")];
    const rows = buildExecutiveReportRows({
      monthFolderName: "6-June-2026",
      populationRows,
      sample: sample(populationRows),
      distribution: null,
      template,
      employeeFiles: [
        answerFile([
          item("XR-1", "submitted", [
            { fieldId: "has-image", value: "نعم" },
            { fieldId: "has-marking", value: "نعم" },
            { fieldId: "image-quality", value: "عالي" },
            { fieldId: "result", value: "سليمة" },
          ]),
          item("XR-2", "draft", [
            { fieldId: "has-image", value: "لا" },
            { fieldId: "no-image-reason", value: "غير مرفقة" },
            { fieldId: "result", value: "اشتباه" },
          ]),
        ]),
      ],
      config: DEFAULT_EXEC_CONFIG,
    });

    const kpis = calculateExecutiveKPIs(rows, sample(populationRows), DEFAULT_EXEC_CONFIG);

    expect(kpis.studiedImages).toBe(1);
    expect(kpis.imagesWithSubmittedAnswers).toBe(1);
    expect(kpis.imageAvailableCount).toBe(1);
    expect(kpis.imageMissingCount).toBe(0);
    expect(kpis.imageAvailabilityRate).toBe(100);
    expect(kpis.markingRate).toBe(100);
    expect(kpis.acceptableQualityRate).toBe(100);
    expect(kpis.missingImageReasons).toEqual([]);
  });

  it("calculates unavailable image and low-quality reason rates from template labels", () => {
    const populationRows = [row("XR-1"), row("XR-2")];
    const rows = buildExecutiveReportRows({
      monthFolderName: "6-June-2026",
      populationRows,
      sample: sample(populationRows),
      distribution: null,
      template,
      employeeFiles: [
        answerFile([
          item("XR-1", "submitted", [
            { fieldId: "has-image", value: "لا" },
            { fieldId: "no-image-reason", value: "الصورة غير متاحة" },
            { fieldId: "has-marking", value: "لا" },
            { fieldId: "image-quality", value: "منخفض" },
            { fieldId: "low-quality-reason", value: "ضبابية" },
            { fieldId: "result", value: "سليمة" },
          ]),
          item("XR-2", "submitted", [
            { fieldId: "has-image", value: "نعم" },
            { fieldId: "has-marking", value: "نعم" },
            { fieldId: "image-quality", value: "متوسط" },
            { fieldId: "low-quality-reason", value: "ضبابية" },
            { fieldId: "result", value: "سليمة" },
          ]),
        ]),
      ],
      config: DEFAULT_EXEC_CONFIG,
    });

    const kpis = calculateExecutiveKPIs(rows, sample(populationRows), DEFAULT_EXEC_CONFIG);

    expect(kpis.imageAvailabilityRate).toBe(50);
    expect(kpis.markingRate).toBe(50);
    expect(kpis.acceptableQualityRate).toBe(50);
    expect(kpis.lowQualityCount).toBe(1);
    expect(kpis.missingImageReasons).toEqual([
      { reason: "الصورة غير متاحة", count: 1, percentage: 100 },
    ]);
    expect(kpis.lowQualityReasons).toEqual([
      { reason: "ضبابية", count: 2, percentage: 100 },
    ]);
  });

  it("does not crash when template fields are unavailable", () => {
    const populationRows = [row("XR-1")];
    const rows = buildExecutiveReportRows({
      monthFolderName: "6-June-2026",
      populationRows,
      sample: sample(populationRows),
      distribution: null,
      template: null,
      employeeFiles: [
        answerFile([
          item("XR-1", "submitted", [{ fieldId: "unknown", value: "نعم" }]),
        ]),
      ],
      config: DEFAULT_EXEC_CONFIG,
    });

    const kpis = calculateExecutiveKPIs(rows, sample(populationRows), DEFAULT_EXEC_CONFIG);

    expect(kpis.studiedImages).toBe(1);
    expect(kpis.imageAvailabilityRate).toBeNull();
    expect(kpis.markingRate).toBeNull();
    expect(kpis.acceptableQualityRate).toBeNull();
    expect(kpis.overallAccuracy).toBeNull();
  });
});
