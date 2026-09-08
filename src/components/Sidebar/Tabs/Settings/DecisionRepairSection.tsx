import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, Wrench } from "lucide-react";

import {
  inspectMonthDecisionFiles,
  recoverDecisionFile,
  type DecisionFileReport,
} from "../../../../data/approvals/decisionFileRecovery";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import { logError } from "../../../../data/storage/errorLogger";
import { useLabels } from "../../../../data/labels/useLabels";
import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./DecisionRepairSection.css";

type Notice = { kind: "ok" | "error" | "info"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
}

/**
 * Admin repair surface for a supervisor decision file that exists but cannot be
 * read — the condition that left one production workspace unable to record any
 * approval decision for over a week with no way out of it (see
 * `decisionFileRecovery.ts`).
 *
 * Gated on `canMutate("view-error-log")` for the same reason StorageSection is:
 * the "settings" tab admits the guest role for read-only viewing, and this
 * displaces files on the shared folder. Reusing that capability id rather than
 * adding a permission-matrix row keeps it admin-only by default and consistent
 * with the two sibling destructive actions in this same tab.
 */
export function DecisionRepairSection() {
  const { can, canMutate } = usePermissions();
  const canView = can("view-error-log");
  const canRepair = canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();

  const [isOpen, setIsOpen] = useState(false);
  // Deliberately NOT `useGlobalMonth()`. Two reasons, and the second is the one
  // that matters: a damaged decision file is very often in a month the admin is
  // not currently looking at, so binding this to the app-wide selection would
  // hide it; and `useGlobalMonth` throws outside `GlobalMonthProvider`, which
  // would make the whole Settings tab depend on a provider none of its other
  // sections need (it took the tab's own test suite down when tried).
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [month, setMonth] = useState<string>("");
  const [reports, setReports] = useState<DecisionFileReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetTarget, setResetTarget] = useState<DecisionFileReport | null>(null);

  const damaged = reports?.filter((report) => report.needsRepair) ?? [];

  /**
   * `keepNotice` exists because a repair re-scans afterwards to refresh the
   * table, and the plain scan clears the notice — which silently threw away the
   * one message telling the admin what the repair actually did (how many
   * decisions came back, and under what name the damaged original was kept).
   */
  useEffect(() => {
    if (!isOpen || !canView || !directoryHandle) return;
    let cancelled = false;
    void listMonthFolders(directoryHandle)
      .then((found) => {
        if (cancelled) return;
        setMonths(found);
        setMonth((current) => current || (found[found.length - 1]?.folderName ?? ""));
      })
      .catch((error: unknown) => logError("settings:decision-repair-months", error));
    return () => {
      cancelled = true;
    };
  }, [isOpen, canView, directoryHandle]);

  if (!canView) return null;

  async function scan(options?: { keepNotice?: boolean }): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    if (!options?.keepNotice) setNotice(null);
    try {
      const found = await inspectMonthDecisionFiles(directoryHandle, month);
      setReports(found);
    } catch (error) {
      logError("settings:decision-repair-scan", error);
      setReports(null);
      setNotice({
        kind: "error",
        text: fill(L.decision_repair_scan_failed, {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function repair(report: DecisionFileReport, allowReset: boolean): Promise<void> {
    if (!directoryHandle || !canRepair) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await recoverDecisionFile(
        directoryHandle,
        report.monthFolderName,
        report.supervisorUsername,
        { allowReset }
      );
      if (outcome.kind === "restored") {
        setNotice({
          kind: "ok",
          text: fill(L.decision_repair_restored, {
            count: outcome.decisionEvents,
            source: outcome.from,
            archived: outcome.archivedAs,
          }),
        });
      } else if (outcome.kind === "reset") {
        setNotice({
          kind: "ok",
          text: fill(L.decision_repair_reset_done, { archived: outcome.archivedAs }),
        });
      } else if (outcome.kind === "unrecoverable") {
        setNotice({ kind: "info", text: L.decision_repair_unrecoverable });
      } else if (outcome.kind === "unavailable") {
        setNotice({ kind: "error", text: L.decision_repair_unavailable });
      } else if (outcome.kind === "unsupported") {
        setNotice({ kind: "error", text: L.decision_repair_unsupported });
      } else if (outcome.kind === "failed") {
        setNotice({ kind: "error", text: fill(L.decision_repair_failed, { error: outcome.error }) });
      }
      await scan({ keepNotice: true });
    } catch (error) {
      logError("settings:decision-repair", error);
      setNotice({
        kind: "error",
        text: fill(L.decision_repair_failed, {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  function stateText(report: DecisionFileReport): string {
    if (report.live.kind === "unavailable") return L.decision_repair_state_unavailable;
    if (report.blocked) return L.decision_repair_state_blocked;
    if (report.needsRepair) return L.decision_repair_state_covered;
    if (report.live.kind === "absent") return L.decision_repair_state_absent;
    return fill(L.decision_repair_state_ok, {
      count: report.live.kind === "readable" ? report.live.decisionEvents : 0,
    });
  }

  return (
    <section className="decision-repair-section" dir="rtl">
      <button
        type="button"
        className="decision-repair-header"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <ChevronRight size={16} className={isOpen ? "decision-repair-chevron-open" : ""} />
        <Wrench size={16} />
        <span>{L.decision_repair_title}</span>
        {damaged.length > 0 && (
          <span className="decision-repair-badge">{damaged.length}</span>
        )}
      </button>

      {isOpen && (
        <div className="decision-repair-body">
          <p className="decision-repair-hint">{L.decision_repair_hint}</p>

          <div className="decision-repair-controls">
            <label htmlFor="decision-repair-month">{L.decision_repair_month_label}</label>
            <select
              id="decision-repair-month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setReports(null);
                setNotice(null);
              }}
            >
              {months.map((info) => (
                <option key={info.folderName} value={info.folderName}>
                  {info.folderName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ew-btn-secondary"
              onClick={() => void scan()}
              disabled={busy || !directoryHandle || !month}
            >
              {busy ? L.decision_repair_scanning : L.decision_repair_scan_btn}
            </button>
          </div>

          {notice && (
            <p
              className={`decision-repair-notice decision-repair-notice-${notice.kind}`}
              role="status"
            >
              {notice.kind === "error" && <AlertTriangle size={14} />}
              {notice.text}
            </p>
          )}

          {reports !== null && reports.length === 0 && (
            <p className="decision-repair-empty">{L.decision_repair_none}</p>
          )}

          {reports !== null && reports.length > 0 && damaged.length === 0 && (
            <p className="decision-repair-empty">{L.decision_repair_all_ok}</p>
          )}

          {reports !== null && reports.length > 0 && (
            <table className="decision-repair-table">
              <thead>
                <tr>
                  <th>{L.decision_repair_col_supervisor}</th>
                  <th>{L.decision_repair_col_state}</th>
                  <th>{L.decision_repair_col_action}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr
                    key={report.supervisorUsername}
                    className={report.blocked ? "decision-repair-row-blocked" : undefined}
                  >
                    <td>{report.supervisorUsername}</td>
                    <td>
                      {stateText(report)}
                      {report.chainBreakAt !== null && (
                        <span className="decision-repair-chain-break">
                          {fill(L.decision_repair_chain_break, { index: report.chainBreakAt })}
                        </span>
                      )}
                    </td>
                    <td>
                      {report.needsRepair && canRepair && report.recoverableFrom !== null && (
                        <button
                          type="button"
                          className="ew-btn-secondary"
                          disabled={busy}
                          onClick={() => void repair(report, false)}
                        >
                          {L.decision_repair_restore_btn}
                        </button>
                      )}
                      {report.needsRepair && canRepair && report.recoverableFrom === null && (
                        <button
                          type="button"
                          className="ew-btn-secondary decision-repair-danger"
                          disabled={busy}
                          onClick={() => setResetTarget(report)}
                        >
                          {L.decision_repair_reset_btn}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {resetTarget && (
        <ConfirmDialog
          open
          danger
          title={L.decision_repair_reset_confirm_title}
          message={L.decision_repair_reset_confirm_body}
          confirmLabel={L.decision_repair_reset_btn}
          onConfirm={() => {
            const target = resetTarget;
            setResetTarget(null);
            void repair(target, true);
          }}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </section>
  );
}
