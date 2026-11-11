import { useState } from "react";
import { getManagedLoginUsers } from "../../../../auth/userManagement";
import { readSession } from "../../../../auth/authSession";
import { recordAction } from "../../../../data/audit/actionLog";
import {
  addPopulationRowsToSample,
  planPopulationRowsIntoSample,
} from "../../../../data/distribution/addPopulationRowsToSample";
import { isAssignableSampleRole } from "../../../../data/distribution/bulkAssignment";
import { useLabels } from "../../../../data/labels/useLabels";
import type { EmployeePortRestriction } from "../../../../data/population/populationConfig";
import { logError } from "../../../../data/storage/errorLogger";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

type Plan = { fresh: string[]; skipped: number };

/**
 * «إضافة للعينة» (see `addPopulationRowsToSample.ts`): every population row the
 * browse table currently matches that is not in a sample yet joins the month's
 * index sample and is split between the employees picked in the dialog.
 * `collectIds` returns the ids of the whole filtered set, or null when the
 * collection was interrupted.
 */
export function AddToSampleButton({
  directoryHandle,
  month,
  hasFilter,
  collectIds,
  portRestrictions,
  username,
}: {
  directoryHandle: DirectoryHandleLike;
  month: string;
  hasFilter: boolean;
  collectIds: () => Promise<string[] | null>;
  portRestrictions: EmployeePortRestriction[];
  username: string;
}) {
  const L = useLabels();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pickError, setPickError] = useState(false);
  const [notice, setNotice] = useState("");

  const employees = getManagedLoginUsers().filter((user) => user.isActive && isAssignableSampleRole(user));
  const failed = (error: string) => setNotice(fill(L.bv_add_sample_failed, { error }));

  async function openPlan(): Promise<void> {
    setBusy(true);
    setNotice(L.bv_add_sample_checking);
    try {
      const ids = await collectIds();
      if (!ids) return setNotice(L.bv_add_sample_interrupted);
      const result = await planPopulationRowsIntoSample(directoryHandle, month, ids);
      if (!result.ok) return failed(result.error);
      if (result.fresh.length === 0) return setNotice(fill(L.bv_add_sample_none, { n: ids.length }));
      setNotice("");
      setChosen([]);
      setPickError(false);
      setPlan({ fresh: result.fresh, skipped: result.alreadyInSample });
    } catch (error) {
      logError("browse:add-to-sample-plan", error);
      failed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (!plan) return;
    if (chosen.length === 0) return setPickError(true);
    const ids = plan.fresh;
    setPlan(null);
    setBusy(true);
    try {
      const result = await addPopulationRowsToSample(directoryHandle, month, ids, chosen, portRestrictions, username);
      if (!result.ok) return failed(result.error);
      recordAction(directoryHandle, username, readSession()?.role ?? "unknown", "distribution-bulk-assigned", {
        monthFolderName: month,
        details: { kind: "browse-add-to-sample", added: result.added, assigned: result.assigned, unassigned: result.unassigned, employees: chosen.join("، ") },
      });
      setNotice(
        fill(L.bv_add_sample_done, { added: result.added, assigned: result.assigned }) +
          (result.unassigned > 0 ? fill(L.bv_add_sample_done_unassigned, { unassigned: result.unassigned }) : "")
      );
      broadcastDataRefresh("manual");
    } catch (error) {
      logError("browse:add-to-sample", error);
      failed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function toggle(employee: string): void {
    setPickError(false);
    setChosen((current) => (current.includes(employee) ? current.filter((name) => name !== employee) : [...current, employee]));
  }

  return (
    <>
      <button
        type="button"
        className="bv-add-sample-btn"
        title={hasFilter ? L.bv_add_sample_title : L.bv_add_sample_need_filter}
        disabled={busy || !hasFilter}
        aria-busy={busy}
        onClick={() => void openPlan()}
      >
        {L.bv_add_sample_button}
      </button>
      {notice && <span role="status" className="bv-add-sample-notice">{notice}</span>}
      <ConfirmDialog
        open={plan !== null}
        title={fill(L.bv_add_sample_dialog_title, { n: plan?.fresh.length ?? 0 })}
        message={
          <>
            <p>{fill(L.bv_add_sample_summary, { n: plan?.fresh.length ?? 0, month, skipped: plan?.skipped ?? 0 })}</p>
            <fieldset className="bv-add-sample-employees">
              <legend>{L.bv_add_sample_pick_employees}</legend>
              {employees.length === 0 && <p>{L.bv_add_sample_no_employees}</p>}
              {employees.map((employee) => (
                <label key={employee.username}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(employee.username)}
                    onChange={() => toggle(employee.username)}
                  />
                  {employee.displayName || employee.username}
                </label>
              ))}
            </fieldset>
            {pickError && <p role="alert" className="bv-add-sample-error">{L.bv_add_sample_pick_required}</p>}
          </>
        }
        confirmLabel={L.bv_add_sample_confirm}
        onConfirm={() => void run()}
        onCancel={() => setPlan(null)}
      />
    </>
  );
}
