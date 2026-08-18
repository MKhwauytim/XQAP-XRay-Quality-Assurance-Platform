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
//
// 2026-08 design handoff (panel 2b): the BI source became a MULTI-FILE list capped at 10.
// The suite below also covers the cap, per-row removal, the derived accepted-rows total,
// the parsing row, and the explicit error row a file that classified nothing must produce.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseOneUpload from "./PhaseOneUpload";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";
import type { BiUploadEntry } from "../biData/biDataTypes";
import { MAX_BI_UPLOADS } from "../biData/biDataTypes";

type Props = ComponentProps<typeof PhaseOneUpload>;

function biEntry(overrides: Partial<BiUploadEntry> = {}): BiUploadEntry {
  const name = overrides.file?.name ?? "bi.xlsx";
  return {
    id: name,
    file: new File(["x"], name),
    sheetName: "بحري وارد",
    sizeBytes: 2048,
    acceptedRows: 100,
    state: "ready",
    ...overrides,
  };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    uploads: {
      riskAgencyData: { file: null, source: null },
      biUploads: [],
    },
    uploadError: "",
    processingMessage: "",
    isProcessingWorkbooks: false,
    canUpload: true,
    riskAgencyInputRef: { current: null },
    businessIntelligenceInputRef: { current: null },
    onPickFile: vi.fn(),
    onClearFile: vi.fn(),
    onRemoveBiUpload: vi.fn(),
    onDropFiles: vi.fn(),
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
            biUploads: [],
          },
        })}
      />
    );
    expect(screen.getByRole("button", { name: "تغيير الملف" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "إزالة" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "اختيار ملفات" })).not.toBeDisabled();
  });

  it("failure: pick/remove buttons carry the real HTML disabled attribute when canUpload is false", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          canUpload: false,
          uploads: {
            riskAgencyData: { file: new File(["x"], "risk.xlsx"), source: "input-fallback" },
            biUploads: [biEntry()],
          },
        })}
      />
    );
    expect(screen.getByRole("button", { name: "تغيير الملف" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "إزالة" })).toBeDisabled();
    // The new denser BI controls follow the same rule: disabled, not hidden.
    expect(screen.getByRole("button", { name: "اختيار ملفات" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /إزالة الملف: bi\.xlsx/ })).toBeDisabled();
  });
});

