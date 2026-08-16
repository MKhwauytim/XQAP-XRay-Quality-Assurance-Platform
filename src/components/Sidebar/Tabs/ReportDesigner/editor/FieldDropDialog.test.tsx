/* @vitest-environment jsdom */
// Overlay/a11y regression: FieldDropDialog put its primary "إضافة" button first
// in an RTL row, i.e. rightmost — the opposite of the 11 other confirm-style
// dialogs in the app, which all put Cancel rightmost. Both buttons also lacked
// an explicit `type`.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import FieldDropDialog from "./FieldDropDialog";
import { getLabels } from "../../../../../data/labels/labelsStore";

afterEach(cleanup);

function renderDialog() {
  return render(
    <FieldDropDialog
      fieldLabel="المنفذ"
      fieldName="portName"
      role="dimension"
      screenX={10}
      screenY={10}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe("FieldDropDialog — action row", () => {
  it("puts Cancel first (rightmost in RTL), matching every other confirm dialog", () => {
    renderDialog();
    const labels = getLabels();

    const cancel = screen.getByRole("button", { name: labels.rd_cancel_btn });
    const add = screen.getByRole("button", { name: labels.rd_add_btn });
    const row = cancel.parentElement as HTMLElement;

    expect(row).toBe(add.parentElement);
    expect(Array.from(row.children).indexOf(cancel)).toBeLessThan(
      Array.from(row.children).indexOf(add)
    );
  });

  it("gives both action buttons an explicit type", () => {
    renderDialog();
    const labels = getLabels();

    expect(
      screen.getByRole("button", { name: labels.rd_cancel_btn }).getAttribute("type")
    ).toBe("button");
    expect(
      screen.getByRole("button", { name: labels.rd_add_btn }).getAttribute("type")
    ).toBe("button");
  });
});
