/* @vitest-environment jsdom */
// T-17 regression: the shared DataTable used to throw the reader back to page 1
// on an ordinary background refresh.
//
// Pagination was keyed off a digest of the rows themselves — row count plus the
// first and last row key. Every consumer of this table re-reads its data on the
// 45s sync tick and on the manual refresh button, so any refresh in which a row
// had been added, removed or reordered produced a different digest and silently
// reset the page. That is exactly what the workspace-sync layer's own rule
// forbids ("a refresh must never clobber unsaved local state") applied to the
// reader's position instead of to a draft.
//
// `resetToken` replaces the digest: the page moves on a real, user-driven
// context change and on nothing else. When the data shrinks under the current
// page the table CLAMPS to the last page that exists rather than resetting —
// the shrunk rows are at the end, so that is where the reader was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DataTable, { type DataTableCol } from "./index";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Row = { id: string; name: string };

const COLUMNS: DataTableCol<Row>[] = [
  { id: "name", label: "الاسم", accessor: (r) => r.name },
];

/** `count` rows, optionally offset so the SET differs while the shape does not. */
function makeRows(count: number, prefix = "اسم"): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} ${index + 1}`,
  }));
}

function renderTable(rows: Row[], resetToken?: string) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={rows}
      getRowKey={(r) => r.id}
      renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      resetToken={resetToken}
    />
  );
}

function summary(): string {
  return document.querySelector(".data-pagination-summary")?.textContent ?? "";
}

function goToPage(page: number): void {
  const input = screen.getByLabelText("رقم الصفحة");
  fireEvent.change(input, { target: { value: String(page) } });
  fireEvent.blur(input);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DataTable — page retention across refreshes", () => {
  it("stays on the current page when the rows array is replaced within the same context", () => {
    const { rerender } = renderTable(makeRows(350), "5-may-2026");
    goToPage(3);
    expect(summary()).toMatch(/عرض 201 إلى 300 من 350 صف/);

    // The background refresh: same month, fresh array, and one more row — the
    // shape change that used to invalidate the old rows digest.
    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={makeRows(351)}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => <span>{col.accessor(row)}</span>}
        resetToken="5-may-2026"
      />
    );

    expect(summary()).toMatch(/عرض 201 إلى 300 من 351 صف/);
    expect(screen.getByText("اسم 201")).toBeInTheDocument();
  });

  it("returns to page 1 when the context token changes", () => {
    const { rerender } = renderTable(makeRows(350), "5-may-2026");
    goToPage(3);
    expect(summary()).toMatch(/عرض 201 إلى 300 من 350 صف/);

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={makeRows(350, "أخرى")}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => <span>{col.accessor(row)}</span>}
        resetToken="4-april-2026"
      />
    );

    expect(summary()).toMatch(/عرض 1 إلى 100 من 350 صف/);
    expect(screen.getByText("أخرى 1")).toBeInTheDocument();
  });

  it("clamps to the last remaining page — not page 1 — when the data shrinks under it", () => {
    const { rerender } = renderTable(makeRows(500), "5-may-2026");
    goToPage(5);
    expect(summary()).toMatch(/عرض 401 إلى 500 من 500 صف/);

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={makeRows(250)}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => <span>{col.accessor(row)}</span>}
        resetToken="5-may-2026"
      />
    );

    expect(summary()).toMatch(/عرض 201 إلى 250 من 250 صف/);
  });

  it("still returns to page 1 when the user changes a column filter", () => {
    renderTable(
      [...makeRows(150), ...makeRows(150, "أخرى")],
      "5-may-2026"
    );
    goToPage(3);
    expect(summary()).toMatch(/عرض 201 إلى 300 من 300 صف/);

    fireEvent.click(screen.getByRole("button", { name: "تصفية: الاسم" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "اسم 1" }));

    // One matching row left: the pagination bar disappears entirely, and the
    // single visible cell is the filtered value — i.e. the view went back to the
    // top instead of staying on a page 3 that no longer exists.
    expect(summary()).toBe("");
    const cells = Array.from(document.querySelectorAll(".dt-td")).map((td) => td.textContent);
    expect(cells).toEqual(["اسم 1"]);
  });

  it("keeps the page across a refresh even with no resetToken at all", () => {
    const { rerender } = render(
      <DataTable<Row>
        columns={COLUMNS}
        rows={makeRows(350)}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      />
    );
    goToPage(3);
    expect(summary()).toMatch(/عرض 201 إلى 300 من 350 صف/);

    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={makeRows(360)}
        getRowKey={(r) => r.id}
        renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      />
    );

    expect(summary()).toMatch(/عرض 201 إلى 300 من 360 صف/);
  });
});
