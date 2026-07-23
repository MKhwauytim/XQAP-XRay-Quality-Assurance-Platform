/* @vitest-environment jsdom */
// B6 — Ribbon must disable the mutation controls (save, page-size) for a view-only user
// (canEdit=false), while leaving navigation, layout toggles, and print available since
// those never write to the design document.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Ribbon from "./Ribbon";
import { createEmptyDocument } from "../../../../../data/reportDesigner/reportTypes";

afterEach(cleanup);

function renderRibbon(canEdit: boolean) {
  const doc = createEmptyDocument("تقرير اختبار", "tester");
  return render(
    <Ribbon
      doc={doc}
      saving={false}
      saveError={null}
      showFields
      showFormat
      canEdit={canEdit}
      onToggleFields={vi.fn()}
      onToggleFormat={vi.fn()}
      onSave={vi.fn()}
      onPrint={vi.fn()}
      onPageSizeChange={vi.fn()}
      onBack={vi.fn()}
    />
  );
}

describe("Ribbon — B6 canEdit gating", () => {
  it("disables save and page-size when canEdit=false", () => {
    renderRibbon(false);
    const saveBtn = screen.getByText("حفظ").closest("button") as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();
    const pageSizeSelect = screen.getByLabelText("حجم الصفحة") as HTMLSelectElement;
    expect(pageSizeSelect).toBeDisabled();
  });

  it("keeps print, back, and layout toggles enabled when canEdit=false", () => {
    renderRibbon(false);
    expect(screen.getByText("طباعة").closest("button")).not.toBeDisabled();
    expect(screen.getByText("رجوع").closest("button")).not.toBeDisabled();
    expect(screen.getByText("الحقول").closest("button")).not.toBeDisabled();
    expect(screen.getByText("التنسيق").closest("button")).not.toBeDisabled();
  });

  it("enables save and page-size when canEdit=true", () => {
    renderRibbon(true);
    expect(screen.getByText("حفظ").closest("button")).not.toBeDisabled();
    expect(screen.getByLabelText("حجم الصفحة")).not.toBeDisabled();
  });
});
