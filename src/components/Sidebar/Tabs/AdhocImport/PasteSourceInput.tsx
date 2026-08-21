import { useState } from "react";
import type { ClipboardEvent } from "react";
import { ClipboardList } from "lucide-react";

import { parsePastedTable } from "../../../../data/adhocImport/adhocSourceTable";
import type { SourceTable } from "../../../../data/adhocImport/adhocImportModel";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import "./MappingWorkbench.css";

/** How many rows the confirmation preview shows. Enough to recognise the file, short enough to stay a chip-sized reassurance rather than a second grid. */
const PREVIEW_ROW_COUNT = 5;

type PasteSourceInputProps = {
  onTable: (table: SourceTable) => void;
  disabled?: boolean;
};

/**
 * Excel-paste entry point for an ad-hoc import, modelled on the Population
 * tab's `CertScanGrid` drop zone: a focusable div rather than a textarea,
 * because the operator never types here — they click once and press Ctrl+V,
 * and a textarea's caret/scroll affordances only suggest otherwise.
 *
 * The paste is handed straight to `parsePastedTable`, which owns the TSV
 * grammar and the `sourceRowNumber` convention. Nothing is validated here: a
 * paste that yields no headers or no data rows is reported as a message the
 * operator can act on, never as a thrown error — an empty clipboard is the
 * normal state of this control, not a fault.
 */
export default function PasteSourceInput({ onTable, disabled }: PasteSourceInputProps) {
  const labels = useLabels();
  const [preview, setPreview] = useState<SourceTable | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (disabled) return;

    let table: SourceTable;
    try {
      table = parsePastedTable(event.clipboardData.getData("text/plain"));
    } catch (cause) {
      // `parsePastedTable` is total over string input, so reaching here means
      // the clipboard itself misbehaved. Surface the same friendly message
      // rather than letting the error boundary swallow the whole tab.
      logError("PasteSourceInput.parse", cause);
      setPreview(null);
      setError(labels.adhoc_paste_empty_error);
      return;
    }

    if (table.headers.length === 0) {
      setPreview(null);
      setError(labels.adhoc_paste_empty_error);
      return;
    }
    if (table.rows.length === 0) {
      setPreview(null);
      setError(labels.adhoc_paste_no_rows_error);
      return;
    }

    setError(null);
    setPreview(table);
    onTable(table);
  }

  function handleClear(): void {
    setPreview(null);
    setError(null);
  }

  const previewRows = preview?.rows.slice(0, PREVIEW_ROW_COUNT) ?? [];

  return (
    <div className="amw-paste-root" dir="rtl">
      <div
        className="amw-paste-zone"
        tabIndex={disabled ? -1 : 0}
        role="textbox"
        aria-label={labels.adhoc_paste_aria}
        aria-disabled={disabled ? true : undefined}
        onPaste={handlePaste}
      >
        <span className="amw-paste-icon" aria-hidden="true">
          <ClipboardList size={28} />
        </span>
        <p className="amw-paste-title">{labels.adhoc_paste_title}</p>
        <p className="amw-paste-hint">{labels.adhoc_paste_hint}</p>
      </div>

      {error !== null && (
        <p className="amw-paste-error" role="status">
          {error}
        </p>
      )}

      {preview !== null && (
        <div className="amw-paste-preview">
          <div className="amw-paste-preview-head">
            <span className="amw-chip amw-chip-ok">
              {labels.adhoc_paste_summary
                .replace("{rows}", String(preview.rows.length))
                .replace("{cols}", String(preview.headers.length))}
            </span>
            <span className="amw-paste-preview-title">
              {labels.adhoc_paste_preview_title.replace(
                "{count}",
                String(previewRows.length)
              )}
            </span>
            <button
              type="button"
              className="amw-ghost-btn"
              onClick={handleClear}
              disabled={disabled}
            >
              {labels.adhoc_paste_clear}
            </button>
          </div>

          <div className="amw-scroll">
            <table className="amw-preview-table">
              <thead>
                <tr>
                  {preview.headers.map((header) => (
                    <th key={header} className="amw-th">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.sourceRowNumber}>
                    {preview.headers.map((header) => (
                      <td key={header} className="amw-td">
                        {row.values[header] === null || row.values[header] === undefined
                          ? ""
                          : String(row.values[header])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
