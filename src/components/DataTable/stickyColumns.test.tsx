/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import DataTable, { type DataTableCol } from "./index";

// jsdom has no ResizeObserver; DataTable observes the scroll container for
// row virtualisation, which isn't exercised by this test.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver;

afterEach(() => cleanup());

type Row = { id: string; a: string; b: string; c: string };

// Five columns, only the 1st and 5th are sticky. The 3 columns in between
// are NOT sticky, so a correct implementation must still count their width
// when computing the 5th column's pinned offset from the RTL start edge.
const columns: DataTableCol<Row>[] = [
  { id: "id", label: "ID", widthFr: 10, alwaysVisible: true, accessor: (r) => r.id },
  { id: "a",  label: "A",  widthFr: 10, accessor: (r) => r.a },
  { id: "b",  label: "B",  widthFr: 10, accessor: (r) => r.b },
  { id: "c",  label: "C",  widthFr: 10, accessor: (r) => r.c },
  { id: "status", label: "Status", widthFr: 10, alwaysVisible: true, accessor: () => "" },
];

/**
 * jsdom performs no layout, so every element's real `getBoundingClientRect`
 * is always zero -- it cannot stand in for a real column's rendered width.
 * `.dt-table` deliberately uses `table-layout: auto` (see DataTable.css), so
 * the sticky offset is computed from MEASURED header-cell widths, not from
 * `widthFr`/`colCfg.widths` percentages (that was the bug: the percentage
 * model silently drifts from the real, content-driven rendered widths). This
 * stub gives each `.dt-th` a fixed width by its visible label so the offset
 * math itself can still be pinned deterministically without a real browser.
 */
function stubHeaderWidths(widthsByLabel: Record<string, number>): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("dt-th")) {
      const label = this.querySelector(".dt-th-label")?.textContent ?? "";
      const width = widthsByLabel[label] ?? 0;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() { return {}; } } as DOMRect;
    }
    return original.call(this);
  };
  return () => { HTMLElement.prototype.getBoundingClientRect = original; };
}

function stickyRightPx(container: HTMLElement, label: string): string {
  const headerCells = Array.from(container.querySelectorAll("th.dt-th"));
  const header = headerCells.find((th) => th.querySelector(".dt-th-label")?.textContent === label);
  expect(header).toBeTruthy();
  return (header as HTMLElement).style.right;
}

describe("DataTable sticky column offset", () => {
  it("accounts for the MEASURED width of non-sticky columns positioned before a sticky column", () => {
    const restore = stubHeaderWidths({ ID: 40, A: 60, B: 70, C: 50, Status: 90 });
    const { container } = render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        renderCell={(col) => col.label}
        storageKey="test-sticky"
        stickyColumnIds={["id", "status"]}
      />
    );

    // "status" is the 5th column; its true offset from the RTL start edge is
    // the sum of the 4 columns actually rendered before it (40+60+70+50=220px),
    // not just the sticky "id" column's own width (40px).
    expect(stickyRightPx(container, "Status")).toBe("220px");
    restore();
  });

  it("re-measures and moves the sticky offset after a column is dragged ahead of it", () => {
    // Distinct, asymmetric widths so a wrong (stale) offset is unmistakable.
    const restore = stubHeaderWidths({ ID: 40, A: 60, B: 70, C: 50, Status: 90 });
    const { container } = render(
      <DataTable<Row>
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        renderCell={(col) => col.label}
        storageKey="test-sticky-reorder"
        stickyColumnIds={["id", "status"]}
      />
    );
    expect(stickyRightPx(container, "Status")).toBe("220px");

    // Drag column "C" (50px) to sit immediately before the sticky "id" column —
    // the exact shape of the reported bug: a non-sticky column moved ahead of a
    // sticky one. The table-header drag path reads only `dragColRef` (set by
    // `onDragStart`) on drop, so a plain dragStart+drop pair is enough to
    // exercise the real `handleDrop` reducer, no DataTransfer needed.
    const headerCells = () => Array.from(container.querySelectorAll("th.dt-th"));
    const cHeader = headerCells().find((th) => th.querySelector(".dt-th-label")?.textContent === "C")!;
    const idHeader = headerCells().find((th) => th.querySelector(".dt-th-label")?.textContent === "ID")!;
    fireEvent.dragStart(cHeader);
    fireEvent.drop(idHeader);

    // "ID" was the very first column (offset 0px). "C" (50px) is now dragged
    // ahead of it, so "ID"'s own sticky offset must move to 50px. A stale
    // (unmeasured) offset would leave this at 0px -- exactly the bug: a
    // sticky column's CSS `right` not accounting for a column newly placed
    // ahead of it after a reorder.
    expect(stickyRightPx(container, "ID")).toBe("50px");
    restore();
  });
});

describe("DataTable default column order", () => {
  it("orders visible columns by defaultVisible, not by raw definition order", () => {
    // Definition order deliberately differs from the intended default display
    // order (defaultVisible) — mirrors how buildXrayColumns defines "status"
    // near the end while DEFAULT_VISIBLE wants it shown 2nd, right after "id".
    const defColumns: DataTableCol<Row>[] = [
      { id: "id",     label: "ID",     widthFr: 10, alwaysVisible: true, accessor: (r) => r.id },
      { id: "a",      label: "A",      widthFr: 10, accessor: (r) => r.a },
      { id: "b",      label: "B",      widthFr: 10, accessor: (r) => r.b },
      { id: "c",      label: "C",      widthFr: 10, accessor: (r) => r.c },
      { id: "status", label: "Status", widthFr: 10, alwaysVisible: true, accessor: () => "" },
    ];
    const { container } = render(
      <DataTable<Row>
        columns={defColumns}
        rows={[]}
        getRowKey={(r) => r.id}
        renderCell={(col) => col.label}
        storageKey="test-order"
        defaultVisible={["id", "status", "a"]}
      />
    );

    const labels = Array.from(container.querySelectorAll(".dt-th-label")).map((el) => el.textContent);
    expect(labels).toEqual(["ID", "Status", "A"]);
  });
});
