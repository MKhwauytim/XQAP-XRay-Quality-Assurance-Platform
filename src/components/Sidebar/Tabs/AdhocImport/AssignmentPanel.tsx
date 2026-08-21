import { useMemo, useState } from "react";

import type { ManagedLoginUser } from "../../../../auth/userManagement";
import { planAdhocAssignment } from "../../../../data/adhocImport/adhocAssignmentPlan";
import type {
  AdhocRow,
  AssignmentMode,
  AssignmentPlan,
  AssignmentTarget,
} from "../../../../data/adhocImport/adhocImportModel";
import { useLabels } from "../../../../data/labels/useLabels";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./AdhocImport.css";

const MODES: AssignmentMode[] = ["explicit", "count", "percentage", "fanout"];

export type AssignmentPanelProps = {
  importId: string;
  /** Every row of the import; the planner does its own eligibility filtering. */
  rows: AdhocRow[];
  /** Live roster — already filtered to active + assignable by the caller. */
  employees: ManagedLoginUser[];
  /** Rows the admin ticked in the review table. `explicit` mode's input. */
  explicitRowKeys: string[];
  canAssign: boolean;
  /** Closed import, in-flight write, unsaved prerequisites — anything that blocks the write. */
  disabled?: boolean;
  busy?: boolean;
  onAssign: (plan: AssignmentPlan, mode: AssignmentMode) => void;
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

/** Eligible = what `planAdhocAssignment` will actually consider, mirrored for the pool counter. */
function eligibleCount(rows: AdhocRow[]): number {
  return rows.filter((row) => row.validation.valid && !row.excludedByAdmin && row.assignments.length === 0).length;
}

function labelForMode(mode: AssignmentMode, labels: ReturnType<typeof useLabels>): string {
  if (mode === "explicit") return labels.adhoc_assign_mode_explicit;
  if (mode === "count") return labels.adhoc_assign_mode_count;
  if (mode === "percentage") return labels.adhoc_assign_mode_percentage;
  return labels.adhoc_assign_mode_fanout;
}

/**
 * Distribution controls for one ad-hoc import.
 *
 * The preview is produced by `planAdhocAssignment` — the SAME pure function the
 * write path runs — so the number on screen is the number that gets written.
 * Anything the planner complains about (a count nobody can satisfy, a duplicate
 * xrayImageId, a zeroed weight) is surfaced verbatim rather than reduced to a
 * total, because a shortfall the operator cannot see is a shortfall they will
 * discover from an employee's empty queue a week later.
 *
 * Fan-out is the one mode that MULTIPLIES workload (500 rows × 6 reviewers =
 * 3,000 reviews), so it is the one mode gated behind an explicit confirmation
 * that names the total.
 */
export default function AssignmentPanel({
  importId,
  rows,
  employees,
  explicitRowKeys,
  canAssign,
  disabled,
  busy,
  onAssign,
}: AssignmentPanelProps) {
  const labels = useLabels();
  const [mode, setMode] = useState<AssignmentMode>("explicit");
  /** Order matters: `count` slices and `fanout` replica indices both follow it. */
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [explicitUsername, setExplicitUsername] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [pendingFanout, setPendingFanout] = useState<AssignmentPlan | null>(null);

  const locked = !canAssign || disabled === true || busy === true;

  const targets = useMemo((): AssignmentTarget[] => {
    if (mode === "explicit") {
      return explicitUsername === "" ? [] : [{ username: explicitUsername }];
    }
    return selectedUsernames.map((username) => {
      const target: AssignmentTarget = { username };
      if (mode === "count") {
        const raw = counts[username];
        target.count = raw === undefined || raw.trim() === "" ? 0 : Number(raw);
      }
      if (mode === "percentage") {
        const raw = weights[username];
        // Blank stays undefined so the planner's "equal weight by default" rule
        // applies, instead of being read as an explicit zero.
        if (raw !== undefined && raw.trim() !== "") target.weight = Number(raw);
      }
      return target;
    });
  }, [mode, explicitUsername, selectedUsernames, counts, weights]);

  const preview = useMemo(
    () =>
      planAdhocAssignment({
        rows,
        mode,
        targets,
        explicitRowKeys,
        importId,
      }),
    [rows, mode, targets, explicitRowKeys, importId]
  );

  const perEmployee = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of preview.plan) {
      totals.set(entry.username, (totals.get(entry.username) ?? 0) + 1);
    }
    return [...totals.entries()];
  }, [preview]);

  const distinctRows = useMemo(
    () => new Set(preview.plan.map((entry) => entry.rowKey)).size,
    [preview]
  );

  function toggleEmployee(username: string): void {
    setSelectedUsernames((previous) =>
      previous.includes(username)
        ? previous.filter((name) => name !== username)
        : [...previous, username]
    );
  }

  function handleSubmit(): void {
    // Handler-boundary check, not just the render-boundary `disabled` above:
    // a disabled button is a hint, the capability is the rule.
    if (!canAssign || disabled === true || busy === true) return;
    if (preview.plan.length === 0) return;
    if (mode === "fanout") {
      setPendingFanout(preview);
      return;
    }
    onAssign(preview, mode);
  }

  function confirmFanout(): void {
    const plan = pendingFanout;
    setPendingFanout(null);
    if (plan === null || !canAssign || disabled === true) return;
    onAssign(plan, "fanout");
  }

  return (
    <section className="adhoc-assign-panel" dir="rtl" aria-label={labels.adhoc_assign_title}>
      <h3 className="adhoc-assign-title">{labels.adhoc_assign_title}</h3>
      <p className="adhoc-assign-pool">
        {fill(labels.adhoc_assign_pool_size, { count: String(eligibleCount(rows)) })}
      </p>

      <fieldset className="adhoc-assign-modes">
        <legend>{labels.adhoc_assign_mode_label}</legend>
        {MODES.map((option) => (
          <label key={option} className="adhoc-assign-mode-option">
            <input
              type="radio"
              name="adhoc-assign-mode"
              value={option}
              checked={mode === option}
              disabled={locked}
              onChange={() => setMode(option)}
            />
            <span>{labelForMode(option, labels)}</span>
          </label>
        ))}
      </fieldset>

      {mode === "fanout" && (
        <p className="adhoc-assign-warning" role="status">
          {labels.adhoc_assign_fanout_warning}
        </p>
      )}

      {employees.length === 0 ? (
        <p className="adhoc-import-empty">{labels.adhoc_assign_no_employees}</p>
      ) : mode === "explicit" ? (
        <div className="adhoc-assign-explicit">
          <label htmlFor="adhoc-import-assign-to">{labels.adhoc_import_assign_to_label}</label>
          <select
            id="adhoc-import-assign-to"
            value={explicitUsername}
            disabled={locked}
            onChange={(event) => setExplicitUsername(event.target.value)}
          >
            <option value="">—</option>
            {employees.map((employee) => (
              <option key={employee.username} value={employee.username}>
                {employee.displayName} ({employee.username})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <ul className="adhoc-assign-employee-list">
          {employees.map((employee) => {
            const checked = selectedUsernames.includes(employee.username);
            return (
              <li key={employee.username} className="adhoc-assign-employee-row">
                <label>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    aria-label={fill(labels.adhoc_assign_employee_toggle_aria, {
                      employee: employee.username,
                    })}
                    onChange={() => toggleEmployee(employee.username)}
                  />
                  <span>
                    {employee.displayName} ({employee.username})
                  </span>
                </label>

                {mode === "count" && checked && (
                  <input
                    type="number"
                    min={0}
                    className="adhoc-assign-number"
                    value={counts[employee.username] ?? ""}
                    disabled={locked}
                    aria-label={fill(labels.adhoc_assign_count_aria, {
                      employee: employee.username,
                    })}
                    onChange={(event) =>
                      setCounts((previous) => ({
                        ...previous,
                        [employee.username]: event.target.value,
                      }))
                    }
                  />
                )}

                {mode === "percentage" && checked && (
                  <input
                    type="number"
                    min={0}
                    className="adhoc-assign-number"
                    value={weights[employee.username] ?? ""}
                    disabled={locked}
                    aria-label={fill(labels.adhoc_assign_weight_aria, {
                      employee: employee.username,
                    })}
                    onChange={(event) =>
                      setWeights((previous) => ({
                        ...previous,
                        [employee.username]: event.target.value,
                      }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="adhoc-assign-preview" role="status">
        <h4>{labels.adhoc_assign_preview_title}</h4>
        {preview.plan.length === 0 ? (
          <p>{labels.adhoc_assign_preview_empty}</p>
        ) : (
          <ul className="adhoc-assign-preview-list">
            <li>{fill(labels.adhoc_assign_preview_total, { count: String(preview.plan.length) })}</li>
            <li>{fill(labels.adhoc_assign_preview_rows, { count: String(distinctRows) })}</li>
            {preview.leftover > 0 && (
              <li>
                {fill(labels.adhoc_assign_preview_leftover, { count: String(preview.leftover) })}
              </li>
            )}
            {perEmployee.map(([username, count]) => (
              <li key={username}>
                {fill(labels.adhoc_assign_preview_per_employee, {
                  employee: username,
                  count: String(count),
                })}
              </li>
            ))}
          </ul>
        )}

        {preview.errors.length > 0 && (
          <div className="adhoc-assign-errors">
            <span className="adhoc-assign-errors-title">{labels.adhoc_assign_errors_title}</span>
            <ul>
              {preview.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {canAssign && (
        <button
          type="button"
          className="adhoc-assign-submit"
          disabled={locked || preview.plan.length === 0}
          onClick={handleSubmit}
        >
          {busy === true ? labels.adhoc_import_assigning : labels.adhoc_assign_submit}
        </button>
      )}

      <ConfirmDialog
        open={pendingFanout !== null}
        danger
        message={fill(labels.adhoc_assign_fanout_confirm, {
          count: String(pendingFanout?.plan.length ?? 0),
          rows: String(new Set((pendingFanout?.plan ?? []).map((entry) => entry.rowKey)).size),
          employees: String(new Set((pendingFanout?.plan ?? []).map((entry) => entry.username)).size),
        })}
        onConfirm={confirmFanout}
        onCancel={() => setPendingFanout(null)}
      />
    </section>
  );
}
