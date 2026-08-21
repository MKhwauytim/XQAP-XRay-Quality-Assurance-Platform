import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import {
  autoDetectMapping,
  findMappingIssues,
  setFieldSource,
} from "../../../../data/adhocImport/adhocMappingModel";
import type {
  AdhocField,
  FieldMappingOrigin,
  ImportMapping,
  SourceTable,
  ValueMapping,
} from "../../../../data/adhocImport/adhocImportModel";
import { useLabels } from "../../../../data/labels/useLabels";
import ValueMappingPanel from "./ValueMappingPanel";
import "./MappingWorkbench.css";

/**
 * Rows rendered in the preview grid. The grid exists to let the operator
 * recognise a column by its contents before binding it, which a screenful
 * answers; paging a 100k-row paste is the review table's job, not this one's.
 */
const GRID_ROW_LIMIT = 50;

type MappingWorkbenchProps = {
  table: SourceTable;
  catalog: AdhocField[];
  mapping: ImportMapping;
  onMappingChange: (next: ImportMapping) => void;
  disabled?: boolean;
};

/** True when nothing in `mapping` has been decided yet — the only state auto-detection may overwrite. */
function isUntouched(mapping: ImportMapping): boolean {
  return Object.values(mapping.fields).every((source) => source.kind === "none");
}

/**
 * Column mapping for an ad-hoc import: bind each catalog field to a column of
 * the operator's file, to a declared constant, or to nothing.
 *
 * THE INTERACTION is `CertScanGrid`'s highlighter, which the owner asked for by
 * name: arm a target, then click a column HEADER to bind it, and clicking a
 * header with nothing armed does nothing at all.
 *
 * THE COLOR RULE deliberately departs from CertScanGrid. That grid has exactly
 * two targets, so it can give each one a permanent identity color (Port red,
 * S/N blue) and tint the bound column to match. This catalog has 19 fields and
 * grows; nineteen identity colors are not distinguishable, and the ones that
 * survived would collide with the app's semantic palette (red already means
 * "wrong" everywhere else in this product). So color encodes STATE, not
 * identity — sky for a bound column, an amber ring on whatever is armed right
 * now, red only on a required field that is still unmapped — and the binding
 * itself is named in text on the field row, which is the part that has to stay
 * readable at nineteen rows.
 */
