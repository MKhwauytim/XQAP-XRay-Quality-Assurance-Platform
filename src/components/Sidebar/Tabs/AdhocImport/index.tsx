/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";

import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { readSession } from "../../../../auth/authSession";
import { readUserManagementState, subscribeToUserManagementChanges, type ManagedLoginUser } from "../../../../auth/userManagement";
import { isAssignableSampleRole } from "../../../../data/distribution/bulkAssignment";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import DataTable, { type DataTableCol } from "../../../../components/DataTable";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import { formatDateTime } from "../../../../utils/formatting";
import {
  loadActiveColumnMappings,
  parseAdhocImportFile,
} from "../../../../data/adhocImport/adhocImportMapping";
import {
  createImportId,
  loadAdhocImportIndex,
  loadAdhocImportRecord,
  saveAdhocImportRecord,
} from "../../../../data/adhocImport/adhocImportStorage";
import { ensureAdhocSampleMaster, assignAdhocRowsToEmployee } from "../../../../data/adhocImport/adhocImportAssignment";
import type {
  AdhocImportIndexEntry,
  AdhocImportRecord,
  AdhocImportRow,
} from "../../../../data/adhocImport/adhocImportTypes";
import type { SidebarTabModule } from "../tabTypes";
import "./AdhocImport.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "adhoc-import",
  label: "استيراد بيانات مخصص",
  order: 97,
  allowedRoles: tabAllowedRoles("adhoc-import"),
  icon: <FileSpreadsheet size={20} strokeWidth={1.8} aria-hidden />,
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => vars[key] ?? `{${key}}`);
}

