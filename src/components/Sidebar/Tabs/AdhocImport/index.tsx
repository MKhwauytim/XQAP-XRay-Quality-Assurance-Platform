import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePermissions } from "../../../../auth/usePermissions";
import { readSession } from "../../../../auth/authSession";
import {
  readUserManagementState,
  subscribeToUserManagementChanges,
  type ManagedLoginUser,
} from "../../../../auth/userManagement";
import { isAssignableSampleRole } from "../../../../data/distribution/bulkAssignment";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import DataTable, { type DataTableCol } from "../../../../components/DataTable";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { subscribeToDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import { useLabels } from "../../../../data/labels/useLabels";
import { formatDateTime } from "../../../../utils/formatting";
import { logError } from "../../../../data/storage/errorLogger";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import { ADHOC_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import { findMappingIssues } from "../../../../data/adhocImport/adhocMappingModel";
import { projectTable } from "../../../../data/adhocImport/adhocRowProjection";
import { linkedMonthsOf } from "../../../../data/adhocImport/adhocMonthBinding";
import { readWorkbookTables } from "../../../../data/adhocImport/adhocSourceTable";
import {
  createImportId,
  loadAdhocImportIndex,
  loadAdhocRecord,
  saveAdhocRecord,
} from "../../../../data/adhocImport/adhocImportStorage";
import {
  assignAdhocPlan,
  ensureAdhocSampleMaster,
} from "../../../../data/adhocImport/adhocDistributionBridge";
import {
  applyHistoricalImport,
  planHistoricalImport,
  type HistoricalImportPlan,
} from "../../../../data/adhocImport/adhocHistoricalImport";
import { loadTemplate, loadTemplateIndex } from "../../../../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../../../../data/templates/templateSelectionStorage";
import type { TemplateIndex, TemplateSchema } from "../../../../data/templates/templateTypes";
import type {
  AdhocImportKind,
  AdhocIndexEntry,
  AdhocMonthBinding,
  AdhocRecord,
  AdhocRow,
  AssignmentPlan,
  ImportMapping,
  SourceTable,
} from "../../../../data/adhocImport/adhocImportModel";
import MappingWorkbench from "./MappingWorkbench";
import PasteSourceInput from "./PasteSourceInput";
import AssignmentPanel from "./AssignmentPanel";
import TemplateMappingPanel from "./TemplateMappingPanel";
import HistoricalPanel from "./HistoricalPanel";
import "./AdhocImport.css";

/*
 * NO `tabConfig` export here, deliberately. The ad-hoc importer is a SUB-TAB of
 * Population (`population/adhoc-import`) as of 2026-08-21, rendered by
 * `Tabs/Population/index.tsx`. `tabRegistry.ts` eagerly globs every `index.tsx` one level down
 * and registers every module that exports a `tabConfig`, so re-adding one here
 * would resurrect the stand-alone top-level tab and put the registry out of
 * agreement with `auth/tabCatalog.ts`. `TemplateBuilder/index.tsx` and
 * `ReportDesigner/index.tsx` are the same shape: default export only.
 */

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

/** The two fields a bare image list never carries — and the ones a constant is meant for. */
const RESULT_FIELD_KEYS = ["xrayLevelOneResult", "xrayLevelTwoResult"];

const EMPTY_MAPPING: ImportMapping = { fields: {}, valueMappings: {} };

type SourceMode = "file" | "paste";
type WizardStep = 1 | 2 | 3;

/**
 * The whole editing session, list screen excluded.
 *
 * `record` is the single carrier for everything the import *is* (kind, binding,
 * mapping, rows), whether or not it has reached disk yet: an unsaved wizard
 * draft and an opened existing import are the same shape, so every step below
 * reads one place. `persisted` is what separates them.
 *
 * Nothing in here is ever rebuilt from a data-refresh broadcast — CLAUDE.md is
 * explicit that a refresh must not clobber unsaved draft state, and a wizard
 * halfway through a mapping is exactly that.
 */
type EditorState = {
  origin: "new" | "existing";
  step: WizardStep;
  record: AdhocRecord;
  /** Parsed source tables. Empty for an opened existing import — its rows are already projected. */
  tables: SourceTable[];
  /** Sheet names included in the projection. */
  activeSheets: string[];
  /** Which sheet the mapping workbench previews (mapping itself is shared). */
  previewSheet: string;
  persisted: boolean;
  /**
   * `kind: "historical"` only — the inspection template the old answers map
   * onto, loaded in full.
   *
   * The record snapshots only `templateId`/`templateVersion`; the schema itself
   * is needed here because every step of the historical path is a function of
   * its FIELDS — auto-detection, the per-phase mapping rail, and the coercion
   * `planHistoricalImport` runs. Held in editor state rather than re-read per
   * render so the plan recomputes on a mapping edit without a disk round-trip.
   */
  templateSchema: TemplateSchema | null;
};

function newRecord(operator: string): AdhocRecord {
  return {
    importId: createImportId(),
    schemaVersion: 2,
    fileName: "",
    importedBy: operator,
    importedAt: new Date().toISOString(),
    status: "open",
    kind: "population",
    sourceKind: "file",
    mapping: EMPTY_MAPPING,
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    rows: [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 1 — source
 * ──────────────────────────────────────────────────────────────────────────── */

type TemplatePickerProps = {
  templates: TemplateIndex["templates"];
  templateId: string | undefined;
  disabled: boolean;
  onTemplate: (templateId: string) => void;
};

/**
 * Which inspection template the old answers map onto — a `kind: "historical"`
 * question and nothing else's.
 *
 * The choice is stamped onto the record (`templateId` + `templateVersion`) and
 * `applyHistoricalImport` refuses to write without it, because an `ItemAnswer`
 * whose template is unknown cannot say what its `fieldId`s mean and a later
 * template edit would silently re-interpret it.
 */
function TemplatePicker({ templates, templateId, disabled, onTemplate }: TemplatePickerProps) {
  const L = useLabels();

  return (
    <div className="adhoc-field-row">
      <label htmlFor="adhoc-hist-template">{L.adhoc_hist_template_label}</label>
      {templates.length === 0 ? (
        <p className="adhoc-import-empty">{L.adhoc_hist_template_empty}</p>
      ) : (
        <select
          id="adhoc-hist-template"
          aria-label={L.adhoc_hist_template_select_aria}
          value={templateId ?? ""}
          disabled={disabled}
          onChange={(event) => onTemplate(event.target.value)}
        >
          <option value="">{L.adhoc_hist_template_placeholder}</option>
          {templates.map((entry) => (
            <option key={entry.templateId} value={entry.templateId}>
              {fillTemplate(L.adhoc_hist_template_option, {
                name: entry.templateName,
                version: String(entry.version),
              })}
            </option>
          ))}
        </select>
      )}
      <p className="adhoc-import-scope-note">{L.adhoc_hist_template_note}</p>
    </div>
  );
}

type SourceStepProps = {
  editor: EditorState;
  months: MonthFolderInfo[];
  templates: TemplateIndex["templates"];
  disabled: boolean;
  reading: boolean;
  onFile: (file: File) => void;
  onPastedTable: (table: SourceTable) => void;
  onSourceMode: (mode: SourceMode) => void;
  onToggleSheet: (sheetName: string) => void;
  onKind: (kind: AdhocImportKind) => void;
  onTemplate: (templateId: string) => void;
  onBinding: (binding: AdhocMonthBinding) => void;
};

function SourceStep({
  editor,
  months,
  templates,
  disabled,
  reading,
  onFile,
  onPastedTable,
  onSourceMode,
  onToggleSheet,
  onKind,
  onTemplate,
  onBinding,
}: SourceStepProps) {
  const L = useLabels();
  const { record, tables, activeSheets } = editor;
  const binding = record.monthBinding;
  const monthFields = record.fieldCatalog.filter(
    (field) => field.kind === "month" || field.kind === "date"
  );
  const selectedRowCount = tables
    .filter((table) => activeSheets.includes(table.sheetName))
    .reduce((sum, table) => sum + table.rows.length, 0);

  return (
    <section className="adhoc-step-card">
      <fieldset className="adhoc-field-group">
        <legend>{L.adhoc_source_mode_label}</legend>
        <label className="adhoc-radio">
          <input
            type="radio"
            name="adhoc-source-mode"
            checked={record.sourceKind === "file"}
            disabled={disabled}
            onChange={() => onSourceMode("file")}
          />
          <span>{L.adhoc_source_mode_file}</span>
        </label>
        <label className="adhoc-radio">
          <input
            type="radio"
            name="adhoc-source-mode"
            checked={record.sourceKind === "paste"}
            disabled={disabled}
            onChange={() => onSourceMode("paste")}
          />
          <span>{L.adhoc_source_mode_paste}</span>
        </label>
      </fieldset>

      {record.sourceKind === "file" ? (
        <div className="adhoc-file-row">
          <label htmlFor="adhoc-import-file">{L.adhoc_import_upload_label}</label>
          <input
            id="adhoc-import-file"
            type="file"
            accept=".xlsx,.xls"
            disabled={disabled || reading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          {reading && <span className="adhoc-import-empty">{L.adhoc_source_reading}</span>}
        </div>
      ) : (
        <PasteSourceInput onTable={onPastedTable} disabled={disabled} />
      )}

      {tables.length > 1 && (
        <fieldset className="adhoc-field-group">
          <legend>{L.adhoc_source_sheets_label}</legend>
          {tables.map((table) => (
            <label key={table.sheetName} className="adhoc-radio">
              <input
                type="checkbox"
                checked={activeSheets.includes(table.sheetName)}
                disabled={disabled}
                aria-label={fillTemplate(L.adhoc_source_sheet_toggle_aria, {
                  sheet: table.sheetName,
                })}
                onChange={() => onToggleSheet(table.sheetName)}
              />
              <span>
                {fillTemplate(L.adhoc_source_sheet_option, {
                  sheet: table.sheetName,
                  rows: String(table.rows.length),
                })}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {tables.length > 0 && (
        <p className="adhoc-import-scope-note">
          {fillTemplate(L.adhoc_source_selected_summary, {
            tables: String(activeSheets.length),
            rows: String(selectedRowCount),
          })}
        </p>
      )}

      <div className="adhoc-field-row">
        <label htmlFor="adhoc-import-kind">{L.adhoc_kind_label}</label>
        <select
          id="adhoc-import-kind"
          value={record.kind}
          disabled={disabled}
          onChange={(event) => onKind(event.target.value as AdhocImportKind)}
        >
          <option value="population">{L.adhoc_kind_population}</option>
          <option value="sample">{L.adhoc_kind_sample}</option>
          <option value="historical">{L.adhoc_kind_historical}</option>
        </select>
      </div>

      {record.kind === "historical" && (
        <TemplatePicker
          templates={templates}
          templateId={record.templateId}
          disabled={disabled}
          onTemplate={onTemplate}
        />
      )}

      <fieldset className="adhoc-field-group">
        <legend>{L.adhoc_binding_label}</legend>
        <label className="adhoc-radio">
          <input
            type="radio"
            name="adhoc-binding"
            checked={binding.kind === "isolated"}
            disabled={disabled}
            onChange={() => onBinding({ kind: "isolated" })}
          />
          <span>{L.adhoc_binding_isolated}</span>
        </label>
        <label className="adhoc-radio">
          <input
            type="radio"
            name="adhoc-binding"
            checked={binding.kind === "month"}
            disabled={disabled}
            onChange={() =>
              onBinding({ kind: "month", monthFolderName: months[months.length - 1]?.folderName ?? "" })
            }
          />
          <span>{L.adhoc_binding_month}</span>
        </label>
        <label className="adhoc-radio">
          <input
            type="radio"
            name="adhoc-binding"
            checked={binding.kind === "column"}
            disabled={disabled}
            onChange={() =>
              onBinding({ kind: "column", fieldKey: monthFields[0]?.key ?? "studyMonth" })
            }
          />
          <span>{L.adhoc_binding_column}</span>
        </label>

        {binding.kind === "month" &&
          (months.length === 0 ? (
            <p className="adhoc-import-empty">{L.adhoc_binding_no_months}</p>
          ) : (
            <select
              aria-label={L.adhoc_binding_month_select_aria}
              value={binding.monthFolderName}
              disabled={disabled}
              onChange={(event) =>
                onBinding({ kind: "month", monthFolderName: event.target.value })
              }
            >
              <option value="">{L.adhoc_binding_placeholder}</option>
              {months.map((month) => (
                <option key={month.folderName} value={month.folderName}>
                  {month.folderName}
                </option>
              ))}
            </select>
          ))}

        {binding.kind === "column" && (
          <select
            aria-label={L.adhoc_binding_column_select_aria}
            value={binding.fieldKey}
            disabled={disabled}
            onChange={(event) => onBinding({ kind: "column", fieldKey: event.target.value })}
          >
            {monthFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.labelAr}
              </option>
            ))}
          </select>
        )}

        <p className="adhoc-import-scope-note">{L.adhoc_binding_note}</p>
      </fieldset>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 2 — mapping
 * ──────────────────────────────────────────────────────────────────────────── */

type MappingStepProps = {
  editor: EditorState;
  disabled: boolean;
  /**
   * An UPDATER. Step 2 now hosts TWO editors of one `ImportMapping` — the
   * catalog workbench and, for a historical import, the template panel — and
   * their auto-detection effects can land in the same commit. A handler that
   * took a finished value would let whichever ran second overwrite the first
   * from a `mapping` prop captured before either wrote.
   */
  onMapping: (update: (previous: ImportMapping) => ImportMapping) => void;
  onPreviewSheet: (sheetName: string) => void;
};

function MappingStep({ editor, disabled, onMapping, onPreviewSheet }: MappingStepProps) {
  const L = useLabels();
  const included = editor.tables.filter((table) => editor.activeSheets.includes(table.sheetName));
  const previewTable =
    included.find((table) => table.sheetName === editor.previewSheet) ?? included[0];

  const unmappedResults = editor.record.fieldCatalog.filter((field) => {
    if (!RESULT_FIELD_KEYS.includes(field.key)) return false;
    const source = editor.record.mapping.fields[field.key];
    if (source === undefined || source.kind === "none") return true;
    return source.kind === "constant" && source.value.trim() === "";
  });

  if (previewTable === undefined) {
    return <p className="adhoc-import-empty">{L.adhoc_wizard_blocked_no_table}</p>;
  }

  return (
    <section className="adhoc-step-card">
      {included.length > 1 && (
        <div className="adhoc-field-row">
          <p className="adhoc-import-scope-note">{L.adhoc_step2_shared_mapping_note}</p>
          <label htmlFor="adhoc-preview-sheet">{L.adhoc_step2_preview_sheet_label}</label>
          <select
            id="adhoc-preview-sheet"
            value={previewTable.sheetName}
            onChange={(event) => onPreviewSheet(event.target.value)}
          >
            {included.map((table) => (
              <option key={table.sheetName} value={table.sheetName}>
                {table.sheetName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* The constant escape hatch is invisible until someone knows the checkbox
          exists, and a bare image list has no result column at all — so the two
          fields that a constant is actually FOR say so while they are unmapped. */}
      {unmappedResults.length > 0 && (
        <div className="adhoc-hint" role="status">
          <span className="adhoc-hint-fields">
            {unmappedResults.map((field) => field.labelAr).join("، ")}
          </span>
          <span>{L.adhoc_map_result_constant_hint}</span>
        </div>
      )}

      <MappingWorkbench
        table={previewTable}
        catalog={editor.record.fieldCatalog}
        mapping={editor.record.mapping}
        // The workbench owns `fields`/`valueMappings` only, but its
        // auto-detection returns a WHOLE fresh mapping — so the historical half
        // is carried across explicitly rather than dropped.
        onMappingChange={(next) =>
          onMapping((previous) => ({
            ...next,
            templateFields: previous.templateFields,
            answeredBySource: previous.answeredBySource,
            submittedAtSource: previous.submittedAtSource,
          }))
        }
        disabled={disabled}
      />

      {/* The template half sits BELOW the catalog half, and only for a
          historical import: it maps what the reviewer already answered, which
          the other two kinds have no such thing as. */}
      {editor.record.kind === "historical" &&
        (editor.templateSchema === null ? (
          <p className="adhoc-import-empty">{L.adhoc_hist_map_no_template}</p>
        ) : (
          <TemplateMappingPanel
            schema={editor.templateSchema}
            headers={previewTable.headers}
            mapping={editor.record.mapping}
            importedAt={editor.record.importedAt}
            onMappingChange={onMapping}
            disabled={disabled}
          />
        ))}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step 3 — review
 * ──────────────────────────────────────────────────────────────────────────── */

type ReviewStepProps = {
  record: AdhocRecord;
  selectedRowKeys: Set<string>;
  canIngest: boolean;
  canAssign: boolean;
  onToggleRow: (rowKey: string) => void;
  onToggleExcluded: (rowKey: string) => void;
};

function ReviewTable({
  record,
  selectedRowKeys,
  canIngest,
  canAssign,
  onToggleRow,
  onToggleExcluded,
}: ReviewStepProps) {
  const L = useLabels();

  const columns: DataTableCol<AdhocRow>[] = useMemo(
    () => [
      { id: "select", label: "", widthFr: 4, alwaysVisible: true, accessor: () => null },
      {
        id: "rowKey",
        label: L.adhoc_import_col_row_key,
        widthFr: 10,
        alwaysVisible: true,
        filterKind: "text",
        accessor: (r) => r.rowKey,
      },
      { id: "xrayImageId", label: L.col_xray_image_id, widthFr: 14, filterKind: "text", accessor: (r) => r.mapped.xrayImageId ?? null },
      { id: "portName", label: L.col_port_name, widthFr: 10, accessor: (r) => r.mapped.portName ?? null },
      { id: "declarationNumber", label: L.col_declaration_number, widthFr: 12, accessor: (r) => r.mapped.declarationNumber ?? null },
      { id: "xrayLevelOneResult", label: L.col_xray_l1_result, widthFr: 8, accessor: (r) => r.mapped.xrayLevelOneResult ?? null },
      { id: "xrayLevelTwoResult", label: L.col_xray_l2_result, widthFr: 8, accessor: (r) => r.mapped.xrayLevelTwoResult ?? null },
      {
        id: "validation",
        label: L.adhoc_import_col_validation,
        widthFr: 16,
        filterKind: "status",
        statusOptions: [
          { value: "valid", label: L.adhoc_import_validation_valid },
          { value: "invalid", label: L.adhoc_import_validation_invalid },
        ],
        accessor: (r) => (r.validation.valid ? "valid" : "invalid"),
      },
      { id: "excluded", label: L.adhoc_import_col_excluded, widthFr: 8, accessor: () => null },
      {
        id: "assignedTo",
        label: L.adhoc_import_col_assigned_to,
        widthFr: 10,
        accessor: (r) =>
          r.assignments.length === 0 ? null : r.assignments.map((a) => a.username).join("، "),
      },
    ],
    [L]
  );

  return (
    <DataTable<AdhocRow>
      columns={columns}
      rows={record.rows}
      // Opening a different import is the whole context change here; the in-place
      // row rewrites (exclude/assign) re-render the SAME import and must leave the
      // admin on the page they were reviewing.
      resetToken={record.importId}
      getRowKey={(r) => r.rowKey}
      renderCell={(col, row) => {
        if (col.id === "select") {
          const eligible = row.validation.valid && !row.excludedByAdmin && row.assignments.length === 0;
          return (
            <input
              type="checkbox"
              disabled={!eligible || !canAssign}
              checked={selectedRowKeys.has(row.rowKey)}
              onChange={() => onToggleRow(row.rowKey)}
              aria-label={row.rowKey}
            />
          );
        }
        if (col.id === "validation") {
          return row.validation.valid
            ? L.adhoc_import_validation_valid
            : fillTemplate(L.adhoc_import_validation_invalid, { reason: row.validation.reason });
        }
        if (col.id === "excluded") {
          return (
            <input
              type="checkbox"
              disabled={!canIngest || row.assignments.length > 0}
              checked={row.excludedByAdmin}
              onChange={() => onToggleExcluded(row.rowKey)}
              aria-label={`${L.adhoc_import_col_excluded} ${row.rowKey}`}
            />
          );
        }
        if (col.id === "assignedTo") {
          const value = col.accessor(row);
          return value === null ? "—" : `${value} (${L.adhoc_import_assigned_badge})`;
        }
        return col.accessor(row) ?? "—";
      }}
      defaultVisible={[
        "select",
        "rowKey",
        "xrayImageId",
        "portName",
        "declarationNumber",
        "xrayLevelOneResult",
        "xrayLevelTwoResult",
        "validation",
        "excluded",
        "assignedTo",
      ]}
      canConfigureColumns={false}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Landing screen — the imports list
 * ──────────────────────────────────────────────────────────────────────────── */

function ImportsList({
  imports,
  onOpen,
}: {
  imports: AdhocIndexEntry[];
  onOpen: (importId: string) => void;
}) {
  const L = useLabels();

  return (
    <section className="adhoc-import-list-card">
      <h2>{L.adhoc_import_list_title}</h2>
      {imports.length === 0 ? (
        <p className="adhoc-import-empty">{L.adhoc_import_list_empty}</p>
      ) : (
        <table className="adhoc-import-list-table">
          <thead>
            <tr>
              <th>{L.adhoc_import_col_file_name}</th>
              <th>{L.adhoc_import_col_imported_by}</th>
              <th>{L.adhoc_import_col_imported_at}</th>
              <th>{L.adhoc_import_col_status}</th>
              <th>{L.adhoc_import_col_total_rows}</th>
              <th>{L.adhoc_import_col_valid_rows}</th>
              <th>{L.adhoc_import_col_assigned_rows}</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((entry) => (
              <tr
                key={entry.importId}
                onClick={() => onOpen(entry.importId)}
                className="adhoc-import-list-row"
              >
                <td>{entry.fileName}</td>
                <td>{entry.importedBy}</td>
                <td>{formatDateTime(entry.importedAt)}</td>
                <td>
                  {entry.status === "open"
                    ? L.adhoc_import_status_open
                    : L.adhoc_import_status_closed}
                </td>
                <td>{entry.totalRows}</td>
                <td>{entry.validRows}</td>
                <td>{entry.assignedRows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tab
 * ──────────────────────────────────────────────────────────────────────────── */

export default function AdhocImportTab() {
  const L = useLabels();
  const { directoryHandle, status: workspaceStatus } = useWorkspace();
  const { canMutate } = usePermissions();
  const session = readSession();
  const operator = session?.username ?? "";

  const [imports, setImports] = useState<AdhocIndexEntry[]>([]);
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [templates, setTemplates] = useState<TemplateIndex["templates"]>([]);
  /** The workspace's active inspection template — the default a historical import proposes. */
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [importingHistorical, setImportingHistorical] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const workspaceReady = workspaceStatus === "ready" && directoryHandle !== null;
  const canIngest = canMutate("adhoc-import.ingest");
  const canAssign = canMutate("adhoc-import.assign");

  // Audit finding 6: this used to be a mount-time-only snapshot (`useMemo(...,[])`),
  // so a user added/deactivated after the tab mounted never showed up (or never
  // disappeared) in the assignment dropdown until a full remount. It re-derives
  // whenever the managed-user roster actually changes; `assignAdhocPlan` re-validates
  // every target against the live roster, which is the real authorization boundary.
  const computeAssignableEmployees = useCallback(
    (): ManagedLoginUser[] =>
      readUserManagementState().users.filter((u) => u.isActive && isAssignableSampleRole(u)),
    []
  );
  const [employees, setEmployees] = useState<ManagedLoginUser[]>(computeAssignableEmployees);
  useEffect(
    () => subscribeToUserManagementChanges(() => setEmployees(computeAssignableEmployees())),
    [computeAssignableEmployees]
  );

  const refreshIndex = useCallback(async () => {
    if (!directoryHandle) return;
    const index = await loadAdhocImportIndex(directoryHandle);
    setImports([...index].sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  }, [directoryHandle]);

  useEffect(() => {
    if (!workspaceReady || !directoryHandle) return;
    const timer = window.setTimeout(() => {
      void refreshIndex();
      void listMonthFolders(directoryHandle).then(setMonths);
      // Both are cheap index reads and both are needed the moment "دراسة سابقة
      // مُجابة" is picked in step 1, which is a click away from mount.
      void loadTemplateIndex(directoryHandle).then((index) => setTemplates(index.templates));
      void loadInspectionTemplateSelection(directoryHandle).then((selection) =>
        setSelectedTemplateId(selection?.templateId ?? "")
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, directoryHandle, refreshIndex]);

  // Another machine's import must appear in the list without a page reload — but
  // a refresh may only ever touch the LIST. `editor` (an in-progress mapping, a
  // half-ticked review table) is unsaved draft state and is deliberately left
  // alone; clobbering it on a 45s timer is the documented bug class in CLAUDE.md.
  useEffect(() => {
    if (!workspaceReady) return;
    return subscribeToDataRefresh(() => {
      void refreshIndex();
    });
  }, [workspaceReady, refreshIndex]);

  /**
   * The one mapping writer, in functional form so two concurrent editors of the
   * same `ImportMapping` (see `MappingStepProps.onMapping`) compose instead of
   * clobbering each other.
   */
  const updateMapping = useCallback(
    (update: (previous: ImportMapping) => ImportMapping) => {
      setEditor((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              record: { ...previous.record, mapping: update(previous.record.mapping) },
            }
      );
    },
    []
  );

  const patchRecord = useCallback((patch: Partial<AdhocRecord>) => {
    setEditor((previous) =>
      previous === null ? previous : { ...previous, record: { ...previous.record, ...patch } }
    );
  }, []);

  /* ── list ↔ editor navigation ───────────────────────────────────────────── */

  const startNewImport = useCallback(() => {
    if (!canIngest) {
      setError(L.adhoc_import_denied);
      return;
    }
    setError(null);
    setNotice(null);
    setNotes([]);
    setSelectedRowKeys(new Set());
    setEditor({
      origin: "new",
      step: 1,
      record: newRecord(operator),
      tables: [],
      activeSheets: [],
      previewSheet: "",
      persisted: false,
      templateSchema: null,
    });
  }, [canIngest, operator, L]);

  const openImport = useCallback(
    async (importId: string) => {
      if (!directoryHandle) return;
      const record = await loadAdhocRecord(directoryHandle, importId);
      if (record === null) return;
      // A historical import's own template, so the review step describes the
      // same schema the mapping was authored against rather than the
      // workspace's current selection.
      const schema =
        record.kind === "historical" && record.templateId !== undefined
          ? await loadTemplate(directoryHandle, record.templateId)
          : null;
      setError(null);
      setNotice(null);
      setNotes([]);
      setSelectedRowKeys(new Set());
      setEditor({
        origin: "existing",
        step: 3,
        record,
        tables: [],
        activeSheets: [],
        previewSheet: "",
        persisted: true,
        templateSchema: schema,
      });
    },
    [directoryHandle]
  );

  const backToList = useCallback(() => {
    setEditor(null);
    setSelectedRowKeys(new Set());
    setNotes([]);
  }, []);

  /* ── step 1 handlers ────────────────────────────────────────────────────── */

  const applyTables = useCallback((tables: SourceTable[], fileName: string, sourceKind: "file" | "paste") => {
    setEditor((previous) =>
      previous === null
        ? previous
        : {
            ...previous,
            tables,
            activeSheets: tables.map((table) => table.sheetName),
            previewSheet: tables[0]?.sheetName ?? "",
            record: { ...previous.record, fileName, sourceKind },
          }
    );
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!canIngest) {
        setError(L.adhoc_import_denied);
        return;
      }
      setError(null);
      setReading(true);
      try {
        const tables = await readWorkbookTables(file);
        if (tables.length === 0) {
          setError(L.adhoc_source_no_tables);
          return;
        }
        applyTables(tables, file.name, "file");
      } catch (err) {
        logError("AdhocImport.readWorkbook", err);
        setError(
          fillTemplate(L.adhoc_import_parse_failed, {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      } finally {
        setReading(false);
      }
    },
    [canIngest, applyTables, L]
  );

  const handlePastedTable = useCallback(
    (table: SourceTable) => {
      if (!canIngest) return;
      applyTables([table], table.sheetName, "paste");
    },
    [canIngest, applyTables]
  );

  const handleSourceMode = useCallback((mode: SourceMode) => {
    setEditor((previous) =>
      previous === null
        ? previous
        : {
            ...previous,
            tables: [],
            activeSheets: [],
            previewSheet: "",
            record: { ...previous.record, sourceKind: mode, fileName: "" },
          }
    );
  }, []);

  const handleToggleSheet = useCallback((sheetName: string) => {
    setEditor((previous) => {
      if (previous === null) return previous;
      const active = previous.activeSheets.includes(sheetName)
        ? previous.activeSheets.filter((name) => name !== sheetName)
        : [...previous.activeSheets, sheetName];
      return { ...previous, activeSheets: active };
    });
  }, []);

  /**
   * Binds the import to one inspection template, in full.
   *
   * Switching template also CLEARS `mapping.templateFields`, because its keys
   * are `fieldId`s of the template being left behind — carrying them over would
   * leave bindings pointing at questions the new schema does not ask, and
   * `planHistoricalImport` would then coerce every cell against the wrong field
   * list. Clearing also re-arms `TemplateMappingPanel`'s auto-detection, which
   * is keyed by template id for the same reason.
   */
  const handleTemplate = useCallback(
    async (templateId: string) => {
      if (!directoryHandle) return;
      const schema = templateId === "" ? null : await loadTemplate(directoryHandle, templateId);
      setEditor((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              templateSchema: schema,
              record: {
                ...previous.record,
                templateId: schema?.templateId,
                templateVersion: schema?.version,
                mapping: { ...previous.record.mapping, templateFields: {} },
              },
            }
      );
    },
    [directoryHandle]
  );

  /**
   * Proposes the workspace's active inspection template once a historical
   * import has none, so the common case needs no second decision.
   *
   * An effect rather than part of the kind handler because the template index
   * and the workspace selection both arrive asynchronously: a kind picked
   * before they land would silently get no proposal at all.
   *
   * The ref keys the proposal to the import, so it fires exactly once per
   * import — an admin who then clears the picker has made a deliberate choice
   * and is not overruled on the next render, and a template that fails to load
   * cannot spin the effect. It is claimed INSIDE the timeout, not beside it: a
   * dependency change that cancels a pending proposal must leave the next run
   * free to schedule another, or the one cancelled proposal is lost for good.
   */
  const proposedTemplateFor = useRef<string | null>(null);
  useEffect(() => {
    if (editor === null || editor.record.kind !== "historical") return;
    if (editor.record.templateId !== undefined) return;
    const importId = editor.record.importId;
    if (proposedTemplateFor.current === importId) return;
    const fallback = selectedTemplateId || templates[0]?.templateId || "";
    if (fallback === "") return;
    const timer = window.setTimeout(() => {
      if (proposedTemplateFor.current === importId) return;
      proposedTemplateFor.current = importId;
      void handleTemplate(fallback);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editor, selectedTemplateId, templates, handleTemplate]);

  /* ── step transitions ───────────────────────────────────────────────────── */

  const includedTables = useMemo(
    () =>
      editor === null
        ? []
        : editor.tables.filter((table) => editor.activeSheets.includes(table.sheetName)),
    [editor]
  );

  const requiredUnmapped = useMemo(
    () =>
      editor === null
        ? []
        : findMappingIssues(editor.record.mapping, editor.record.fieldCatalog).filter(
            (issue) => issue.kind === "required-unmapped"
          ),
    [editor]
  );

  const isHistorical = editor?.record.kind === "historical";

  /**
   * The ORIGINAL cells of every included row, keyed exactly as `projectTable`
   * keys its rows (`${sheetName}:${sourceRowNumber}`).
   *
   * `planHistoricalImport` needs these rather than `row.mapped`: the template
   * answers, the reviewer name and the review date all come from columns the
   * population field catalog knows nothing about, so `mapped` cannot carry them.
   *
   * Only the in-memory source tables can supply them. `AdhocRow` persists just
   * its MAPPED values, so an import re-opened from disk has no answer cells left
   * to plan from — a real limit of the record format, reported in step 3 as
   * `adhoc_hist_no_source` rather than shown as an empty plan.
   */
  const rawValuesByRowKey = useMemo(() => {
    const map: Record<string, Record<string, unknown>> = {};
    for (const table of includedTables) {
      for (const row of table.rows) {
        map[`${table.sheetName}:${row.sourceRowNumber}`] = row.values;
      }
    }
    return map;
  }, [includedTables]);

  const historicalPlan = useMemo<HistoricalImportPlan | null>(() => {
    if (editor === null || !isHistorical) return null;
    if (editor.templateSchema === null) return null;
    if (Object.keys(rawValuesByRowKey).length === 0) return null;
    // Pure and cheap, and re-run on every mapping edit on purpose: the errors it
    // returns (an unresolvable reviewer above all) are what the step-3 button
    // gates on, so a stale plan would be a plan that permits a bad write.
    return planHistoricalImport({
      record: editor.record,
      schema: editor.templateSchema,
      rawValuesByRowKey,
    });
  }, [editor, isHistorical, rawValuesByRowKey]);

  const historicalUnavailable = useMemo(() => {
    if (editor === null || !isHistorical) return null;
    if (editor.templateSchema === null) return L.adhoc_hist_map_no_template;
    if (Object.keys(rawValuesByRowKey).length === 0) return L.adhoc_hist_no_source;
    return null;
  }, [editor, isHistorical, rawValuesByRowKey, L]);

  const canAdvance = useMemo(() => {
    if (editor === null) return false;
    if (editor.step === 1) return includedTables.length > 0;
    if (editor.step === 2) return requiredUnmapped.length === 0;
    return false;
  }, [editor, includedTables, requiredUnmapped]);

  const goNext = useCallback(() => {
    setEditor((previous) => {
      if (previous === null) return previous;
      if (previous.step === 1) {
        return { ...previous, step: 2 };
      }
      if (previous.step !== 2) return previous;
      // Re-projected on every 2 → 3 transition: the mapping and the binding are
      // what the rows MEAN, so a corrected mapping must not leave last attempt's
      // rows on screen. One `seenIds` set spans every sheet, so a duplicate
      // identity in sheet 2 is caught against sheet 1.
      const seenIds = new Set<string>();
      const rows = previous.tables
        .filter((table) => previous.activeSheets.includes(table.sheetName))
        .flatMap((table) =>
          projectTable({
            table,
            mapping: previous.record.mapping,
            catalog: previous.record.fieldCatalog,
            binding: previous.record.monthBinding,
            seenIds,
          })
        );
      return { ...previous, step: 3, record: { ...previous.record, rows } };
    });
    setSelectedRowKeys(new Set());
  }, []);

  const goBack = useCallback(() => {
    setEditor((previous) =>
      previous === null || previous.step === 1
        ? previous
        : { ...previous, step: (previous.step - 1) as WizardStep }
    );
  }, []);

  /* ── step 3 handlers ────────────────────────────────────────────────────── */

  const toggleRowSelected = useCallback((rowKey: string) => {
    setSelectedRowKeys((previous) => {
      const next = new Set(previous);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const selectAllAssignable = useCallback(() => {
    if (editor === null) return;
    setSelectedRowKeys(
      new Set(
        editor.record.rows
          .filter((row) => row.validation.valid && !row.excludedByAdmin && row.assignments.length === 0)
          .map((row) => row.rowKey)
      )
    );
  }, [editor]);

  const clearSelection = useCallback(() => setSelectedRowKeys(new Set()), []);

  const persist = useCallback(
    async (record: AdhocRecord): Promise<AdhocRecord | null> => {
      if (!directoryHandle || !canIngest) {
        setError(L.adhoc_import_denied);
        return null;
      }
      const saved = await saveAdhocRecord(directoryHandle, record);
      // Sample rows must exist before any assign event can name them; writing
      // them at save time keeps an unassigned import browsable under its
      // synthetic month, exactly as v1 did at upload time.
      await ensureAdhocSampleMaster(directoryHandle, saved);
      return saved;
    },
    [directoryHandle, canIngest, L]
  );

  const handleSave = useCallback(async () => {
    if (editor === null) return;
    if (!canIngest) {
      setError(L.adhoc_import_denied);
      return;
    }
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await persist(editor.record);
      if (saved === null) return;
      setEditor((previous) =>
        previous === null ? previous : { ...previous, record: saved, persisted: true }
      );
      setNotice(fillTemplate(L.adhoc_review_saved, { count: String(saved.rows.length) }));
      await refreshIndex();
    } catch (err) {
      logError("AdhocImport.save", err);
      setError(
        fillTemplate(L.adhoc_review_save_failed, {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setSaving(false);
    }
  }, [editor, canIngest, persist, refreshIndex, L]);

  const toggleExcluded = useCallback(
    async (rowKey: string) => {
      if (editor === null || !canIngest) return;
      const nextRows = editor.record.rows.map((row) =>
        row.rowKey === rowKey ? { ...row, excludedByAdmin: !row.excludedByAdmin } : row
      );
      const nextRecord = { ...editor.record, rows: nextRows };
      if (!editor.persisted) {
        setEditor((previous) => (previous === null ? previous : { ...previous, record: nextRecord }));
        return;
      }
      try {
        const saved = await persist(nextRecord);
        if (saved === null) return;
        setEditor((previous) => (previous === null ? previous : { ...previous, record: saved }));
      } catch (err) {
        logError("AdhocImport.toggleExcluded", err);
        setError(
          fillTemplate(L.adhoc_review_save_failed, {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    },
    [editor, canIngest, persist, L]
  );

  const handleAssign = useCallback(
    async (plan: AssignmentPlan) => {
      if (editor === null || !directoryHandle) return;
      // Handler-boundary capability check — the panel's hidden button is only a hint.
      if (!canAssign) {
        setError(L.adhoc_import_denied);
        return;
      }
      if (editor.record.status === "closed") {
        setError(L.adhoc_import_assign_closed);
        return;
      }
      setError(null);
      setNotice(null);
      setNotes(plan.errors);
      setAssigning(true);
      try {
        const base = editor.persisted ? editor.record : await persist(editor.record);
        if (base === null) return;
        const result = await assignAdhocPlan(directoryHandle, base, plan.plan, operator);
        if (!result.ok) {
          setEditor((previous) =>
            previous === null ? previous : { ...previous, record: base, persisted: true }
          );
          setError(fillTemplate(L.adhoc_import_assign_failed, { error: result.error }));
          return;
        }
        setEditor((previous) =>
          previous === null ? previous : { ...previous, record: result.record, persisted: true }
        );
        setSelectedRowKeys(new Set());
        let message = fillTemplate(L.adhoc_import_assign_success, {
          count: String(result.assignedCount),
        });
        if (result.skippedCount > 0) {
          message += " " + fillTemplate(L.adhoc_import_assign_skipped, {
            count: String(result.skippedCount),
          });
        }
        if (plan.leftover > 0) {
          message += " " + fillTemplate(L.adhoc_assign_leftover_notice, {
            count: String(plan.leftover),
          });
        }
        setNotice(message);
        await refreshIndex();
      } catch (err) {
        logError("AdhocImport.assign", err);
        setError(
          fillTemplate(L.adhoc_import_assign_failed, {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      } finally {
        setAssigning(false);
      }
    },
    [editor, directoryHandle, canAssign, persist, operator, refreshIndex, L]
  );

  /**
   * Commits a historical study as ALREADY-COMPLETED work.
   *
   * Gated on `adhoc-import.assign`, not on `.ingest`. The two capabilities split
   * on what reaches the rest of the app: `.ingest` covers reading a file and
   * mapping its columns, which stays inside the import's own record, while
   * `.assign` covers "تعيين صفوف من ملف مستورد يدوياً لموظف عبر سجل التوزيع
   * القياسي" — and that is exactly what this does. `applyHistoricalImport`
   * appends `assigned` + `completed` events to the distribution log and writes
   * an `ItemAnswer` into another user's answer file; the fact that the work is
   * already finished makes its footprint larger than an ordinary assignment's,
   * not smaller. `persist` still applies `.ingest` for the record write itself,
   * exactly as the ordinary assign path does for an unsaved import.
   */
  const handleHistoricalImport = useCallback(async () => {
    if (editor === null || !directoryHandle) return;
    // Handler-boundary capability check — the panel's hidden button is only a hint.
    if (!canAssign) {
      setError(L.adhoc_import_denied);
      return;
    }
    if (editor.record.status === "closed") {
      setError(L.adhoc_import_assign_closed);
      return;
    }
    // Blocking pre-flight: an unresolvable reviewer, a blank reviewer or a
    // template mismatch must stop the whole import before any write, never be
    // discovered halfway through one.
    if (historicalPlan === null || historicalPlan.errors.length > 0) return;

    setError(null);
    setNotice(null);
    setNotes([]);
    setImportingHistorical(true);
    try {
      const base = editor.persisted ? editor.record : await persist(editor.record);
      if (base === null) return;
      const result = await applyHistoricalImport(
        directoryHandle,
        base,
        historicalPlan.plan,
        operator
      );
      if (!result.ok) {
        setEditor((previous) =>
          previous === null ? previous : { ...previous, record: base, persisted: true }
        );
        setError(fillTemplate(L.adhoc_hist_import_failed, { error: result.error }));
        return;
      }
      setEditor((previous) =>
        previous === null ? previous : { ...previous, record: result.record, persisted: true }
      );
      let message = fillTemplate(L.adhoc_hist_import_success, {
        count: String(result.importedCount),
      });
      if (result.skippedCount > 0) {
        message +=
          " " + fillTemplate(L.adhoc_hist_import_skipped, { count: String(result.skippedCount) });
      }
      setNotice(message);
      // The warnings are NOT re-announced here. `HistoricalPanel` renders the
      // live plan's warnings, whole-import and per-row alike, and it keeps
      // rendering them after a successful run — copying them into the notes
      // list as well would print every one of them twice on the same screen.
      await refreshIndex();
    } catch (err) {
      logError("AdhocImport.historical", err);
      setError(
        fillTemplate(L.adhoc_hist_import_failed, {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setImportingHistorical(false);
    }
  }, [editor, directoryHandle, canAssign, historicalPlan, persist, operator, refreshIndex, L]);

  const applyImportStatusToggle = useCallback(async () => {
    if (editor === null || !canIngest) return;
    setShowCloseConfirm(false);
    const nextStatus = editor.record.status === "open" ? "closed" : "open";
    try {
      const saved = await persist({
        ...editor.record,
        status: nextStatus,
        closedBy: nextStatus === "closed" ? operator : editor.record.closedBy,
        closedAt: nextStatus === "closed" ? new Date().toISOString() : editor.record.closedAt,
      });
      if (saved === null) return;
      setEditor((previous) =>
        previous === null ? previous : { ...previous, record: saved, persisted: true }
      );
      await refreshIndex();
    } catch (err) {
      logError("AdhocImport.statusToggle", err);
      setError(
        fillTemplate(L.adhoc_review_save_failed, {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }, [editor, canIngest, persist, operator, refreshIndex, L]);

  /* ── render ─────────────────────────────────────────────────────────────── */

  if (!workspaceReady) {
    return (
      <div className="adhoc-import-tab">
        <PageHeader
          eyebrow={L.page_adhoc_import_eyebrow}
          title={L.page_adhoc_import_title}
          subtitle={L.page_adhoc_import_subtitle}
        />
        <p className="adhoc-import-empty">{L.adhoc_import_no_workspace}</p>
      </div>
    );
  }

  const stepTitles = [
    L.adhoc_wizard_step1_title,
    L.adhoc_wizard_step2_title,
    // Step 3 of a historical import is not a distribution step — it records
    // finished work — so the rail says so rather than promising an assignment.
    isHistorical ? L.adhoc_wizard_step3_title_historical : L.adhoc_wizard_step3_title,
  ];

  return (
    <div className="adhoc-import-tab">
      <PageHeader
        eyebrow={L.page_adhoc_import_eyebrow}
        title={L.page_adhoc_import_title}
        subtitle={L.page_adhoc_import_subtitle}
      />
      <p className="adhoc-import-scope-note">{L.adhoc_import_scope_note}</p>

      {error && (
        <div className="adhoc-import-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="adhoc-import-notice" role="status">
          {notice}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="adhoc-import-notes" role="status">
          {notes.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {editor === null && (
        <>
          <section className="adhoc-import-upload-card">
            <button type="button" onClick={startNewImport} disabled={!canIngest}>
              {L.adhoc_wizard_new_import}
            </button>
          </section>

          <ImportsList imports={imports} onOpen={(importId) => void openImport(importId)} />
        </>
      )}

      {editor !== null && (
        <section className="adhoc-import-detail">
          <div className="adhoc-import-detail-toolbar">
            <button type="button" onClick={backToList}>
              {L.adhoc_import_back_to_list}
            </button>
            <h2>
              {fillTemplate(L.adhoc_import_review_title, {
                fileName: editor.record.fileName || L.adhoc_wizard_new_import,
              })}
            </h2>
            {!editor.persisted && (
              <span className="adhoc-chip-warn">{L.adhoc_review_unsaved_badge}</span>
            )}
            {canIngest && editor.persisted && (
              <button
                type="button"
                onClick={() => {
                  if (editor.record.status === "open") setShowCloseConfirm(true);
                  else void applyImportStatusToggle();
                }}
              >
                {editor.record.status === "open"
                  ? L.adhoc_import_close_button
                  : L.adhoc_import_reopen_button}
              </button>
            )}
          </div>

          {editor.origin === "new" && (
            <ol className="adhoc-steps" aria-label={L.adhoc_wizard_steps_aria}>
              {stepTitles.map((title, index) => (
                <li
                  key={title}
                  className={`adhoc-step${editor.step === index + 1 ? " is-active" : ""}`}
                  aria-current={editor.step === index + 1 ? "step" : undefined}
                >
                  <span className="adhoc-step-num">
                    {fillTemplate(L.adhoc_wizard_step_number, { number: String(index + 1) })}
                  </span>
                  <span className="adhoc-step-title">{title}</span>
                </li>
              ))}
            </ol>
          )}

          <ConfirmDialog
            open={showCloseConfirm}
            message={L.adhoc_import_close_confirm}
            danger
            onConfirm={() => void applyImportStatusToggle()}
            onCancel={() => setShowCloseConfirm(false)}
          />

          {editor.step === 1 && (
            <SourceStep
              editor={editor}
              months={months}
              templates={templates}
              disabled={!canIngest}
              reading={reading}
              onFile={(file) => void handleFile(file)}
              onPastedTable={handlePastedTable}
              onSourceMode={handleSourceMode}
              onToggleSheet={handleToggleSheet}
              onKind={(kind) => patchRecord({ kind })}
              onTemplate={(templateId) => void handleTemplate(templateId)}
              onBinding={(monthBinding) => patchRecord({ monthBinding })}
            />
          )}

          {editor.step === 2 && (
            <MappingStep
              editor={editor}
              disabled={!canIngest}
              onMapping={updateMapping}
              onPreviewSheet={(previewSheet) =>
                setEditor((previous) => (previous === null ? previous : { ...previous, previewSheet }))
              }
            />
          )}

          {editor.step === 3 && (
            <>
              <p className="adhoc-import-review-note">{L.adhoc_review_note}</p>
              <p className="adhoc-import-scope-note">
                {fillTemplate(L.adhoc_review_summary, {
                  total: String(editor.record.rows.length),
                  valid: String(editor.record.rows.filter((r) => r.validation.valid).length),
                  invalid: String(editor.record.rows.filter((r) => !r.validation.valid).length),
                  excluded: String(editor.record.rows.filter((r) => r.excludedByAdmin).length),
                })}
              </p>
              <p className="adhoc-import-scope-note">
                {(() => {
                  const linked = linkedMonthsOf(editor.record.monthBinding, editor.record.rows);
                  return linked.length === 0
                    ? L.adhoc_review_linked_none
                    : fillTemplate(L.adhoc_review_linked_months, { months: linked.join("، ") });
                })()}
              </p>

              <ReviewTable
                record={editor.record}
                selectedRowKeys={selectedRowKeys}
                canIngest={canIngest}
                canAssign={canAssign}
                onToggleRow={toggleRowSelected}
                onToggleExcluded={(rowKey) => void toggleExcluded(rowKey)}
              />

              <div className="adhoc-import-assign-bar">
                {canIngest && (
                  <button type="button" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? L.adhoc_review_saving : L.adhoc_review_save_button}
                  </button>
                )}
                {/* Row selection is a DISTRIBUTION control: a historical file's
                    rows are not being handed out, so it says nothing there. */}
                {canAssign && !isHistorical && (
                  <>
                    <button type="button" onClick={selectAllAssignable}>
                      {L.adhoc_import_select_all}
                    </button>
                    <button type="button" onClick={clearSelection}>
                      {L.adhoc_import_clear_selection}
                    </button>
                    <span>
                      {fillTemplate(L.adhoc_import_selected_count, {
                        count: String(selectedRowKeys.size),
                      })}
                    </span>
                  </>
                )}
              </div>

              {isHistorical ? (
                <HistoricalPanel
                  plan={historicalPlan}
                  unavailableReason={historicalUnavailable}
                  busy={importingHistorical}
                  disabled={editor.record.status === "closed"}
                  canImport={canAssign}
                  onImport={() => void handleHistoricalImport()}
                />
              ) : (
                <AssignmentPanel
                  importId={editor.record.importId}
                  rows={editor.record.rows}
                  employees={employees}
                  explicitRowKeys={[...selectedRowKeys]}
                  canAssign={canAssign}
                  disabled={editor.record.status === "closed"}
                  busy={assigning}
                  onAssign={(plan) => void handleAssign(plan)}
                />
              )}
            </>
          )}

          {editor.origin === "new" && editor.step < 3 && (
            <div className="adhoc-wizard-nav">
              <button type="button" onClick={goBack} disabled={editor.step === 1}>
                {L.adhoc_wizard_back}
              </button>
              <button type="button" onClick={goNext} disabled={!canIngest || !canAdvance}>
                {L.adhoc_wizard_next}
              </button>
              {editor.step === 1 && includedTables.length === 0 && (
                <span className="adhoc-import-empty">{L.adhoc_wizard_blocked_no_table}</span>
              )}
              {editor.step === 2 && requiredUnmapped.length > 0 && (
                <span className="adhoc-blocked" role="status">
                  {L.adhoc_wizard_blocked_required}
                </span>
              )}
            </div>
          )}

          {editor.origin === "new" && editor.step === 3 && (
            <div className="adhoc-wizard-nav">
              <button type="button" onClick={goBack}>
                {L.adhoc_wizard_back}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
