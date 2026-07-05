/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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

describe("DataTable sticky column offset", () => {
  it("accounts for the width of non-sticky columns positioned before a sticky column", () => {
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

    const headerCells = Array.from(container.querySelectorAll("th.dt-th"));
    const statusHeader = headerCells.find((th) => th.textContent?.includes("Status"));
    expect(statusHeader).toBeTruthy();

    // 5 equal-width (widthFr:10) columns => each is 20% of the total.
    // "status" is the 5th column, so its true offset from the start edge is
    // the sum of the first 4 columns' widths: 80%, not just the sticky "id"
    // column's width (20%).
    const right = (statusHeader as HTMLElement).style.right;
    expect(right).toBe("80%");
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