describe("PhaseOneUpload — multi-file BI list (design handoff 2b)", () => {
  it("happy: renders one row per attached file with a derived count pill and accepted-rows total", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          uploads: {
            riskAgencyData: { file: null, source: null },
            biUploads: [
              biEntry({ id: "a", file: new File(["x"], "bi-1.xlsx"), acceptedRows: 14208 }),
              biEntry({ id: "b", file: new File(["x"], "bi-2.xlsx"), acceptedRows: 9940 }),
            ],
          },
        })}
      />
    );

    expect(screen.getByText("bi-1.xlsx")).toBeTruthy();
    expect(screen.getByText("bi-2.xlsx")).toBeTruthy();
    // Derived, never stored.
    expect(screen.getByText("2 من 10 ملفات")).toBeTruthy();
    expect(screen.getByText("24,148")).toBeTruthy();
  });

  it("happy: the empty list still renders the table chrome and a zero total", () => {
    render(<PhaseOneUpload {...baseProps()} />);
    expect(screen.getByText("لم يتم إرفاق أي ملف ذكاء أعمال بعد.")).toBeTruthy();
    expect(screen.getByText("0 من 10 ملفات")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("happy: a parsing row shows the reading state and no row count", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          uploads: {
            riskAgencyData: { file: null, source: null },
            biUploads: [biEntry({ state: "parsing", acceptedRows: null })],
          },
        })}
      />
    );
    expect(screen.getByText("جارٍ القراءة…")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("failure: a file that classified nothing renders an explicit error row, not a silent zero", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          uploads: {
            riskAgencyData: { file: null, source: null },
            biUploads: [
              biEntry({
                file: new File(["x"], "غير معروف.csv"),
                state: "error",
                acceptedRows: 0,
                error: "لم يتطابق أي اسم ورقة في هذا الملف مع أنماط الأوراق المُعرّفة (غير معروف).",
              }),
            ],
          },
        })}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("لم يتطابق أي اسم ورقة");
  });

  it("failure: the add-more zone is disabled (not hidden) once the 10-file cap is reached", () => {
    const biUploads = Array.from({ length: MAX_BI_UPLOADS }, (_, i) =>
      biEntry({ id: `f${i}`, file: new File(["x"], `bi-${i}.xlsx`) })
    );
    render(
      <PhaseOneUpload
        {...baseProps({
          uploads: { riskAgencyData: { file: null, source: null }, biUploads },
        })}
      />
    );

    const addButton = screen.getByRole("button", { name: "اختيار ملفات" });
    expect(addButton).toBeDisabled();
    expect(screen.getByText("تم بلوغ الحد الأقصى (10 ملفات). أزل ملفاً قبل إضافة غيره.")).toBeTruthy();
    expect(screen.getByText("10 من 10 ملفات")).toBeTruthy();
  });

  it("happy: below the cap the add-more zone reports the remaining slots and is enabled", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          uploads: {
            riskAgencyData: { file: null, source: null },
            biUploads: [biEntry({ id: "a" }), biEntry({ id: "b", file: new File(["x"], "b.xlsx") })],
          },
        })}
      />
    );
    expect(screen.getByRole("button", { name: "اختيار ملفات" })).not.toBeDisabled();
    expect(
      screen.getByText("‎.xlsx أو ‎.xls أو ‎.csv · يمكن اختيار عدة ملفات معاً · بقي 8 من أصل 10")
    ).toBeTruthy();
  });

  it("happy: removing a row reports the row's own id, so the parent can recompute the total", () => {
    const onRemoveBiUpload = vi.fn();
    render(
      <PhaseOneUpload
        {...baseProps({
          onRemoveBiUpload,
          uploads: {
            riskAgencyData: { file: null, source: null },
            biUploads: [
              biEntry({ id: "keep", file: new File(["x"], "keep.xlsx") }),
              biEntry({ id: "drop", file: new File(["x"], "drop.xlsx") }),
            ],
          },
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "إزالة الملف: drop.xlsx" }));
    expect(onRemoveBiUpload).toHaveBeenCalledWith("drop");
  });

  it("happy: the BI file input accepts CSV and multiple selection", () => {
    const { container } = render(<PhaseOneUpload {...baseProps()} />);
    const inputs = container.querySelectorAll<HTMLInputElement>("input.hidden-file-input");
    const biInput = inputs[1];
    expect(biInput.accept).toBe(".xlsx,.xls,.csv");
    expect(biInput.multiple).toBe(true);
    // The risk source stays single-file and Excel-only.
    expect(inputs[0].accept).toBe(".xlsx,.xls");
    expect(inputs[0].multiple).toBe(false);
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

  it("happy: a merged BI result keeps identical sheet names from different files distinct", () => {
    render(
      <PhaseOneUpload
        {...baseProps({
          biWorkbookResult: {
            rows: [],
            sheetSummaries: [
              { sheetName: "بحري وارد", sourceFileName: "a.xlsx", source: "بحري وارد", originalRowCount: 5, normalizedRowCount: 5, excludedMissingXrayIdCount: 0 },
              { sheetName: "بحري وارد", sourceFileName: "b.xlsx", source: "بحري وارد", originalRowCount: 7, normalizedRowCount: 7, excludedMissingXrayIdCount: 0 },
            ],
            unknownSheetNames: [],
            totalOriginalRows: 12,
            totalNormalizedRows: 12,
            totalExcludedMissingXrayIdCount: 0,
          },
        })}
      />
    );
    // Both chips render — a duplicate React key would have collapsed/warned.
    expect(screen.getAllByText(/بحري وارد:/)).toHaveLength(2);
  });

  it("failure: renders nothing extra before any workbook has been parsed", () => {
    render(<PhaseOneUpload {...baseProps()} />);
    expect(screen.queryByText("معلومات عامة عن الملفات المرفوعة")).toBeNull();
  });
});

// ── Drag-and-drop (owner request, 2026-08-18) ───────────────────────────────

describe("PhaseOneUpload — drag-and-drop", () => {
  function dropOn(element: Element, files: File[]) {
    // jsdom's DragEvent has no dataTransfer, so it is supplied explicitly.
    fireEvent.drop(element, { dataTransfer: { files } });
  }

  it("routes files dropped on the BI card to the BI upload key", () => {
    const onDropFiles = vi.fn();
    const { container } = render(<PhaseOneUpload {...baseProps({ onDropFiles })} />);

    const file = new File(["x"], "بحري وارد.xlsx");
    dropOn(container.querySelector(".bi-source-card")!, [file]);

    expect(onDropFiles).toHaveBeenCalledWith("businessIntelligenceData", [file]);
  });

  it("routes files dropped on the risk card to the risk-agency upload key", () => {
    const onDropFiles = vi.fn();
    const { container } = render(<PhaseOneUpload {...baseProps({ onDropFiles })} />);

    const file = new File(["x"], "risk.xlsx");
    dropOn(container.querySelector(".risk-drop-wrap")!, [file]);

    expect(onDropFiles).toHaveBeenCalledWith("riskAgencyData", [file]);
  });

  it("ignores a drop while uploading is not permitted (closed month / no permission)", () => {
    const onDropFiles = vi.fn();
    const { container } = render(
      <PhaseOneUpload {...baseProps({ onDropFiles, canUpload: false })} />
    );

    dropOn(container.querySelector(".bi-source-card")!, [new File(["x"], "a.xlsx")]);
    dropOn(container.querySelector(".risk-drop-wrap")!, [new File(["x"], "b.xlsx")]);

    expect(onDropFiles).not.toHaveBeenCalled();
  });
});
