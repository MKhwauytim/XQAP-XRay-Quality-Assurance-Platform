/* @vitest-environment jsdom */
// B13 (bucket B13-population-wizard-gating): regression coverage for task 3's Phase-1 half —
// the file-picker cards had no permission-aware disabled state at all before this fix.
// FileUploadCard (a sibling component owned by a different bucket) exposes no `disabled`
// prop of its own, so PhaseOneUpload gates it via a wrapping container (visual + pointer-events
// disabling) instead. The underlying pickExcelFile/handleFallbackFileChange handler-side
// checks in index.tsx are unchanged and remain the authoritative reject path.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import PhaseOneUpload from "./PhaseOneUpload";

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
    expect(grid.style.pointerEvents).not.toBe("none");
  });

  it("failure: the upload grid is visually + interactively disabled with a denial title when canUpload is false", () => {
    const { container } = render(<PhaseOneUpload {...baseProps({ canUpload: false })} />);
    const grid = container.querySelector(".upload-grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute("aria-disabled")).toBe("true");
    expect(grid.getAttribute("title")).toBe(
      "لا تملك صلاحية رفع ملفات البيانات، أو أن الشهر مغلق حالياً، أو أن بيانات الشهر قيد التحميل."
    );
    expect(grid.style.pointerEvents).toBe("none");
    expect(grid.style.opacity).toBe("0.55");
  });
});