export default function AdhocImportTab() {
  const L = useLabels();
  const { directoryHandle, status: workspaceStatus } = useWorkspace();
  const { canMutate } = usePermissions();
  const session = readSession();
  const operator = session?.username ?? "";

  const [imports, setImports] = useState<AdhocImportIndexEntry[]>([]);
  const [selected, setSelected] = useState<AdhocImportRecord | null>(null);
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workspaceReady = workspaceStatus === "ready" && directoryHandle !== null;
  const canIngest = canMutate("adhoc-import.ingest");
  const canAssign = canMutate("adhoc-import.assign");

  // Audit finding 6: this used to be a mount-time-only snapshot (`useMemo(...,[])`),
  // so a user added/deactivated after the tab mounted never showed up (or never
  // disappeared) in the assignment dropdown until a full remount. Now it re-derives
  // whenever the managed-user roster actually changes, matching the pattern used
  // elsewhere (e.g. NotificationManager's computeAudienceUsers). The handler-side
  // check (assignAdhocRowsToEmployee -> findAssignableEmployee) is the real
  // authorization boundary; this only keeps the picker from offering a stale option.
  const computeAssignableEmployees = useCallback(
    (): ManagedLoginUser[] => readUserManagementState().users.filter((u) => u.isActive && isAssignableSampleRole(u)),
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
    if (!workspaceReady) return;
    const timer = window.setTimeout(() => {
      void refreshIndex();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, refreshIndex]);

  const handleUpload = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!directoryHandle) {
      setError(L.adhoc_import_no_workspace);
      return;
    }
    if (!canIngest) {
      setError(L.adhoc_import_denied);
      return;
    }
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError(L.adhoc_import_choose_file_first);
      return;
    }

    setUploading(true);
    try {
      const columnMappings = await loadActiveColumnMappings(directoryHandle);
      const rows: AdhocImportRow[] = await parseAdhocImportFile(file, columnMappings);
      const record: AdhocImportRecord = {
        importId: createImportId(),
        fileName: file.name,
        importedBy: operator,
        importedAt: new Date().toISOString(),
        status: "open",
        rows,
      };
      const saved = await saveAdhocImportRecord(directoryHandle, record);
      await ensureAdhocSampleMaster(directoryHandle, saved);
      await refreshIndex();
      setSelected(saved);
      setSelectedRowKeys(new Set());
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(fillTemplate(L.adhoc_import_parse_failed, { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setUploading(false);
    }
  }, [directoryHandle, canIngest, operator, refreshIndex, L]);

  const openImport = useCallback(async (importId: string) => {
    if (!directoryHandle) return;
    const record = await loadAdhocImportRecord(directoryHandle, importId);
    setSelected(record);
    setSelectedRowKeys(new Set());
    setError(null);
    setNotice(null);
  }, [directoryHandle]);

  const backToList = useCallback(() => {
    setSelected(null);
    setSelectedRowKeys(new Set());
  }, []);

  const toggleExcluded = useCallback(async (rowKey: string) => {
    if (!directoryHandle || !selected || !canIngest) return;
    const nextRows = selected.rows.map((r) =>
      r.rowKey === rowKey ? { ...r, excludedByAdmin: !r.excludedByAdmin } : r
    );
    const saved = await saveAdhocImportRecord(directoryHandle, { ...selected, rows: nextRows });
    setSelected(saved);
  }, [directoryHandle, selected, canIngest]);

  const assignableRows = useMemo(
    () => (selected ? selected.rows.filter((r) => r.validation.valid && !r.excludedByAdmin && !r.assigned) : []),
    [selected]
  );

  const toggleRowSelected = useCallback((rowKey: string) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const selectAllAssignable = useCallback(() => {
    setSelectedRowKeys(new Set(assignableRows.map((r) => r.rowKey)));
  }, [assignableRows]);

  const clearSelection = useCallback(() => setSelectedRowKeys(new Set()), []);

  const handleAssign = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!directoryHandle || !selected) return;
    if (!canAssign) {
      setError(L.adhoc_import_denied);
      return;
    }
    if (selected.status === "closed") {
      setError(L.adhoc_import_assign_closed);
      return;
    }
    if (!assignTo) {
      setError(L.adhoc_import_assign_choose_employee);
      return;
    }
    if (selectedRowKeys.size === 0) {
      setError(L.adhoc_import_assign_choose_rows);
      return;
    }

    setAssigning(true);
    try {
      const result = await assignAdhocRowsToEmployee(
        directoryHandle,
        selected,
        [...selectedRowKeys],
        assignTo,
        operator
      );
      if (!result.ok) {
        setError(fillTemplate(L.adhoc_import_assign_failed, { error: result.error }));
        return;
      }
      setSelected(result.record);
      setSelectedRowKeys(new Set());
      let message = fillTemplate(L.adhoc_import_assign_success, { count: String(result.assignedCount) });
      if (result.skippedCount > 0) {
        message += " " + fillTemplate(L.adhoc_import_assign_skipped, { count: String(result.skippedCount) });
      }
      setNotice(message);
      await refreshIndex();
    } catch (err) {
      setError(fillTemplate(L.adhoc_import_assign_failed, { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAssigning(false);
    }
  }, [directoryHandle, selected, canAssign, assignTo, selectedRowKeys, operator, refreshIndex, L]);

  // Closing a batch stops further assignment into it, so it keeps a confirmation
  // step — now the app's own RTL ConfirmDialog rather than native window.confirm.
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const applyImportStatusToggle = useCallback(async () => {
    if (!directoryHandle || !selected || !canIngest) return;
    setShowCloseConfirm(false);
    const nextStatus = selected.status === "open" ? "closed" : "open";
    const saved = await saveAdhocImportRecord(directoryHandle, {
      ...selected,
      status: nextStatus,
      closedBy: nextStatus === "closed" ? operator : selected.closedBy,
      closedAt: nextStatus === "closed" ? new Date().toISOString() : selected.closedAt,
    });
    setSelected(saved);
    await refreshIndex();
  }, [directoryHandle, selected, canIngest, operator, refreshIndex]);

  const rowColumns: DataTableCol<AdhocImportRow>[] = useMemo(() => [
    { id: "select", label: "", widthFr: 4, alwaysVisible: true, accessor: () => null },
    { id: "rowKey", label: L.adhoc_import_col_row_key, widthFr: 10, alwaysVisible: true, filterKind: "text", accessor: (r) => r.rowKey },
    { id: "xrayImageId", label: L.col_xray_image_id, widthFr: 14, filterKind: "text", accessor: (r) => r.mapped.xrayImageId },
    { id: "portName", label: L.col_port_name, widthFr: 10, accessor: (r) => r.mapped.portName },
    { id: "declarationNumber", label: L.col_declaration_number, widthFr: 12, accessor: (r) => r.mapped.declarationNumber },
    { id: "xrayLevelOneResult", label: L.col_xray_l1_result, widthFr: 8, accessor: (r) => r.mapped.xrayLevelOneResult },
    { id: "xrayLevelTwoResult", label: L.col_xray_l2_result, widthFr: 8, accessor: (r) => r.mapped.xrayLevelTwoResult },
    { id: "validation", label: L.adhoc_import_col_validation, widthFr: 16, filterKind: "status",
      statusOptions: [
        { value: "valid", label: L.adhoc_import_validation_valid },
        { value: "invalid", label: L.adhoc_import_validation_invalid },
      ],
      accessor: (r) => r.validation.valid ? "valid" : "invalid" },
    { id: "excluded", label: L.adhoc_import_col_excluded, widthFr: 8, accessor: () => null },
    { id: "assignedTo", label: L.adhoc_import_col_assigned_to, widthFr: 10, accessor: (r) => r.assignedTo },
  ], [L]);

  if (!workspaceReady) {
    return (
      <div className="adhoc-import-tab">
        <PageHeader eyebrow={L.page_adhoc_import_eyebrow} title={L.page_adhoc_import_title} subtitle={L.page_adhoc_import_subtitle} />
        <p className="adhoc-import-empty">{L.adhoc_import_no_workspace}</p>
      </div>
    );
  }

  return (
    <div className="adhoc-import-tab">
      <PageHeader eyebrow={L.page_adhoc_import_eyebrow} title={L.page_adhoc_import_title} subtitle={L.page_adhoc_import_subtitle} />
      <p className="adhoc-import-scope-note">{L.adhoc_import_scope_note}</p>

      {error && <div className="adhoc-import-error" role="alert">{error}</div>}
      {notice && <div className="adhoc-import-notice" role="status">{notice}</div>}

      {!selected && (
        <>
          <section className="adhoc-import-upload-card">
            <label htmlFor="adhoc-import-file">{L.adhoc_import_upload_label}</label>
            <input id="adhoc-import-file" type="file" accept=".xlsx,.xls" ref={fileInputRef} disabled={!canIngest || uploading} />
            <button type="button" onClick={() => void handleUpload()} disabled={!canIngest || uploading}>
              {uploading ? L.adhoc_import_uploading : L.adhoc_import_upload_button}
            </button>
          </section>

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
                    <tr key={entry.importId} onClick={() => void openImport(entry.importId)} className="adhoc-import-list-row">
                      <td>{entry.fileName}</td>
                      <td>{entry.importedBy}</td>
                      <td>{formatDateTime(entry.importedAt)}</td>
                      <td>{entry.status === "open" ? L.adhoc_import_status_open : L.adhoc_import_status_closed}</td>
                      <td>{entry.totalRows}</td>
                      <td>{entry.validRows}</td>
                      <td>{entry.assignedRows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {selected && (
        <section className="adhoc-import-detail">
          <div className="adhoc-import-detail-toolbar">
            <button type="button" onClick={backToList}>{L.adhoc_import_back_to_list}</button>
            <h2>{fillTemplate(L.adhoc_import_review_title, { fileName: selected.fileName })}</h2>
            {canIngest && (
              <button
                type="button"
                onClick={() => {
                  if (selected.status === "open") setShowCloseConfirm(true);
                  else void applyImportStatusToggle();
                }}
              >
                {selected.status === "open" ? L.adhoc_import_close_button : L.adhoc_import_reopen_button}
              </button>
            )}
          </div>
          <p className="adhoc-import-review-note">{L.adhoc_import_review_note}</p>

          <ConfirmDialog
            open={showCloseConfirm}
            message={L.adhoc_import_close_confirm}
            danger
            onConfirm={() => void applyImportStatusToggle()}
            onCancel={() => setShowCloseConfirm(false)}
          />

          <DataTable<AdhocImportRow>
            columns={rowColumns}
            rows={selected.rows}
            getRowKey={(r) => r.rowKey}
            renderCell={(col, row) => {
              if (col.id === "select") {
                const eligible = row.validation.valid && !row.excludedByAdmin && !row.assigned;
                return (
                  <input
                    type="checkbox"
                    disabled={!eligible || !canAssign}
                    checked={selectedRowKeys.has(row.rowKey)}
                    onChange={() => toggleRowSelected(row.rowKey)}
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
                    disabled={!canIngest || row.assigned}
                    checked={row.excludedByAdmin}
                    onChange={() => void toggleExcluded(row.rowKey)}
                    aria-label={L.adhoc_import_col_excluded}
                  />
                );
              }
              if (col.id === "assignedTo") {
                return row.assigned ? `${row.assignedTo} (${L.adhoc_import_assigned_badge})` : "—";
              }
              return col.accessor(row) ?? "—";
            }}
            defaultVisible={["select", "rowKey", "xrayImageId", "portName", "declarationNumber", "xrayLevelOneResult", "xrayLevelTwoResult", "validation", "excluded", "assignedTo"]}
            canConfigureColumns={false}
          />

          <div className="adhoc-import-assign-bar">
            <button type="button" onClick={selectAllAssignable} disabled={!canAssign}>{L.adhoc_import_select_all}</button>
            <button type="button" onClick={clearSelection}>{L.adhoc_import_clear_selection}</button>
            <span>{fillTemplate(L.adhoc_import_selected_count, { count: String(selectedRowKeys.size) })}</span>
            <label htmlFor="adhoc-import-assign-to">{L.adhoc_import_assign_to_label}</label>
            <select id="adhoc-import-assign-to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} disabled={!canAssign}>
              <option value="">—</option>
              {employees.map((emp) => (
                <option key={emp.username} value={emp.username}>{emp.displayName} ({emp.username})</option>
              ))}
            </select>
            <button type="button" onClick={() => void handleAssign()} disabled={!canAssign || assigning || selected.status === "closed"}>
              {assigning ? L.adhoc_import_assigning : L.adhoc_import_assign_button}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
