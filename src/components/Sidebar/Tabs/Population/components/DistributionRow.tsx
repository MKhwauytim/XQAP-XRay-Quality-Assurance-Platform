import { useState } from "react";
import type { PreparedPopulationRow } from "../processing/populationProcessingTypes";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import { getLabels } from "../../../../../data/labels/labelsStore";

const STATUS_LABELS: Record<string, string> = {
  unassigned: "غير معين",
  pending: "قيد الانتظار",
  completed: "مكتمل",
  "replacement-requested": "طلب استبدال",
  replaced: "مستبدل",
};

type DistributionRowProps = {
  row: PreparedPopulationRow;
  entry: DistributionEntry | null;
  employees: Array<{ username: string; displayName: string }>;
  isDisabled: boolean;
  onAssign: (xrayImageId: string, assignedTo: string) => Promise<void>;
  onReassign: (xrayImageId: string, reassignedTo: string) => Promise<void>;
  onMarkComplete: (xrayImageId: string) => Promise<void>;
  onRequestReplacement: (xrayImageId: string) => Promise<void>;
};

/**
 * One المراجعة اليدوية row (design handoff panel `5c`, 2026-08).
 *
 * The action set is strictly a function of the row's status and is NOT widened
 * by the redesign:
 *   unassigned            → expert select + تعيين
 *   pending               → إعادة تعيين / مكتمل / استبدال
 *   replacement-requested → a note pointing at اعتماد الطلبات
 *   completed / replaced  → no action
 *
 * The `5c` mock puts اعتماد الاستبدال / رفض buttons on a replacement-requested
 * row. They are deliberately NOT built here: approving or rejecting a
 * replacement already has one home — the `ew/referral-approval` sub-tab — with
 * its own approval records and permission rules. A second approval path in the
 * distribution table would mean two implementations of the same decision, which
 * is a correctness problem, not a layout one. Two permanently-disabled buttons
 * would be no better: the row states where the decision is made instead.
 */
export default function DistributionRow({
  row,
  entry,
  employees,
  isDisabled,
  onAssign,
  onReassign,
  onMarkComplete,
  onRequestReplacement
}: DistributionRowProps) {
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const L = getLabels();
  const status = entry?.status ?? "unassigned";
  const assignedTo = entry?.assignedTo ?? "";

  const expertSelect = (placeholder: string) => (
    <select
      className="dist-employee-select"
      aria-label={placeholder}
      value={selectedEmployee}
      onChange={(e) => setSelectedEmployee(e.target.value)}
      disabled={isDisabled}
    >
      <option value="">{placeholder}</option>
      {employees.map((emp) => (
        <option key={emp.username} value={emp.username}>
          {emp.displayName}
        </option>
      ))}
    </select>
  );

  return (
    <div className="p4-manual-row distribution-row" role="row" data-status={status}>
      <span className="dist-cell mono">{row.xrayImageId}</span>
      <span className="dist-cell">{row.portName ?? ""}</span>
      <span className="dist-cell">{row.certScanStatus}</span>
      <span className="dist-cell">
        <span className={`p4-status-pill dist-status dist-status-${status}`}>
          {STATUS_LABELS[status] ?? status}
        </span>
      </span>
      <span className="dist-cell">{assignedTo || "—"}</span>

      <div className="dist-actions">
        {status === "unassigned" || !entry ? (
          <>
            {expertSelect(L.p4_row_select_expert)}
            <button
              type="button"
              className="dist-btn dist-btn-assign"
              disabled={!selectedEmployee || isDisabled}
              onClick={() => onAssign(row.xrayImageId, selectedEmployee)}
            >
              {L.p4_row_assign}
            </button>
          </>
        ) : status === "pending" ? (
          <>
            {expertSelect(L.p4_row_reassign_to)}
            <button
              type="button"
              className="dist-btn dist-btn-secondary"
              disabled={!selectedEmployee || isDisabled}
              onClick={() => onReassign(row.xrayImageId, selectedEmployee)}
            >
              {L.p4_row_reassign}
            </button>
            <button
              type="button"
              className="dist-btn dist-btn-success"
              disabled={isDisabled}
              onClick={async () => {
                await onMarkComplete(row.xrayImageId);
                window.dispatchEvent(new CustomEvent("app-navigate", { detail: { tabId: "employee-workspace" } }));
              }}
            >
              {L.p4_row_complete}
            </button>
            <button
              type="button"
              className="dist-btn dist-btn-warning"
              disabled={isDisabled}
              onClick={() => onRequestReplacement(row.xrayImageId)}
            >
              {L.p4_row_replace}
            </button>
          </>
        ) : status === "replacement-requested" ? (
          <span className="p4-no-action">{L.p4_row_replacement_elsewhere}</span>
        ) : (
          <span className="p4-no-action">{L.p4_row_no_action}</span>
        )}
      </div>
    </div>
  );
}
