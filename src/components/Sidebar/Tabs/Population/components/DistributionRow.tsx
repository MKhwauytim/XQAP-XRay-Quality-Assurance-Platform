import { useState } from "react";
import type { PreparedPopulationRow } from "../processing/populationProcessingTypes";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";

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
  const status = entry?.status ?? "unassigned";
  const assignedTo = entry?.assignedTo ?? "";

  return (
    <div className="distribution-row" role="row" data-status={status}>
      <span className="dist-cell mono">{row.xrayImageId}</span>
      <span className="dist-cell">{row.portName ?? ""}</span>
      <span className="dist-cell">{row.certScanStatus}</span>
      <span className={`dist-cell dist-status dist-status-${status}`}>
        {status === "unassigned"
          ? "غير معين"
          : status === "pending"
            ? "قيد الانتظار"
            : status === "completed"
              ? "مكتمل"
              : status === "replacement-requested"
                ? "طلب استبدال"
                : "مستبدل"}
      </span>
      <span className="dist-cell">{assignedTo}</span>

      <div className="dist-actions">
        {status === "unassigned" || !entry ? (
          <>
            <select
              className="dist-employee-select"
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              disabled={isDisabled}
            >
              <option value="">اختر موظف</option>
              {employees.map((emp) => (
                <option key={emp.username} value={emp.username}>
                  {emp.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dist-btn dist-btn-assign"
              disabled={!selectedEmployee || isDisabled}
              onClick={() => onAssign(row.xrayImageId, selectedEmployee)}
            >
              تعيين
            </button>
          </>
        ) : status === "pending" ? (
          <>
            <select
              className="dist-employee-select"
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              disabled={isDisabled}
            >
              <option value="">إعادة تعيين لـ...</option>
              {employees.map((emp) => (
                <option key={emp.username} value={emp.username}>
                  {emp.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dist-btn dist-btn-secondary"
              disabled={!selectedEmployee || isDisabled}
              onClick={() => onReassign(row.xrayImageId, selectedEmployee)}
            >
              إعادة
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
              مكتمل
            </button>
            <button
              type="button"
              className="dist-btn dist-btn-warning"
              disabled={isDisabled}
              onClick={() => onRequestReplacement(row.xrayImageId)}
            >
              استبدال
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
