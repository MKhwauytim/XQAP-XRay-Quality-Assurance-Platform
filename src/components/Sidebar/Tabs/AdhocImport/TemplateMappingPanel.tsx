import { useEffect, useMemo, useRef } from "react";

import { autoDetectTemplateMapping } from "../../../../data/adhocImport/adhocTemplateMapping";
import type {
  FieldSource,
  ImportMapping,
} from "../../../../data/adhocImport/adhocImportModel";
import { getFieldsForPhase, getTemplatePhases } from "../../../../data/templates/templateRuntime";
import type { TemplateSchema } from "../../../../data/templates/templateTypes";
import { useLabels } from "../../../../data/labels/useLabels";
import { formatDateTime } from "../../../../utils/formatting";

/**
 * The TEMPLATE half of a `kind: "historical"` mapping, plus the two provenance
 * columns — who answered the study, and when.
 *
 * A separate panel rather than more rows inside `MappingWorkbench` because the
 * two mappings answer different questions and are keyed differently:
 * `MappingWorkbench` binds the population field CATALOG (`AdhocField.key`,
 * `mapping.fields`) and drives row validity, while everything here binds
 * `TemplateField.fieldId` into `mapping.templateFields` and drives what the
 * reviewer's answer file says. Folding them together would put nineteen
 * catalog fields and an arbitrary number of template questions on one rail with
 * two different meanings of "required".
 *
 * The interaction is a plain per-field `<select>` of headers, not the
 * arm-then-click-a-header gesture the catalog rail uses. That gesture pays for
 * itself when a person has to recognise a column by its CONTENTS; a template
 * field is matched by its label against a header name, which is exactly what a
 * dropdown of header names shows.
 *
 * PARTIAL COVERAGE IS THE NORMAL CASE and the whole panel is built for it: an
 * unmapped field is a first-class choice (`— لا يُستورد —`), the coverage line
 * counts rather than warns, and nothing here can block the wizard. The only
 * blocking rule in a historical import is the reviewer's identity, and that is
 * enforced by `planHistoricalImport` at step 3 against the live roster — a
 * check this panel cannot make, since a mapped column says nothing about
 * whether the names inside it are real accounts.
 */

type TemplateMappingPanelProps = {
  schema: TemplateSchema;
  headers: string[];
  mapping: ImportMapping;
  /** The record's `importedAt` — named in the fallback note, not silently applied. */
  importedAt: string;
  /**
   * An UPDATER, not a value. Two panels edit one `ImportMapping` on this screen
   * and their auto-detection effects land in the same commit, so a handler that
   * spread a `mapping` prop captured at render time would overwrite whatever
   * the other panel had just written.
   */
  onMappingChange: (update: (previous: ImportMapping) => ImportMapping) => void;
  disabled?: boolean;
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

function sourceValue(source: FieldSource | undefined): string {
  return source !== undefined && source.kind === "column" ? source.header : "";
}

function toSource(header: string): FieldSource {
  return header === "" ? { kind: "none" } : { kind: "column", header };
}

/** True while nothing in the template half has been decided — the only state auto-detection may overwrite. */
function isUntouched(templateFields: Record<string, FieldSource> | undefined): boolean {
  if (templateFields === undefined) return true;
  return Object.values(templateFields).every((source) => source.kind === "none");
}

type HeaderSelectProps = {
  id?: string;
  ariaLabel: string;
  headers: string[];
  value: string;
  disabled?: boolean;
  onChange: (header: string) => void;
  placeholder: string;
};

function HeaderSelect({
  id,
  ariaLabel,
  headers,
  value,
  disabled,
  onChange,
  placeholder,
}: HeaderSelectProps) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className="adhoc-hist-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {headers.map((header) => (
        <option key={header} value={header}>
          {header}
        </option>
      ))}
    </select>
  );
}

