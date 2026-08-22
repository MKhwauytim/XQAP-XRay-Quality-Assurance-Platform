/* @vitest-environment jsdom */
// Placement regressions for DataTable's two floating surfaces (the column
// picker and the per-column filter menu), which appear on nearly every tab.
//
// Both used to position themselves by hand: `position: fixed` with a DOMRect
// snapshotted at click time and, for the filter menu, an unclamped
// `right: window.innerWidth - anchorRect.right`. That meant (a) the menu was
// stranded away from its button as soon as anything scrolled, (b) a button low
// on the screen opened a menu whose footer ran off the bottom, and (c) the
// physically-leftmost columns of a wide RTL table opened a menu off the left
// edge entirely. Positioning now belongs to AnchoredPopover.
//
// jsdom does no layout, so these assert the observable contract — portal
// target, classes, inline properties, chosen side — not measured pixels.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import DataTable, { type DataTableCol } from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Row = { id: string; name: string; port: string };

const ROWS: Row[] = [
  { id: "1", name: "أحمد", port: "جدة" },
  { id: "2", name: "سالم", port: "الدمام" }
];

const COLUMNS: DataTableCol<Row>[] = [
  { id: "name", label: "الاسم", accessor: (r) => r.name },
  { id: "port", label: "المنفذ", accessor: (r) => r.port }
];

function stubRect(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    }) as DOMRect;
}

function renderTable() {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      exportFileName="test-export.xlsx"
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("innerWidth", 1000);
  vi.stubGlobal("innerHeight", 800);
  document.documentElement.setAttribute("dir", "rtl");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("dir");
});

describe("DataTable — column filter menu placement", () => {
  it("escapes the scrolling table wrapper by rendering into document.body", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("تصفية: المنفذ"));

    const menu = screen.getByRole("dialog", { name: "المنفذ" });
    // Previously a child of the `th`, inside `.dt-table-wrap` (overflow: auto).
    expect(menu.closest(".dt-table-wrap")).toBeNull();
    expect(menu.closest("th")).toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expect(menu.classList.contains("ui-anchored-popover")).toBe(true);
    expect(menu.classList.contains("dt-filter-menu")).toBe(true);
  });

  it("positions with physical top/left and a viewport clamp, not a hard-coded right offset", () => {
    renderTable();
    const button = screen.getByTitle("تصفية: المنفذ");
    stubRect(button, 400, 200, 24, 24);
    fireEvent.click(button);

    const menu = screen.getByRole("dialog", { name: "المنفذ" });
    expect(menu.style.top).not.toBe("");
    expect(menu.style.left).not.toBe("");
    expect(menu.style.maxHeight).not.toBe("");
    expect(menu.style.maxWidth).not.toBe("");
    // The old implementation set `right`; a logical inset would flip RTL twice.
    expect(menu.style.right).toBe("");
    expect(menu.style.getPropertyValue("inset-inline-start")).toBe("");
  });

  it("keeps Escape-to-close and focus containment after being portalled", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("تصفية: المنفذ"));

    const menu = screen.getByRole("dialog", { name: "المنفذ" });
    expect(menu.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "المنفذ" })).toBeNull();
  });
});

describe("DataTable — column picker placement", () => {
  it("renders into document.body with the shared positioning class", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));

    const picker = screen.getByRole("dialog");
    expect(picker.parentElement).toBe(document.body);
    expect(picker.classList.contains("ui-anchored-popover")).toBe(true);
    expect(picker.classList.contains("dt-col-picker")).toBe(true);
    expect(picker.style.top).not.toBe("");
    expect(picker.style.left).not.toBe("");
  });

  it("flips above its button when the button sits near the bottom of the viewport", () => {
    renderTable();
    const button = screen.getByRole("button", { name: /^الأعمدة/ });
    // The picker is ~460px tall (360px list + header/hint/footer); jsdom
    // measures 0, so stub the popover's own rect once it exists.
    stubRect(button, 700, 740, 120, 30);
    fireEvent.click(button);

    const picker = screen.getByRole("dialog");
    expect(picker.dataset.placement).toBe("below"); // jsdom measures it as 0-high
    stubRect(picker, 0, 0, 300, 460);
    // Any reposition trigger re-reads both rects.
    fireEvent.scroll(window);

    expect(picker.dataset.placement).toBe("above");
  });
});
