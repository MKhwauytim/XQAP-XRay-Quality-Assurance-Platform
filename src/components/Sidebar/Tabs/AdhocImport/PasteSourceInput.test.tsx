/* @vitest-environment jsdom */
// PasteSourceInput is the ad-hoc import's clipboard entry point. What matters
// here is that a real Excel TSV payload lands as a `SourceTable` with the right
// row count, and that the two ways an operator's paste can be useless (nothing
// at all, headers with no data) surface as readable Arabic rather than as a
// throw inside a paste handler.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { PASTE_SHEET_NAME } from "../../../../data/adhocImport/adhocImportModel";
import type { SourceTable } from "../../../../data/adhocImport/adhocImportModel";
import PasteSourceInput from "./PasteSourceInput";

afterEach(cleanup);

const TSV = [
  "معرف الأشعة\tاسم المنفذ\tنتيجة المستوى الأول",
  "XR-1\tميناء جدة\tسليمة",
  "XR-2\tميناء الدمام\tاشتباه",
  "XR-3\tميناء جدة\tسليمة",
].join("\n");

function pasteInto(text: string): void {
  const zone = screen.getByLabelText(DEFAULT_LABELS.adhoc_paste_aria);
  fireEvent.paste(zone, { clipboardData: { getData: () => text } });
}

describe("PasteSourceInput", () => {
  it("parses a TSV paste and reports the row and column counts", () => {
    const onTable = vi.fn<(table: SourceTable) => void>();
    render(<PasteSourceInput onTable={onTable} />);

    pasteInto(`${TSV}\n`);

    expect(onTable).toHaveBeenCalledTimes(1);
    const table = onTable.mock.calls[0][0];
    expect(table.sheetName).toBe(PASTE_SHEET_NAME);
    expect(table.headers).toHaveLength(3);
    // Three data rows — the header line is not one of them.
    expect(table.rows).toHaveLength(3);
    // `sourceRowNumber` counts the header as line 1, so the first data row is 2.
    expect(table.rows[0].sourceRowNumber).toBe(2);

    expect(
      screen.getByText(
        DEFAULT_LABELS.adhoc_paste_summary.replace("{rows}", "3").replace("{cols}", "3")
      )
    ).toBeInTheDocument();
    // The preview shows the data itself, not just a count.
    expect(screen.getByText("ميناء الدمام")).toBeInTheDocument();
  });

  it("shows a friendly message and emits nothing for an empty paste", () => {
    const onTable = vi.fn<(table: SourceTable) => void>();
    render(<PasteSourceInput onTable={onTable} />);

    pasteInto("   \n  \n");

    expect(onTable).not.toHaveBeenCalled();
    expect(screen.getByText(DEFAULT_LABELS.adhoc_paste_empty_error)).toBeInTheDocument();
  });

  it("reports a header-only paste separately from an empty one", () => {
    const onTable = vi.fn<(table: SourceTable) => void>();
    render(<PasteSourceInput onTable={onTable} />);

    pasteInto("معرف الأشعة\tاسم المنفذ\n");

    expect(onTable).not.toHaveBeenCalled();
    expect(screen.getByText(DEFAULT_LABELS.adhoc_paste_no_rows_error)).toBeInTheDocument();
  });

  it("ignores a paste while disabled", () => {
    const onTable = vi.fn<(table: SourceTable) => void>();
    render(<PasteSourceInput onTable={onTable} disabled />);

    pasteInto(TSV);

    expect(onTable).not.toHaveBeenCalled();
  });
});
