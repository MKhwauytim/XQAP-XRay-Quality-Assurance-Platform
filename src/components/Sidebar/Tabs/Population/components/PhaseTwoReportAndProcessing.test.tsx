/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for task 3's Phase-2 half —
// the "process" and "export" buttons had no permission-aware disabled state at all before
// this fix (only isProcessingPopulation/loadedFromDisk gated the process button; the export
// buttons had no disabled prop whatsoever). canProcess/canExport must now render-time-disable
// them, matching Phase 4's canDistribute pattern.
//
// 3b design handoff (2026-08-18): both actions now live in the verdict row's
// "نتيجة المعالجة" card, which also carries the four stat tiles and the BI-match
// strip. The accuracy half of the screen (verdict card, "الأعمدة التي بها اختلاف"
// with its matched-columns toggle, and the chip-filtered mismatch details with
// normalized سليمة/اشتباه result values) is covered here too, since it renders
// through this component.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseTwoReportAndProcessing from "./PhaseTwoReportAndProcessing";
import { canonicalizeResult, displayForCol } from "./dataAccuracyCompare";
import type { NormalizedRiskRow, RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { NormalizedBiRow, BiWorkbookResult } from "../biData/biDataTypes";
import type { PopulationProcessingResult, ProcessingSummary } from "../processing/populationProcessingTypes";

function makeSummary(overrides: Partial<ProcessingSummary> = {}): ProcessingSummary {
  return {
    riskOriginalRows: 0,
    validRiskIdRows: 0,
    invalidRiskIdRows: 0,
    duplicateRiskIdRows: 0,
    rowsAfterDeduplication: 0,
    removedInvalidResultRows: 0,
    finalPreparedPopulationRows: 0,
    certScanRows: 0,
    nonCertScanRows: 0,
    certScanPercentage: 0,
    nonCertScanPercentage: 0,
    biProvided: false,
    biMatchedRows: 0,
    biUnmatchedRows: 0,
    biMatchPercentage: 0,
    totalBiFilledFields: 0,
    biFieldFillSummary: [],
    ...overrides,
  };
}

function makeRiskResult(rows: NormalizedRiskRow[] = []): RiskWorkbookResult {
  return {
    rows,
    sheetSummaries: [],
    unknownSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0,
  };
}

function makeBiResult(rows: NormalizedBiRow[] = []): BiWorkbookResult {
  return {
    rows,
    sheetSummaries: [],
    unknownSheetNames: [],
    unmatchedSheetNames: [],
    totalOriginalRows: rows.length,
    totalNormalizedRows: rows.length,
    totalExcludedMissingXrayIdCount: 0,
  };
}

function makeProcessingResult(summary: ProcessingSummary = makeSummary()): PopulationProcessingResult {
  return {
    preparedRows: [],
    removedRows: [],
    duplicateRows: [],
    invalidResultRows: [],
    summary,
  };
}

function riskRow(overrides: Partial<NormalizedRiskRow>): NormalizedRiskRow {
  return {
    movementType: "بري",
    portCode: null,
    portName: null,
    portType: null,
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    transitDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    manifestNumber: null,
    manifestType: null,
    manifestDate: null,
    plateOrContainerNumber: null,
    finalDestination: null,
    entryDate: null,
    exitDate: null,
    chassisNumber: null,
    reportNumber: null,
    hasReport: false,
    xrayLevelOneResult: null,
    xrayLevelTwoResult: null,
    inspectorResult: null,
    oppositeInspectorResult: null,
    liveMeansResult: null,
    xrayImageId: null,
    xrayEntryDate: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    stage: null,
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function biRow(overrides: Partial<NormalizedBiRow>): NormalizedBiRow {
  return {
    source: "bi-workbook",
    xrayImageId: null,
    xrayEntryDate: null,
    portType: null,
    portCode: null,
    portName: null,
    movementNumber: null,
    movementDate: null,
    movementHijriDate: null,
    declarationNumber: null,
    preliminaryDeclarationNumber: null,
    declarationDate: null,
    declarationHijriDate: null,
    inboundOutboundType: null,
    declarationType: null,
    declarationStatus: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    governance: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    levelOneResultCode: null,
    levelTwoResultCode: null,
    levelOneResult: null,
    levelTwoResult: null,
    manualInspectionResultCode: null,
    manualInspectionResult: null,
    oppositeInspectionEmployee: null,
    oppositeInspectionResultCode: null,
    oppositeInspectionResult: null,
    liveMeansEmployee: null,
    liveMeansResultCode: null,
    liveMeansResult: null,
    notes: null,
    sourceSheetName: "SheetA",
    sourceRowNumber: 1,
    ...overrides,
  };
}

type Props = ComponentProps<typeof PhaseTwoReportAndProcessing>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    riskWorkbookResult: makeRiskResult(),
    biWorkbookResult: null,
    processingMessage: "",
    certScanPasteText: "",
    populationProcessingResult: makeProcessingResult(),
    isProcessingPopulation: false,
    monthLabel: "يوليو 2026",
    isSavingToDisk: false,
    saveToDiskMessage: null,
    hasDiskWorkspace: true,
    canProcess: true,
    canExport: true,
    onProcessPopulation: vi.fn(),
    onExportPopulation: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PhaseTwoReportAndProcessing — render-time permission gate (B13 task 3)", () => {
  it("happy: process and export buttons are enabled when canProcess/canExport are true", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    const processButton = screen.getByRole("button", { name: /إعادة المعالجة/ });
    expect(processButton).not.toBeDisabled();

    const exportExcelButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportExcelButton).not.toBeDisabled();
    expect(exportExcelButton.getAttribute("title")).toBe("تصدير المجتمع النهائي Excel");
  });

  it("failure: process button is disabled with a denial title when canProcess is false", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps({ canProcess: false })} />);
    const processButton = screen.getByRole("button", { name: /إعادة المعالجة/ });
    expect(processButton).toBeDisabled();
    expect(processButton.getAttribute("title")).toBe(
      "لا تملك صلاحية معالجة المجتمع، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل."
    );
  });

  it("failure: export buttons are disabled with a denial title when canExport is false, independent of canProcess", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps({ canExport: false, canProcess: true })} />);
    const processButton = screen.getByRole("button", { name: /إعادة المعالجة/ });
    expect(processButton).not.toBeDisabled();

    const exportExcelButton = screen.getByRole("button", { name: "تصدير Excel" });
    expect(exportExcelButton).toBeDisabled();
    expect(exportExcelButton.getAttribute("title")).toBe("لا تملك صلاحية تصدير التقارير.");
  });

  it("W3/W8: no longer renders the CertScan grid or the removed تقرير المعالجة button in the Phase 2 flow", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "تقرير المعالجة" })).toBeNull();
    expect(screen.queryByLabelText("منطقة لصق بيانات CertScan")).toBeNull();
  });

  it("2026-08-12: no longer renders the referential-integrity orphan-scan section, and the rest of the processing report still renders", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    expect(screen.queryByLabelText("فحص السلامة المرجعية")).toBeNull();
    expect(screen.queryByText(/فحص السلامة المرجعية/)).toBeNull();
    // Nothing else in the Phase 2 report regressed: the verdict tiles still render.
    expect(screen.getByText("نتيجة المعالجة")).toBeInTheDocument();
    expect(screen.getByText("المجتمع النهائي")).toBeInTheDocument();
    expect(screen.getByText("CertScan / NonCertScan")).toBeInTheDocument();
  });
});

