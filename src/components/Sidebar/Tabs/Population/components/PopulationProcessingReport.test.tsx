/* @vitest-environment jsdom */
// W8: coverage for the dropped-rows drill-down that replaced the removed
// "تقرير المعالجة" button (PhaseTwoReportAndProcessing.tsx) — the per-row detail
// for rows excluded during processing must stay reachable from the Phase 2 UI
// itself, not only via the (still-present) full Excel export.
//
// 3b design handoff (2026-08-18): this component no longer renders the nine
// summary cards / three detail cards — those moved into the verdict row's
// "نتيجة المعالجة" card in PhaseTwoReportAndProcessing.tsx (covered in that
// file's test). What is left here is the BI-fill panel, the exclusions panel,
// and the final-population preview, which is now COLLAPSED on mount.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PopulationProcessingReport, { type PopulationReportPreviewRow } from "./PopulationProcessingReport";
import type { ProcessingSummary, RemovedPopulationRow } from "../processing/populationProcessingTypes";

function makeSummary(): ProcessingSummary {
  return {
    riskOriginalRows: 10,
    validRiskIdRows: 9,
    invalidRiskIdRows: 1,
    duplicateRiskIdRows: 1,
    rowsAfterDeduplication: 8,
    removedInvalidResultRows: 1,
    finalPreparedPopulationRows: 7,
    certScanRows: 3,
    nonCertScanRows: 4,
    certScanPercentage: 43,
    nonCertScanPercentage: 57,
    biProvided: false,
    biMatchedRows: 0,
    biUnmatchedRows: 0,
    biMatchPercentage: 0,
    totalBiFilledFields: 0,
    biFieldFillSummary: [],
  };
}

function makeRemovedRow(overrides: Partial<RemovedPopulationRow> = {}): RemovedPopulationRow {
  return {
    reason: "نتيجة مستوى غير صالحة",
    xrayImageId: "XR-1",
    portName: "ميناء جدة",
    sourceSheetName: "بري",
    sourceRowNumber: 12,
    ...overrides,
  };
}

function makePreviewRows(count: number): PopulationReportPreviewRow[] {
  return Array.from({ length: count }, (_, i) => ({
    xrayImageId: `XR-${i + 1}`,
    sourceRowNumber: i + 1,
    portName: "ميناء جدة",
    stage: "first",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    certScanStatus: "Certscan",
  }));
}

/** Opens the "معاينة المجتمع النهائي" disclosure, which is collapsed on mount. */
function openPreview() {
  fireEvent.click(screen.getByRole("button", { name: /معاينة المجتمع النهائي/ }));
}

afterEach(cleanup);

describe("PopulationProcessingReport — dropped-rows drill-down (W8)", () => {
  it("happy: an excluded-rows category is collapsed by default and expands to show per-row detail", () => {
    render(
      <PopulationProcessingReport
        summary={makeSummary()}
        previewRows={[]}
        invalidResultRows={[makeRemovedRow()]}
      />,
    );

    expect(screen.getByText("الصفوف المستبعدة")).toBeInTheDocument();
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /نتائج مستوى غير صالحة/ }));
    expect(screen.getByText("XR-1")).toBeInTheDocument();
    expect(screen.getByText("نتيجة مستوى غير صالحة")).toBeInTheDocument();
  });

  it("failure: renders no drill-down section at all when nothing was excluded", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={[]} />);
    expect(screen.queryByText("الصفوف المستبعدة")).not.toBeInTheDocument();
  });

  it("3b: the invalid-level cause box is always visible, not behind a disclosure", () => {
    render(
      <PopulationProcessingReport
        summary={makeSummary()}
        previewRows={[]}
        invalidResultRows={[makeRemovedRow({ reason: "Invalid level result [L2]: مفقود" })]}
      />,
    );

    expect(screen.getByText("أكثر أسباب استبعاد نتائج المستوى")).toBeInTheDocument();
    expect(screen.getByText("المستوى الثاني فقط (غير صالح/غير موجود)")).toBeInTheDocument();
  });
});

