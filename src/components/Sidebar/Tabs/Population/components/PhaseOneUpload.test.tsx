/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for task 3's Phase-1 half —
// the file-picker cards had no permission-aware disabled state at all before this fix.
//
// Audit finding 12 (follow-up): the original fix gated the cards ONLY via a wrapping
// container's `aria-disabled` + `pointer-events: none` styling, because FileUploadCard
// exposed no `disabled` prop of its own. That blocked a mouse click but left every button
// inside fully keyboard-focusable and Enter/Space-activatable (`pointer-events: none` does
// not affect keyboard interaction), and `aria-disabled` on an ancestor announces nothing
// about its interactive descendants to a screen reader. FileUploadCard now takes a real
// `disabled` prop wired to a real HTML `disabled` attribute on its buttons, and index.tsx's
// pickExcelFile/handleFallbackFileChange/clearSelectedFile all re-check canUploadNow
// (not just canUploadData) as the authoritative handler-side gate.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseOneUpload from "./PhaseOneUpload";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";

type Props = ComponentProps<typeof PhaseOneUpload>;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    uploads: {
      riskAgencyData: { file: null, source: null },
      businessIntelligenceData: { file: null, source: null },
    },
    uploadError: "",
    processingMessage: "",
    isProcessingWorkbooks: false,
    canUpload: true,
    riskAgencyInputRef: { current: null },
    businessIntelligenceInputRef: { current: null },
    onPickFile: vi.fn(),
    onClearFile: vi.fn(),
    onFallbackFileChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PhaseOneUpload — render-time permission gate for the file-picker (B13 task 3)", () => {
  it("happy: the upload grid is interactive and untitled when canUpload is true", () => {
    const { container } = render(<PhaseOneUpload {...baseProps({ canUpload: true })} />);
    const grid = container.querySelector(".upload-grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute("aria-disabled")).toBe("false");
    expect(grid.getAttribute("title")).toBeNull();
  });

  it("failure: the upload grid is visually dimmed with a denial title when canUpload is false", () => {
    const { container } = render(<PhaseOneUpload {...baseProps({ canUpload: false })} />);
    const grid = container.querySelector(".upload-grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute("aria-disabled")).toBe("true");
    expect(grid.getAttribute("title")).toBe(
      "لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل."
    );
    expect(grid.style.opacity).toBe("0.55");
  });
});

// Audit finding 12: the disabling must be a REAL `disabled` attribute on the buttons
// themselves, not just CSS on an ancestor -- that's what makes it unreachable by a
// keyboard user (Tab still lands on the button, but a native `disabled` control cannot
// receive focus or fire onClick from Enter/Space).
describe("PhaseOneUpload — real `disabled` attribute on the file-picker buttons (audit finding 12)", () => {
  it("happy: pick/remove buttons are enabled when canUpload is true", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          canUpload: true,
          uploads: {
            riskAgencyData: { file: new File(["x"], "risk.xlsx"), source: "input-fallback" },
            businessIntelligenceData: { file: null, source: null },
          },
        })}
      />
    );
    for (const btn of screen.getAllByRole("button", { name: /تغيير الملف|اختيار ملف Excel/ })) {
      expect(btn).not.toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "إزالة" })).not.toBeDisabled();
  });

  it("failure: pick/remove buttons carry the real HTML disabled attribute when canUpload is false", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          canUpload: false,
          uploads: {
            riskAgencyData: { file: new File(["x"], "risk.xlsx"), source: "input-fallback" },
            businessIntelligenceData: { file: null, source: null },
          },
        })}
      />
    );
    for (const btn of screen.getAllByRole("button", { name: /تغيير الملف|اختيار ملف Excel/ })) {
      expect(btn).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "إزالة" })).toBeDisabled();
  });
});

describe("PhaseOneUpload — raw-file summary (W4/W10)", () => {
  it("happy: shows a general-information summary once the risk workbook is parsed", () => {
    const riskWorkbookResult: RiskWorkbookResult = {
      rows: [],
      sheetSummaries: [
        { sheetName: "بري", movementType: "بري", originalRowCount: 12, normalizedRowCount: 10, excludedMissingXrayIdCount: 2 },
      ],
      unknownSheetNames: [],
      totalOriginalRows: 12,
      totalNormalizedRows: 10,
      totalExcludedMissingXrayIdCount: 2,
    };
    render(<PhaseOneUpload {...baseProps({ riskWorkbookResult })} />);
    expect(screen.getByText("معلومات عامة عن الملفات المرفوعة")).toBeTruthy();
    expect(screen.getByText("الصفوف المقبولة: 10")).toBeTruthy();
  });

  it("failure: renders nothing extra before any workbook has been parsed", () => {
    render(<PhaseOneUpload {...baseProps()} />);
    expect(screen.queryByText("معلومات عامة عن الملفات المرفوعة")).toBeNull();
  });
});
