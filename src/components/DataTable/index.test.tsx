/* @vitest-environment jsdom */
// D1 (Batch 3) — characterization test pinning the CURRENT behavior of the shared DataTable.
//
// NOTE on "sort": DataTable has NO row-sort UI (verified — no sortBy/sortDir/row comparator).
// Its interactive surface is: global search, per-column filters (multiselect/text/date/status),
// column visibility + drag-reorder + resize, and XLSX export. The plan's "sort" item is therefore
// covered here as FILTERING (global search + per-column multiselect). If a row-sort feature is ever
// added, this header note is the signal to extend these tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import * as XLSX from "xlsx";
import DataTable, { type DataTableCol } from "./index";

// The vendored xlsx module namespace is frozen (ESM), so `vi.spyOn` can't replace writeFile.
// Partial-mock the module: keep the real `utils` (the export builds a real sheet) but stub
// `writeFile` so no download is attempted in jsdom and we can assert the export path fired.
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

// jsdom has no ResizeObserver; DataTable observes its scroll container for virtualization.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Row = { id: string; name: string; port: string; note: string };

const LONG_NOTE =
  "ملاحظة طويلة جداً لا تتّسع داخل الخلية وتُقتطع بصرياً مع تلميح يعرض القيمة كاملة";

const ROWS: Row[] = [
  { id: "1", name: "أحمد", port: "جدة", note: LONG_NOTE },
  { id: "2", name: "سالم", port: "الدمام", note: "ملاحظة سالم" },
  { id: "3", name: "خالد", port: "جدة", note: "ملاحظة خالد" },
  { id: "4", name: "فهد", port: "جدة", note: "ملاحظة فهد" },
  { id: "5", name: "نورة", port: "الدمام", note: "ملاحظة نورة" },
];

const COLUMNS: DataTableCol<Row>[] = [
  { id: "name", label: "الاسم", accessor: (r) => r.name },
  { id: "port", label: "المنفذ", accessor: (r) => r.port },
  { id: "note", label: "ملاحظة", accessor: (r) => r.note },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      storageKey="test-datatable"
      exportFileName="test-export.xlsx"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DataTable — RTL render + interactions (characterization)", () => {
  it("renders every row and column header", () => {
    renderTable();
    for (const col of COLUMNS) expect(screen.getByText(col.label)).toBeInTheDocument();
    for (const row of ROWS) expect(screen.getByText(row.name)).toBeInTheDocument();
  });

  it("global search filters rows down to matches (debounced)", async () => {
    renderTable();
    const search = screen.getByPlaceholderText("بحث في جميع الأعمدة...");
    fireEvent.change(search, { target: { value: "سالم" } });

    await waitFor(() => expect(screen.queryByText("أحمد")).not.toBeInTheDocument());
    expect(screen.getByText("سالم")).toBeInTheDocument();
    expect(screen.queryByText("خالد")).not.toBeInTheDocument();
  });

  it("per-column multiselect filter narrows to the checked value", async () => {
    renderTable();
    // Open the port column's filter menu, then check "جدة".
    fireEvent.click(screen.getByTitle("تصفية: المنفذ"));
    const jeddahOption = await screen.findByRole("checkbox", { name: "جدة" });
    fireEvent.click(jeddahOption);

    // Only جدة rows remain; a الدمام row (سالم) is filtered out.
    await waitFor(() => expect(screen.queryByText("سالم")).not.toBeInTheDocument());
    expect(screen.getByText("أحمد")).toBeInTheDocument();
    expect(screen.getByText("خالد")).toBeInTheDocument();
  });

  it("hides a column via the column-visibility picker", async () => {
    renderTable();
    // The note value only appears in a table cell (not in the picker, which shows the label).
    expect(screen.getByText(LONG_NOTE)).toBeInTheDocument();

    // /^الأعمدة/ targets the picker button ("الأعمدة (3)"), not the "ملاءمة الأعمدة" autofit button.
    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    // One "إخفاء" toggle per visible column, in column order [name, port, note] → index 2 = note.
    const hideButtons = screen.getAllByTitle("إخفاء");
    expect(hideButtons).toHaveLength(COLUMNS.length);
    fireEvent.click(hideButtons[2]);

    await waitFor(() => expect(screen.queryByText(LONG_NOTE)).not.toBeInTheDocument());
    // Other columns still render.
    expect(screen.getByText("أحمد")).toBeInTheDocument();
  });

  it("XLSX export builds a workbook and calls writeFile with the file name", () => {
    const writeFile = vi.mocked(XLSX.writeFile);
    writeFile.mockClear();
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "تصدير XLSX" }));
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toBe("test-export.xlsx");
  });

  it("truncation tooltip: each cell carries its full value as a title attribute", () => {
    renderTable();
    const cell = screen.getByText(LONG_NOTE).closest("td");
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute("title", LONG_NOTE);
  });
});
