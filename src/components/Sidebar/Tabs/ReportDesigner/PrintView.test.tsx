/* @vitest-environment jsdom */
// Overlay/a11y regression: the print preview is a full-screen `position: fixed`
// overlay that covers the whole app, but it had no `role="dialog"`, no
// accessible name, no focus trap and no Escape — the only exit was clicking its
// "رجوع" button. Its two buttons also had no `type`, so inside a form they
// would default to `submit`.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrintView from "./PrintView";
import { createEmptyDocument, createElementId } from "../../../../data/reportDesigner/reportTypes";
import type { Element, ReportDocument } from "../../../../data/reportDesigner/reportTypes";
import { getLabels } from "../../../../data/labels/labelsStore";

afterEach(cleanup);

function docWithOneElement(): ReportDocument {
  const doc = createEmptyDocument("تقرير اختبار", "tester");
  const el: Element = {
    elementId: createElementId(),
    type: "text",
    name: "عنصر",
    x: 10, y: 10, w: 100, h: 40, z: 0,
    style: {},
    config: { kind: "text", text: "مرحبا" },
  };
  doc.pages[0].elements.push(el);
  return doc;
}

describe("PrintView — overlay accessibility", () => {
  it("exposes the overlay as a labelled dialog and moves focus into it", () => {
    render(<PrintView doc={docWithOneElement()} onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: getLabels().rd_print_view_aria });
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<PrintView doc={docWithOneElement()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives both toolbar buttons an explicit type", () => {
    render(<PrintView doc={docWithOneElement()} onClose={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("type")).toBe("button");
    }
  });
});
