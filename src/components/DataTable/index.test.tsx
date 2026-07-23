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
import { looksLikeNumber } from "./utils";

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

  it("limits large datasets to 100-row pages and can move to the next page", () => {
    const rows = Array.from({ length: 150 }, (_, index): Row => ({
      id: String(index + 1),
      name: `اسم ${index + 1}`,
      port: "جدة",
      note: `ملاحظة ${index + 1}`,
    }));

    renderTable({ rows });

    expect(screen.getByText(/عرض 1 إلى 100 من 150 صف/)).toBeInTheDocument();
    expect(screen.getByText("اسم 1")).toBeInTheDocument();
    expect(screen.queryByText("اسم 101")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "الصفحة التالية" }));

    expect(screen.getByText(/عرض 101 إلى 150 من 150 صف/)).toBeInTheDocument();
    expect(screen.getByText("اسم 101")).toBeInTheDocument();
    expect(screen.queryByText("اسم 1")).not.toBeInTheDocument();
  });

  it("searches the full dataset and finds a match beyond the first 100 rows", async () => {
    const rows = Array.from({ length: 150 }, (_, index): Row => ({
      id: String(index + 1),
      name: `اسم ${index + 1}`,
      port: "جدة",
      note: index === 149 ? "المطابقة المتأخرة" : "ملاحظة عادية",
    }));

    renderTable({ rows });
    fireEvent.change(screen.getByPlaceholderText("بحث في جميع الأعمدة..."), {
      target: { value: "المطابقة المتأخرة" },
    });

    await waitFor(() => expect(screen.getByText("اسم 150")).toBeInTheDocument());
    expect(screen.queryByText("اسم 1")).not.toBeInTheDocument();
    expect(screen.getByText(/^1 \/ 150 صف$/)).toBeInTheDocument();
  });

  it("resets to page 1 when search changes", async () => {
    const rows = Array.from({ length: 150 }, (_, index): Row => ({
      id: String(index + 1),
      name: `اسم ${index + 1}`,
      port: "جدة",
      note: index < 120 ? "مجموعة البحث" : "خارج المجموعة",
    }));

    renderTable({ rows });
    fireEvent.click(screen.getByRole("button", { name: "الصفحة التالية" }));
    expect(screen.getByText(/عرض 101 إلى 150 من 150 صف/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("بحث في جميع الأعمدة..."), {
      target: { value: "مجموعة البحث" },
    });

    await waitFor(() => expect(screen.getByText(/عرض 1 إلى 100 من 120 صف/)).toBeInTheDocument());
    expect(screen.getByText("اسم 1")).toBeInTheDocument();
  });

  it("exports every filtered row, not only the visible 100-row page", () => {
    const rows = Array.from({ length: 150 }, (_, index): Row => ({
      id: String(index + 1),
      name: `اسم ${index + 1}`,
      port: "جدة",
      note: `ملاحظة ${index + 1}`,
    }));
    const writeFile = vi.mocked(XLSX.writeFile);
    writeFile.mockClear();

    renderTable({ rows });
    fireEvent.click(screen.getByRole("button", { name: "تصدير XLSX" }));

    const workbook = writeFile.mock.calls[0]?.[0];
    expect(workbook).toBeDefined();
    const worksheet = workbook?.Sheets[workbook.SheetNames[0]!];
    const exportedRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet!, { header: 1 });
    expect(exportedRows).toHaveLength(151);
  });
});

// B11 — DataTable hardening: last-visible-column guard, empty-results
// placeholder, and an explicit aria-label on the per-column filter button.
describe("DataTable — B11 hardening", () => {
  it("refuses to hide the last visible column via the column-visibility picker", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));
    const hideButtons = screen.getAllByTitle("إخفاء");
    expect(hideButtons).toHaveLength(COLUMNS.length);

    // Hide two of the three columns (index order [name, port, note]), leaving
    // exactly one ("الاسم") visible.
    fireEvent.click(hideButtons[2]!); // hide "ملاحظة"
    fireEvent.click(screen.getAllByTitle("إخفاء")[1]!); // hide "المنفذ"

    await waitFor(() => expect(screen.queryByText(LONG_NOTE)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^الأعمدة/ })).toHaveTextContent("الأعمدة (1)");

    // No "إخفاء" toggle remains — the last visible column's button switches to
    // a disabled hint instead, so the grid can never go fully blank.
    expect(screen.queryAllByTitle("إخفاء")).toHaveLength(0);
    const lastToggle = screen.getByTitle("يجب أن يبقى عمود واحد ظاهرًا على الأقل");
    expect(lastToggle).toBeDisabled();

    // Clicking it anyway must not hide the column.
    fireEvent.click(lastToggle);
    expect(screen.getByRole("button", { name: /^الأعمدة/ })).toHaveTextContent("الأعمدة (1)");
    expect(screen.getByText("أحمد")).toBeInTheDocument();
  });

  it("shows a 'no matching results' placeholder when search hides every row but data exists", async () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("بحث في جميع الأعمدة..."), {
      target: { value: "نص-غير-موجود-إطلاقا" },
    });

    await waitFor(() => expect(screen.getByText("لا توجد نتائج مطابقة")).toBeInTheDocument());
    expect(screen.queryByText("أحمد")).not.toBeInTheDocument();
  });

  it("does not show the empty-results placeholder when rows are present and unfiltered", () => {
    renderTable();
    expect(screen.queryByText("لا توجد نتائج مطابقة")).not.toBeInTheDocument();
  });

  it("exposes an aria-label on the per-column filter button (its visible content is only '▾')", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "تصفية: المنفذ" })).toBeInTheDocument();
  });
});

describe("looksLikeNumber — B11 bound on the plain-digit alternative", () => {
  it("still matches short magnitudes, decimals, percentages, and thousand-separated numbers", () => {
    expect(looksLikeNumber("123456")).toBe(true);
    expect(looksLikeNumber("42")).toBe(true);
    expect(looksLikeNumber("-42")).toBe(true);
    expect(looksLikeNumber("99.5%")).toBe(true);
    expect(looksLikeNumber("1,234,567")).toBe(true);
  });

  it("rejects phone-number-shaped and long-ID-shaped digit strings that merely look numeric", () => {
    expect(looksLikeNumber("0501234567")).toBe(false); // 10-digit mobile number
    expect(looksLikeNumber("1234567890123")).toBe(false); // 13-digit national ID
    expect(looksLikeNumber("1234567")).toBe(false); // 7 digits — just past the ~6-digit bound
  });
});
