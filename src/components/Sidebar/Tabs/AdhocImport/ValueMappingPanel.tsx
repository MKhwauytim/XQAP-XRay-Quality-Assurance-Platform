import { useEffect, useMemo, useRef } from "react";

import {
  collectDistinctValues,
  seedValueMapping,
} from "../../../../data/adhocImport/adhocMappingModel";
import type {
  AdhocField,
  SourceRow,
  ValueMapping,
} from "../../../../data/adhocImport/adhocImportModel";
import { useLabels } from "../../../../data/labels/useLabels";
import "./MappingWorkbench.css";

type ValueMappingPanelProps = {
  field: AdhocField;
  rows: SourceRow[];
  header: string;
  valueMapping: ValueMapping;
  onChange: (next: ValueMapping) => void;
  disabled?: boolean;
};

/**
 * Per-value normalisation for one `kind: "enum"` field — "سليم" in the file
 * resolves to the canonical "سليمة", and so on.
 *
 * The whole point of this screen is the ABSENCE of an entry. `seedValueMapping`
 * deliberately omits any value it cannot match confidently, so an unmapped
 * value here is a decision the admin still owes, not a defaulting opportunity.
 * The unresolved rows are therefore rendered loudly and counted, and the
 * `<select>` opens on a placeholder rather than on `options[0]` — quietly
 * pre-selecting the first canonical value is exactly how a wrong L1/L2 result
 * would reach a report with nobody having chosen it.
 */
export default function ValueMappingPanel({
  field,
  rows,
  header,
  valueMapping,
  onChange,
  disabled,
}: ValueMappingPanelProps) {
  const labels = useLabels();
  const options = useMemo(() => field.options ?? [], [field.options]);
  const distinctValues = useMemo(
    () => collectDistinctValues(rows, header),
    [rows, header]
  );
  const seeded = useMemo(
    () => seedValueMapping(distinctValues, options),
    [distinctValues, options]
  );

  // Push the confident seeds up ONCE, so the mapping the import is saved with
  // actually carries them; an admin who opens this panel, sees every row
  // already resolved and closes it again must not have saved an empty mapping.
  // Existing entries win over seeds — a re-open (this panel unmounts with its
  // expander) may never overwrite a decision the admin already made.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const missing = Object.keys(seeded).filter((value) => !(value in valueMapping));
    if (missing.length === 0) return;
    onChange({ ...seeded, ...valueMapping });
  }, [seeded, valueMapping, onChange]);

  function handleSelect(value: string, next: string): void {
    if (next === "") {
      // Back to unresolved: delete rather than store "", so the absence keeps
      // meaning "undecided" everywhere downstream.
      const cleared = { ...valueMapping };
      delete cleared[value];
      onChange(cleared);
      return;
    }
    onChange({ ...valueMapping, [value]: next });
  }

  function resolvedFor(value: string): string {
    const current = valueMapping[value] ?? seeded[value] ?? "";
    return options.includes(current) ? current : "";
  }

  if (options.length === 0) {
    return (
      <p className="amw-vm-note" role="status">
        {labels.adhoc_vm_not_enum}
      </p>
    );
  }

  if (distinctValues.length === 0) {
    return (
      <p className="amw-vm-note" role="status">
        {labels.adhoc_vm_no_values}
      </p>
    );
  }

  const unresolvedCount = distinctValues.filter(
    (value) => resolvedFor(value) === ""
  ).length;

  return (
    <div className="amw-vm-root" dir="rtl">
      <div className="amw-vm-head">
        <span className="amw-vm-title">
          {labels.adhoc_vm_title.replace("{field}", field.labelAr)}
        </span>
        {unresolvedCount > 0 ? (
          <span className="amw-chip amw-chip-warn">
            {labels.adhoc_vm_unresolved_count.replace(
              "{count}",
              String(unresolvedCount)
            )}
          </span>
        ) : (
          <span className="amw-chip amw-chip-ok">{labels.adhoc_vm_all_resolved}</span>
        )}
      </div>

      <table className="amw-vm-table">
        <thead>
          <tr>
            <th className="amw-th">{labels.adhoc_vm_source_value}</th>
            <th className="amw-th">{labels.adhoc_vm_target_value}</th>
          </tr>
        </thead>
        <tbody>
          {distinctValues.map((value) => {
            const resolved = resolvedFor(value);
            return (
              <tr
                key={value}
                className={resolved === "" ? "amw-vm-row amw-vm-row-unresolved" : "amw-vm-row"}
              >
                <td className="amw-td">
                  <span className="amw-vm-source">{value}</span>
                  {resolved === "" && (
                    <span className="amw-chip amw-chip-danger">
                      {labels.adhoc_vm_unresolved_badge}
                    </span>
                  )}
                </td>
                <td className="amw-td">
                  <select
                    className="amw-select"
                    value={resolved}
                    disabled={disabled}
                    aria-label={labels.adhoc_vm_select_aria.replace("{value}", value)}
                    onChange={(event) => handleSelect(value, event.target.value)}
                  >
                    <option value="">{labels.adhoc_vm_unresolved_option}</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
