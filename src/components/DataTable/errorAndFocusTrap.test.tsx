/* @vitest-environment jsdom */
// Regression tests for two audit findings scoped to the shared DataTable:
//
//  Finding 10 (shared pattern flagged alongside BrowseDataView's own export
//  bug) — `handleExport` was a bare try/finally with NO catch and no error
//  state at all: a thrown error became an unhandled rejection while `finally`
//  cleared `isExporting` as if the export had succeeded, with zero feedback
//  to the user. Fixed with a catch that logs the failure and surfaces a
//  role="alert" banner (mirrors BrowseDataView's own bv-export-error).
//
//  Finding 11 — DataTable's column-visibility picker and per-column filter
//  menu were the only overlay surfaces in the app not wired through the
//  shared `useFocusTrap` hook (no focus trap, no Escape-to-close). Fixed by
//  swapping their plain outside-click-only refs for `useFocusTrap`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataTable, { type DataTableCol } from "./index";
import { clearErrors, getRecentErrors } from "../../data/storage/errorLogger";

const writeFileSpy = vi.fn();

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: (...args: unknown[]) => writeFileSpy(...args) };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

type Row = { id: string; name: string; port: string };

const ROWS: Row[] = [
  { id: "1", name: "أحمد", port: "جدة" },
  { id: "2", name: "سالم", port: "الدمام" },
];

const COLUMNS: DataTableCol<Row>[] = [
  { id: "name", label: "الاسم", accessor: (r) => r.name },
  { id: "port", label: "المنفذ", accessor: (r) => r.port },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => r.id}
      renderCell={(col, row) => <span>{col.accessor(row)}</span>}
      exportFileName="test-export.xlsx"
      {...props}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  writeFileSpy.mockReset();
  clearErrors();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DataTable — export failure is caught and surfaced (finding 10)", () => {
  it("shows an alert banner, logs the failure, and re-enables the export button instead of failing silently", async () => {
    writeFileSpy.mockImplementation(() => {
      throw new Error("disk full");
    });

    renderTable();
    const exportButton = screen.getByRole("button", { name: "تصدير XLSX" });
    fireEvent.click(exportButton);

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toMatch(/تعذّر تصدير البيانات/);
    expect(exportButton).toBeEnabled();

    expect(getRecentErrors().some((entry) => entry.context === "datatable:export")).toBe(true);
  });

  it("a subsequent successful export clears the earlier error banner", async () => {
    writeFileSpy.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    renderTable();
    const exportButton = screen.getByRole("button", { name: "تصدير XLSX" });
    fireEvent.click(exportButton);
    await screen.findByRole("alert");

    fireEvent.click(exportButton);
    await waitFor(() => expect(writeFileSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DataTable — column picker focus trap (finding 11)", () => {
  it("moves focus into the picker when it opens and closes it on Escape", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^الأعمدة/ }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("DataTable — column filter menu focus trap (finding 11)", () => {
  it("moves focus into the filter menu when it opens and closes it on Escape", () => {
    renderTable();
    fireEvent.click(screen.getByTitle("تصفية: المنفذ"));

    const dialog = screen.getByRole("dialog", { name: "المنفذ" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "المنفذ" })).not.toBeInTheDocument();
  });
});