export default function TemplateMappingPanel({
  schema,
  headers,
  mapping,
  importedAt,
  onMappingChange,
  disabled,
}: TemplateMappingPanelProps) {
  const L = useLabels();

  /**
   * Auto-detect once PER TEMPLATE, and only into an untouched map.
   *
   * Keyed by `templateId` rather than by a bare "already ran" boolean because
   * switching the template in step 1 replaces the entire field list — the old
   * bindings refer to `fieldId`s the new schema does not have, so re-detecting
   * is the correct behavior there. Re-running on any other change is not: it
   * would silently discard bindings the admin had already corrected.
   */
  const autoDetectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (autoDetectedFor.current === schema.templateId) return;
    autoDetectedFor.current = schema.templateId;
    if (headers.length === 0) return;
    if (!isUntouched(mapping.templateFields)) return;
    onMappingChange((previous) => ({
      ...previous,
      templateFields: autoDetectTemplateMapping(headers, schema),
    }));
  }, [schema, headers, mapping, onMappingChange]);

  // Memoized only so the empty-object default keeps a stable identity across
  // renders; `coverage` below depends on it.
  const templateFields = useMemo(() => mapping.templateFields ?? {}, [mapping.templateFields]);

  const coverage = useMemo(() => {
    // `empty` fields are layout spacers in the inspection form and carry no
    // answer, so they are not part of what a file could have covered — the same
    // rule `summarizeCoverage` applies in the data layer.
    const answerable = schema.fields.filter((field) => field.type !== "empty");
    const mapped = answerable.filter(
      (field) => (templateFields[field.fieldId]?.kind ?? "none") !== "none"
    ).length;
    return { mapped, total: answerable.length };
  }, [schema, templateFields]);

  function setTemplateField(fieldId: string, header: string): void {
    onMappingChange((previous) => ({
      ...previous,
      templateFields: { ...(previous.templateFields ?? {}), [fieldId]: toSource(header) },
    }));
  }

  const answeredBySource = mapping.answeredBySource ?? { kind: "none" };
  const submittedAtSource = mapping.submittedAtSource ?? { kind: "none" };

  return (
    <section className="adhoc-hist-map" dir="rtl">
      <h3 className="adhoc-hist-map-title">{L.adhoc_hist_map_title}</h3>
      <p className="adhoc-import-scope-note">{L.adhoc_hist_map_intro}</p>
      <p className="adhoc-hist-coverage" role="status">
        {fill(L.adhoc_hist_map_coverage, {
          mapped: String(coverage.mapped),
          total: String(coverage.total),
        })}
      </p>

      {getTemplatePhases(schema).map((phase) => {
        const fields = getFieldsForPhase(schema, phase.phaseId).filter(
          (field) => field.type !== "empty"
        );
        if (fields.length === 0) return null;
        return (
          <fieldset key={phase.phaseId} className="adhoc-field-group">
            <legend>{phase.title}</legend>
            <ul className="adhoc-hist-field-list">
              {fields.map((field) => (
                <li key={field.fieldId} className="adhoc-hist-field-row">
                  <span className="adhoc-hist-field-label">{field.label}</span>
                  <HeaderSelect
                    ariaLabel={fill(L.adhoc_hist_map_field_aria, { field: field.label })}
                    headers={headers}
                    value={sourceValue(templateFields[field.fieldId])}
                    disabled={disabled}
                    placeholder={L.adhoc_hist_map_not_imported}
                    onChange={(header) => setTemplateField(field.fieldId, header)}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}

      <fieldset className="adhoc-field-group">
        <legend>{L.adhoc_hist_provenance_title}</legend>

        <div className="adhoc-field-row">
          <label htmlFor="adhoc-hist-answered-by">{L.adhoc_hist_answered_by_label}</label>
          <HeaderSelect
            id="adhoc-hist-answered-by"
            ariaLabel={L.adhoc_hist_answered_by_aria}
            headers={headers}
            value={sourceValue(answeredBySource)}
            disabled={disabled}
            placeholder={L.adhoc_hist_map_not_imported}
            onChange={(header) =>
              onMappingChange((previous) => ({
                ...previous,
                answeredBySource: toSource(header),
              }))
            }
          />
        </div>
        <p className="adhoc-hist-required-note">{L.adhoc_hist_answered_by_required}</p>

        <div className="adhoc-field-row">
          <label htmlFor="adhoc-hist-submitted-at">{L.adhoc_hist_submitted_at_label}</label>
          <HeaderSelect
            id="adhoc-hist-submitted-at"
            ariaLabel={L.adhoc_hist_submitted_at_aria}
            headers={headers}
            value={sourceValue(submittedAtSource)}
            disabled={disabled}
            placeholder={L.adhoc_hist_map_not_imported}
            onChange={(header) =>
              onMappingChange((previous) => ({
                ...previous,
                submittedAtSource: toSource(header),
              }))
            }
          />
        </div>
        {/* The fallback is legitimate but must never be silent: it is named here,
            at the moment the choice is made, as well as in the step-3 plan. */}
        {submittedAtSource.kind === "none" && (
          <p className="adhoc-hist-fallback-note" role="status">
            {fill(L.adhoc_hist_submitted_at_fallback, { date: formatDateTime(importedAt) })}
          </p>
        )}
      </fieldset>
    </section>
  );
}