describe("PopulationProcessingReport — BI fill panel (3b)", () => {
  it("renders one row per BI-fillable column with its fill percentage", () => {
    const summary: ProcessingSummary = {
      ...makeSummary(),
      biProvided: true,
      totalBiFilledFields: 12,
      biFieldFillSummary: [
        { fieldName: "نتيجة التفتيش اليدوي", riskEmptyBefore: 20, filledFromBi: 12, stillEmptyAfter: 8, fillPercentage: 60 },
      ],
    };
    render(<PopulationProcessingReport summary={summary} previewRows={[]} />);

    expect(screen.getByText("تعبئة الخانات من BI")).toBeInTheDocument();
    expect(screen.getByText("نتيجة التفتيش اليدوي")).toBeInTheDocument();
    expect(screen.getByText("12 خانة معبّأة")).toBeInTheDocument();
  });

  it("shows an empty note when the run has no BI-fillable columns", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={[]} />);
    expect(screen.getByText("لا توجد أعمدة قابلة للتعبئة من BI في هذا التشغيل.")).toBeInTheDocument();
  });
});

describe("PopulationProcessingReport — final-population preview (2026-08-12 / 3b)", () => {
  it("3b: the preview is COLLAPSED on mount — the header and its row-count summary show, the table does not", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(25)} />);

    const toggle = screen.getByRole("button", { name: /معاينة المجتمع النهائي/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("7 صف · CertScan 3 · NonCertScan 4")).toBeInTheDocument();
    expect(screen.getByText("اضغط للعرض")).toBeInTheDocument();
    // No table rows until the user opens it.
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("XR-1")).toBeInTheDocument();
  });

  it("3b: the disclosure remembers nothing across mounts — a remount starts collapsed again", () => {
    const { unmount } = render(
      <PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(3)} />,
    );
    openPreview();
    expect(screen.getByText("XR-1")).toBeInTheDocument();
    unmount();

    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(3)} />);
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();
  });

  it("happy: shows only 10 example rows per page even when more rows are available, and pagination advances to the next 10", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(25)} />);
    openPreview();

    // Page 1: XR-1..XR-10 shown, XR-11 not yet.
    expect(screen.getByText("XR-1")).toBeInTheDocument();
    expect(screen.getByText("XR-10")).toBeInTheDocument();
    expect(screen.queryByText("XR-11")).not.toBeInTheDocument();
    expect(document.querySelector(".data-pagination-summary")).toHaveTextContent(/عرض 1 إلى 10 من 25/);

    fireEvent.click(screen.getByRole("button", { name: "الصفحة التالية" }));

    // Page 2: XR-11..XR-20 shown, XR-1 and XR-21 not.
    expect(screen.getByText("XR-11")).toBeInTheDocument();
    expect(screen.getByText("XR-20")).toBeInTheDocument();
    expect(screen.queryByText("XR-1")).not.toBeInTheDocument();
    expect(screen.queryByText("XR-21")).not.toBeInTheDocument();
  });

  it("failure: renders nothing when there are no preview rows", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={[]} />);
    expect(screen.queryByText("معاينة المجتمع النهائي")).not.toBeInTheDocument();
  });

  it("does not add new statistics -- the preview header line reuses existing ProcessingSummary fields only", () => {
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={makePreviewRows(1)} />);
    // finalPreparedPopulationRows/certScanRows/nonCertScanRows from makeSummary(): 7/3/4.
    expect(screen.getByText("7 صف · CertScan 3 · NonCertScan 4")).toBeInTheDocument();
  });

  it("bug repro: renders the raw stage enum as its Arabic label instead of the stored code (owner report 2026-08-12)", () => {
    const rows: PopulationReportPreviewRow[] = [
      {
        xrayImageId: "XR-1",
        sourceRowNumber: 1,
        portName: "ميناء جدة",
        stage: "THIRD_STAGE",
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: "سليمة",
        certScanStatus: "Certscan",
      },
    ];
    render(<PopulationProcessingReport summary={makeSummary()} previewRows={rows} />);
    openPreview();

    expect(screen.getByText("المستوى الثالث")).toBeInTheDocument();
    expect(screen.queryByText("THIRD_STAGE")).not.toBeInTheDocument();
  });

  it("respects custom stageMappings overrides passed down from the active population config", () => {
    const rows: PopulationReportPreviewRow[] = [
      {
        xrayImageId: "XR-1",
        sourceRowNumber: 1,
        portName: "ميناء جدة",
        stage: "CUSTOM_THIRD",
        xrayLevelOneResult: "سليمة",
        xrayLevelTwoResult: "سليمة",
        certScanStatus: "Certscan",
      },
    ];
    render(
      <PopulationProcessingReport
        summary={makeSummary()}
        previewRows={rows}
        stageMappings={{ third: ["CUSTOM_THIRD"] }}
      />,
    );
    openPreview();

    expect(screen.getByText("المستوى الثالث")).toBeInTheDocument();
  });
});