export default function MappingWorkbench({
  table,
  catalog,
  mapping,
  onMappingChange,
  disabled,
}: MappingWorkbenchProps) {
  const labels = useLabels();
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /**
   * Fields the admin bound by hand this session. Origin cannot be read off the
   * mapping alone — a `{kind:"column"}` source looks identical whether
   * auto-detection proposed it or a person clicked it — and the difference is
   * what the origin chip exists to report.
   */
  const [manualKeys, setManualKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Auto-detect ONCE, on mount, and only into an untouched mapping. Re-running
  // it on a later `table`/`catalog` change would silently discard bindings the
  // admin had already corrected — the exact failure mode the ref guards.
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (autoDetectedRef.current) return;
    autoDetectedRef.current = true;
    if (table.headers.length === 0) return;
    if (!isUntouched(mapping)) return;
    onMappingChange(autoDetectMapping(table.headers, catalog));
  }, [table, catalog, mapping, onMappingChange]);

  const issues = useMemo(
    () => findMappingIssues(mapping, catalog),
    [mapping, catalog]
  );

  const requiredUnmappedKeys = useMemo(
    () =>
      new Set(
        issues
          .filter((issue) => issue.kind === "required-unmapped")
          .map((issue) => issue.fieldKey)
      ),
    [issues]
  );

  /** header → the Arabic labels bound to it, so a duplicate binding is visible on the column too. */
  const fieldsByHeader = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const field of catalog) {
      const source = mapping.fields[field.key];
      if (source === undefined || source.kind !== "column") continue;
      const existing = map.get(source.header);
      if (existing) existing.push(field.labelAr);
      else map.set(source.header, [field.labelAr]);
    }
    return map;
  }, [catalog, mapping]);

  function originOf(key: string): FieldMappingOrigin {
    const source = mapping.fields[key];
    if (source === undefined || source.kind === "none") return "none";
    if (source.kind === "constant") return "constant";
    return manualKeys.has(key) ? "manual" : "auto";
  }

  function originLabel(origin: FieldMappingOrigin): string {
    if (origin === "auto") return labels.adhoc_map_origin_auto;
    if (origin === "manual") return labels.adhoc_map_origin_manual;
    if (origin === "constant") return labels.adhoc_map_origin_constant;
    return labels.adhoc_map_origin_none;
  }

  function markManual(key: string): void {
    setManualKeys((previous) => {
      const next = new Set(previous);
      next.add(key);
      return next;
    });
  }

  function handleHeaderClick(header: string): void {
    // CertScanGrid's `if (!activeHL) return`: a header click is only ever a
    // binding gesture, never a selection of its own.
    if (armedKey === null || disabled) return;
    onMappingChange(setFieldSource(mapping, armedKey, { kind: "column", header }));
    markManual(armedKey);
    setArmedKey(null);
  }

  function handleConstantToggle(key: string, on: boolean): void {
    onMappingChange(
      setFieldSource(mapping, key, on ? { kind: "constant", value: "" } : { kind: "none" })
    );
    if (armedKey === key) setArmedKey(null);
  }

  function handleConstantValue(key: string, value: string): void {
    onMappingChange(setFieldSource(mapping, key, { kind: "constant", value }));
  }

  function handleClear(key: string): void {
    onMappingChange(setFieldSource(mapping, key, { kind: "none" }));
    setManualKeys((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
    if (armedKey === key) setArmedKey(null);
    if (expandedKey === key) setExpandedKey(null);
  }

  function handleValueMappingChange(key: string, next: ValueMapping): void {
    onMappingChange({
      ...mapping,
      fields: { ...mapping.fields },
      valueMappings: { ...mapping.valueMappings, [key]: next },
    });
  }

  const gridRows = table.rows.slice(0, GRID_ROW_LIMIT);

  return (
    <div className="amw-root" dir="rtl">
      <div className="amw-toolbar">
        <h3 className="amw-heading">{labels.adhoc_map_title}</h3>
        <p className="amw-toolbar-hint">{labels.adhoc_map_toolbar_hint}</p>
      </div>

      {armedKey !== null && (
        <div className="amw-cursor-hint" role="status">
          {labels.adhoc_map_cursor_hint}
        </div>
      )}

      {issues.length > 0 && (
        <div className="amw-issues" role="status">
          <span className="amw-issues-title">{labels.adhoc_map_issues_title}</span>
          <ul className="amw-issues-list">
            {issues.map((issue) => (
              <li key={`${issue.kind}:${issue.fieldKey}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="amw-panes">
        {/* Field rail sits FIRST in source order so it lands on the right in RTL. */}
        <section className="amw-rail" aria-label={labels.adhoc_map_fields_pane_title}>
          <h4 className="amw-pane-title">{labels.adhoc_map_fields_pane_title}</h4>
          <ul className="amw-field-list">
            {catalog.map((field) => {
              const source = mapping.fields[field.key];
              const isArmed = armedKey === field.key;
              const isConstant = source?.kind === "constant";
              const boundHeader = source?.kind === "column" ? source.header : null;
              const isRequiredUnmapped = requiredUnmappedKeys.has(field.key);
              const canMapValues = field.kind === "enum" && boundHeader !== null;

              return (
                <li
                  key={field.key}
                  className={[
                    "amw-field-row",
                    isArmed ? "is-armed" : "",
                    boundHeader !== null ? "is-bound" : "",
                    isRequiredUnmapped ? "is-required-unmapped" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="amw-field-arm"
                    aria-pressed={isArmed}
                    aria-label={labels.adhoc_map_arm_aria.replace("{field}", field.labelAr)}
                    disabled={disabled}
                    onClick={() => setArmedKey(isArmed ? null : field.key)}
                  >
                    <span className="amw-field-label">{field.labelAr}</span>
                    {field.required && (
                      <span className="amw-required">{labels.adhoc_map_required_marker}</span>
                    )}
                  </button>

                  <span className="amw-field-binding">
                    {boundHeader !== null ? (
                      <>
                        <Check size={12} aria-hidden="true" />
                        {labels.adhoc_map_column_label.replace("{header}", boundHeader)}
                      </>
                    ) : isConstant && source.value.trim() !== "" ? (
                      // An empty constant resolves to nothing on every row, so
                      // it reads as unmapped here too — matching how
                      // `findMappingIssues` scores it.
                      labels.adhoc_map_constant_binding.replace("{value}", source.value)
                    ) : (
                      labels.adhoc_map_not_mapped
                    )}
                  </span>

                  <span className={`amw-chip amw-chip-origin-${originOf(field.key)}`}>
                    {originLabel(originOf(field.key))}
                  </span>

                  {isRequiredUnmapped && (
                    <span className="amw-chip amw-chip-danger">
                      {labels.adhoc_map_required_unmapped_badge}
                    </span>
                  )}

                  <label className="amw-constant-toggle">
                    <input
                      type="checkbox"
                      checked={isConstant}
                      disabled={disabled}
                      aria-label={labels.adhoc_map_constant_toggle_aria.replace(
                        "{field}",
                        field.labelAr
                      )}
                      onChange={(event) =>
                        handleConstantToggle(field.key, event.target.checked)
                      }
                    />
                    <span>{labels.adhoc_map_constant_toggle}</span>
                  </label>

                  {isConstant && (
                    <input
                      type="text"
                      className="amw-constant-input"
                      value={source.value}
                      disabled={disabled}
                      placeholder={labels.adhoc_map_constant_placeholder}
                      aria-label={labels.adhoc_map_constant_aria.replace(
                        "{field}",
                        field.labelAr
                      )}
                      onChange={(event) =>
                        handleConstantValue(field.key, event.target.value)
                      }
                    />
                  )}

                  <button
                    type="button"
                    className="amw-ghost-btn"
                    aria-label={labels.adhoc_map_clear_field_aria.replace(
                      "{field}",
                      field.labelAr
                    )}
                    disabled={disabled}
                    onClick={() => handleClear(field.key)}
                  >
                    <X size={12} aria-hidden="true" />
                    {labels.adhoc_map_clear_field}
                  </button>

                  {canMapValues && (
                    <button
                      type="button"
                      className="amw-ghost-btn"
                      aria-expanded={expandedKey === field.key}
                      disabled={disabled}
                      onClick={() =>
                        setExpandedKey(expandedKey === field.key ? null : field.key)
                      }
                    >
                      {labels.adhoc_map_value_mapping_toggle}
                    </button>
                  )}

                  {canMapValues && expandedKey === field.key && (
                    <ValueMappingPanel
                      field={field}
                      rows={table.rows}
                      header={boundHeader}
                      valueMapping={mapping.valueMappings[field.key] ?? {}}
                      disabled={disabled}
                      onChange={(next) => handleValueMappingChange(field.key, next)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="amw-grid" aria-label={labels.adhoc_map_grid_pane_title}>
          <h4 className="amw-pane-title">{labels.adhoc_map_grid_pane_title}</h4>
          {table.headers.length === 0 ? (
            <p className="amw-empty">{labels.adhoc_map_empty_table}</p>
          ) : (
            <>
              <p className="amw-grid-note">
                {labels.adhoc_map_grid_rows_note
                  .replace("{count}", String(gridRows.length))
                  .replace("{total}", String(table.rows.length))}
              </p>
              <div className={`amw-scroll${armedKey !== null ? " is-selecting" : ""}`}>
                <table
                  className="amw-grid-table"
                  aria-label={labels.adhoc_map_grid_pane_title}
                >
                  <thead>
                    <tr>
                      <th className="amw-th amw-th-rownum">
                        {labels.adhoc_map_row_number_header}
                      </th>
                      {table.headers.map((header) => {
                        const boundTo = fieldsByHeader.get(header);
                        return (
                          <th
                            key={header}
                            className={`amw-th${boundTo ? " is-bound" : ""}`}
                          >
                            <button
                              type="button"
                              className="amw-header-btn"
                              title={
                                armedKey !== null
                                  ? labels.adhoc_map_header_click_title
                                  : undefined
                              }
                              onClick={() => handleHeaderClick(header)}
                            >
                              {header}
                            </button>
                            {boundTo && (
                              <span
                                className="amw-header-bound"
                                aria-label={labels.adhoc_map_header_assigned_aria
                                  .replace("{header}", header)
                                  .replace("{fields}", boundTo.join("، "))}
                              >
                                {boundTo.join("، ")}
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.sourceRowNumber}>
                        <td className="amw-td amw-td-rownum">{row.sourceRowNumber}</td>
                        {table.headers.map((header) => (
                          <td
                            key={header}
                            className={`amw-td${fieldsByHeader.has(header) ? " is-bound" : ""}`}
                          >
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