describe("PhaseTwoReportAndProcessing — نتيجة المعالجة verdict card (3b)", () => {
  it("wires every tile to the already-computed ProcessingSummary", () => {
    const summary = makeSummary({
      riskOriginalRows: 100,
      finalPreparedPopulationRows: 80,
      duplicateRiskIdRows: 12,
      removedInvalidResultRows: 5,
      invalidRiskIdRows: 3,
      certScanRows: 30,
      nonCertScanRows: 50,
      certScanPercentage: 37.5,
      nonCertScanPercentage: 62.5,
      certScanProvided: true,
      biProvided: true,
      biMatchPercentage: 46.4,
      totalBiFilledFields: 7415,
      biFieldFillSummary: [],
    });
    render(
      <PhaseTwoReportAndProcessing
        {...baseProps({ populationProcessingResult: makeProcessingResult(summary) })}
      />,
    );

    expect(screen.getByText("80")).toBeInTheDocument();          // المجتمع النهائي
    expect(screen.getByText("80.00% من الأصلية")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();          // 12 + 5 + 3 excluded
    expect(screen.getByText("12 مكرر · 5 نتيجة · 3 معرف")).toBeInTheDocument();
    expect(screen.getByText("38 / 63")).toBeInTheDocument();     // rounded CertScan split
    expect(screen.getByText("30 · 50")).toBeInTheDocument();
    expect(screen.getByText("7,415")).toBeInTheDocument();
    expect(screen.getByText(/53.60% من صفوف المخاطر لا يقابلها معرّف في BI/)).toBeInTheDocument();
  });

  it("bug repro: a bare CertScan=0 with certScanProvided:false explains that no list was supplied instead of showing a percentage", () => {
    const summary = makeSummary({ certScanRows: 0, certScanProvided: false });
    render(
      <PhaseTwoReportAndProcessing
        {...baseProps({ populationProcessingResult: makeProcessingResult(summary) })}
      />,
    );

    expect(screen.getByText(/لم يتم توفير قائمة أجهزة CertScan لهذا التشغيل/)).toBeInTheDocument();
    expect(screen.getByText("لم تُوفَّر قائمة CertScan")).toBeInTheDocument();
  });

  it("shows the CertScan split when certScanProvided is true, and also when it is undefined (older aggregates)", () => {
    const provided = makeSummary({ certScanProvided: true, certScanPercentage: 40, nonCertScanPercentage: 60 });
    const { unmount } = render(
      <PhaseTwoReportAndProcessing
        {...baseProps({ populationProcessingResult: makeProcessingResult(provided) })}
      />,
    );
    expect(screen.getByText("40 / 60")).toBeInTheDocument();
    expect(screen.queryByText(/لم يتم توفير قائمة أجهزة CertScan/)).not.toBeInTheDocument();
    unmount();

    render(
      <PhaseTwoReportAndProcessing
        {...baseProps({
          populationProcessingResult: makeProcessingResult(
            makeSummary({ certScanPercentage: 40, nonCertScanPercentage: 60 }),
          ),
        })}
      />,
    );
    expect(screen.getByText("40 / 60")).toBeInTheDocument();
  });

  it("says so when no BI workbook was supplied for the run", () => {
    render(<PhaseTwoReportAndProcessing {...baseProps()} />);
    expect(screen.getByText(/لم يتم رفع ملف BI لهذا التشغيل/)).toBeInTheDocument();
  });
});

// ── Result normalization (the one real behaviour change of 3b) ────────────────

describe("displayForCol — result columns render سليمة / اشتباه only", () => {
  const RESULT_COL = "levelOneResult";

  it.each([
    ["1", "سليمة"],
    ["سليم", "سليمة"],
    ["سليمة", "سليمة"],
    ["سليمه", "سليمة"],
    ["يمكن فسحها", "سليمة"],
    ["مبدئي", "سليمة"],
    ["مبدئية", "سليمة"],
    ["2", "اشتباه"],
    ["اشتباه", "اشتباه"],
    ["مشتبه", "اشتباه"],
    ["مشتبه به", "اشتباه"],
  ])("maps %s → %s on a result column", (raw, expected) => {
    expect(displayForCol(raw, RESULT_COL).text).toBe(expected);
  });

  it("never annotates the raw code alongside the canonical label", () => {
    expect(displayForCol("1", RESULT_COL).text).not.toMatch(/\(/);
    expect(displayForCol("يمكن فسحها", RESULT_COL).text).toBe("سليمة");
  });

  it("tags the canonical value so the UI can colour it", () => {
    expect(displayForCol("1", RESULT_COL).tone).toBe("clean");
    expect(displayForCol("2", RESULT_COL).tone).toBe("suspect");
  });

  it("keeps a non-result column's raw value unchanged", () => {
    expect(displayForCol("1447-02-14", "declarationHijriDate")).toEqual({ text: "1447-02-14", tone: "plain" });
    expect(displayForCol("بري وارد", "portType")).toEqual({ text: "بري وارد", tone: "plain" });
    // A value that WOULD canonicalize on a result column is left alone here.
    expect(displayForCol("1", "portCode").text).toBe("1");
  });

  it("renders an empty BI value as '— فارغ في BI' and an empty risk value as '—'", () => {
    expect(displayForCol(null, RESULT_COL, "bi")).toEqual({ text: "— فارغ في BI", tone: "empty" });
    expect(displayForCol("", "portType", "bi").text).toBe("— فارغ في BI");
    expect(displayForCol(null, RESULT_COL, "risk")).toEqual({ text: "—", tone: "empty" });
  });

  it("falls back to the trimmed raw text for an unrecognised result wording rather than hiding it", () => {
    expect(displayForCol("  قيمة غير معروفة  ", RESULT_COL)).toEqual({
      text: "قيمة غير معروفة",
      tone: "plain",
    });
  });

  it("canonicalizeResult itself still returns the canonical Arabic labels used for comparison", () => {
    expect(canonicalizeResult("1")).toBe("سليمة");
    expect(canonicalizeResult("2")).toBe("اشتباه");
    expect(canonicalizeResult("مشتبه")).toBe("اشتباه");
  });
});

// ── Accuracy panels (matched-columns toggle + chip filter) ───────────────────

/** Two matched IDs, differing on the manual-inspection result AND the hijri
 *  declaration date — so exactly two of the fourteen columns mismatch. */
function accuracyProps(): Partial<Props> {
  const risk = [
    riskRow({
      xrayImageId: "XR-1",
      portName: "ميناء جدة",
      inspectorResult: "1",
      declarationHijriDate: "1447-02-14",
    }),
    riskRow({
      xrayImageId: "XR-2",
      portName: "ميناء جدة",
      inspectorResult: "2",
      declarationHijriDate: "1447-02-20",
      sourceRowNumber: 2,
    }),
  ];
  const bi = [
    biRow({
      xrayImageId: "XR-1",
      portName: "ميناء جدة",
      manualInspectionResult: "اشتباه",
      declarationHijriDate: "1447-02-15",
    }),
    biRow({
      xrayImageId: "XR-2",
      portName: "ميناء جدة",
      manualInspectionResult: "يمكن فسحها",
      declarationHijriDate: "1447-02-21",
      sourceRowNumber: 2,
    }),
  ];
  return { riskWorkbookResult: makeRiskResult(risk), biWorkbookResult: makeBiResult(bi) };
}

// The accuracy comparison is computed asynchronously (Fix, 2026-08-18 — see
// dataAccuracyCompare.ts's compareAccuracyAsync) so it never blocks the main
// thread on a real population. Every test below awaits the first
// accuracy-dependent element instead of asserting synchronously right after
// render.
describe("PhaseTwoReportAndProcessing — accuracy panels (3b)", () => {
  it("lists only the mismatching columns, with a 'N من 14' badge", async () => {
    render(<PhaseTwoReportAndProcessing {...baseProps(accuracyProps())} />);

    expect(await screen.findByText("الأعمدة التي بها اختلاف")).toBeInTheDocument();
    expect(screen.getByText("2 من 14")).toBeInTheDocument();

    const table = document.querySelector(".dar-col-table") as HTMLElement;
    expect(within(table).getByText("نتيجة التفتيش اليدوي")).toBeInTheDocument();
    expect(within(table).getByText("تاريخ البيان هجري")).toBeInTheDocument();
    // A fully-matched column is not listed until the toggle is used.
    expect(within(table).queryByText("رقم الهيكل")).not.toBeInTheDocument();
  });

  it("the matched-columns toggle reveals the remaining columns and hides them again", async () => {
    render(<PhaseTwoReportAndProcessing {...baseProps(accuracyProps())} />);
    const toggle = await screen.findByRole("button", { name: /إظهار الأعمدة المتطابقة \(12\)/ });
    const table = document.querySelector(".dar-col-table") as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(within(table).getByText("رقم الهيكل")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /إخفاء الأعمدة المتطابقة/ }));
    expect(within(table).queryByText("رقم الهيكل")).not.toBeInTheDocument();
  });

  it("the column filter chips narrow the mismatch detail table (replacing the old <select>)", async () => {
    render(<PhaseTwoReportAndProcessing {...baseProps(accuracyProps())} />);
    await screen.findByText("الأعمدة التي بها اختلاف");

    // Owner request: the details table is a disclosure, collapsed on mount.
    const disclosure = screen.getByRole("button", { name: /تفاصيل الاختلافات/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);

    // No <select> left in the details toolbar.
    expect(document.querySelector(".dar-col-filter")).toBeNull();

    const detail = document.querySelector(".dar-detail") as HTMLElement;
    const rowColumns = () =>
      Array.from(detail.querySelectorAll(".dar-detail-row .dar-col")).map((el) => el.textContent);

    // Unfiltered: both the hijri-date rows and the result rows are present.
    expect(rowColumns()).toContain("تاريخ البيان هجري");
    expect(rowColumns()).toContain("نتيجة التفتيش اليدوي");

    const chip = within(detail).getByRole("button", { name: /^نتيجة التفتيش اليدوي/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    expect(rowColumns()).toEqual(["نتيجة التفتيش اليدوي", "نتيجة التفتيش اليدوي"]);

    // Back to all columns.
    fireEvent.click(within(detail).getByRole("button", { name: "كل الأعمدة" }));
    expect(rowColumns()).toContain("تاريخ البيان هجري");
  });

  it("renders result-column cells as سليمة/اشتباه and leaves date cells raw", async () => {
    render(<PhaseTwoReportAndProcessing {...baseProps(accuracyProps())} />);
    await screen.findByText("الأعمدة التي بها اختلاف");
    fireEvent.click(screen.getByRole("button", { name: /تفاصيل الاختلافات/ }));
    const detail = document.querySelector(".dar-detail") as HTMLElement;

    // The risk side stores "1"/"2" — the codes must never reach the screen.
    const values = Array.from(detail.querySelectorAll(".dar-val")).map((el) => el.textContent);
    expect(values).toContain("سليمة");
    expect(values).toContain("اشتباه");
    expect(values).not.toContain("1");
    expect(values).not.toContain("يمكن فسحها");
    // The hijri dates are a non-result column and stay verbatim.
    expect(values).toContain("1447-02-14");
    expect(values).toContain("1447-02-15");

    expect(screen.getByText(/أعمدة النتائج مُوحَّدة/)).toBeInTheDocument();
  });

  it("shows the hoisted accuracy verdict card with the worst column named", async () => {
    render(<PhaseTwoReportAndProcessing {...baseProps(accuracyProps())} />);
    expect(await screen.findByText("دقة البيانات الكلية")).toBeInTheDocument();
    expect(screen.getByText(/2 من 14 أعمدة بها اختلافات/)).toBeInTheDocument();
    // Exactly one verdict card is rendered — DataAccuracyReport must not draw a second.
    expect(document.querySelectorAll(".dar-verdict").length).toBe(1);
  });
});
