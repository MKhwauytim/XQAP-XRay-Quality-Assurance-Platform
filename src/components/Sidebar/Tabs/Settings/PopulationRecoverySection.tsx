import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight, History } from "lucide-react";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import type { MonthFolderInfo } from "../../../../data/population/monthFolder";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import {
  listPopulationRecoveryCandidates,
  restorePopulationCandidate,
  type PopulationRecoveryCandidate,
  type PopulationRestoreResult,
} from "../../../../data/population/populationRecovery";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import {
  listBackupPopulationCandidates,
  restorePopulationMonthFromBackup,
} from "../../../../data/backup/selectiveRestore";
import { broadcastDataRefresh } from "../../../../data/workspace/dataRefreshSignal";
import { formatDateTime, formatNumber } from "../../../../utils/formatting";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "info" | "error"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

const missingOf = (candidate: PopulationRecoveryCandidate): number =>
  Math.max(0, candidate.totalSampledIds - candidate.coveredSampledIds);

/**
 * A2 admin tool: restore a previous `population.final.json` for a chosen month
 * from the copies kept beside it. It replaces the month's population, so it is
 * gated like its Settings siblings: `can("view-error-log")` to see it,
 * `canMutate("view-error-log")` to restore (checked at render AND in the
 * handler; the settings tab admits the read-only guest role). Never automatic:
 * scanning and restoring are each an explicit press, and a restore needs a
 * confirmation that states the sample coverage. The engine re-applies the
 * orphan rule under the month lock, so a stale list cannot bypass it.
 */
export function PopulationRecoverySection() {
  const { can, canMutate, username } = usePermissions();
  const canView = can("view-error-log");
  const canRestore = canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  // Deliberately not the app-wide month selection: a lost population is often in
  // a month the admin is not looking at, and useGlobalMonth throws outside its
  // provider (the same reasoning DecisionRepairSection documents).
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [monthsState, setMonthsState] = useState<"loading" | "ready" | "error">("loading");
  const [month, setMonth] = useState("");
  const [candidates, setCandidates] = useState<PopulationRecoveryCandidate[] | null>(null);
  const [pending, setPending] = useState<PopulationRecoveryCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!isOpen || !canView || !directoryHandle) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state each time the list is (re)read
    setMonthsState("loading");
    void listMonthFolders(directoryHandle)
      .then((found) => {
        if (cancelled) return;
        setMonths(found);
        setMonthsState("ready");
        setMonth((current) => current || (found[found.length - 1]?.folderName ?? ""));
      })
      .catch((error: unknown) => {
        logError("settings:population-recovery-months", error);
        if (cancelled) return;
        setMonthsState("error");
        setNotice({
          kind: "error",
          text: fill(L.population_recovery_months_failed, { error: error instanceof Error ? error.message : String(error) }),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, canView, directoryHandle, L.population_recovery_months_failed]);

  if (!canView) return null;

  async function scan(options?: { keepNotice?: boolean }): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    if (!options?.keepNotice) setNotice(null);
    try {
      // Local copies (A2) first, then backup snapshots (Workstream D), newest first within each.
      const [local, backups] = await Promise.all([
        listPopulationRecoveryCandidates(directoryHandle, month),
        listBackupPopulationCandidates(directoryHandle, month),
      ]);
      setCandidates([...local, ...backups]);
    } catch (error) {
      logError("settings:population-recovery-scan", error);
      setCandidates(null);
      setNotice({
        kind: "error",
        text: fill(L.population_recovery_scan_failed, { error: error instanceof Error ? error.message : String(error) }),
      });
    } finally {
      setBusy(false);
    }
  }

  function describe(result: PopulationRestoreResult): Notice {
    if (result.ok) {
      const restored = fill(L.population_recovery_restored, { archived: result.archivedAs ?? "—" });
      // Success with a warning: the population is back, a follow-up step is not.
      return result.warnings?.includes("manifest-sync-failed")
        ? { kind: "info", text: `${restored} ${L.population_recovery_warning_manifest}` }
        : { kind: "ok", text: restored };
    }
    if (result.reason === "blocked") {
      return { kind: "error", text: fill(L.population_recovery_blocked_refused, { missing: result.missingCount }) };
    }
    return { kind: "error", text: fill(L.population_recovery_failed, { error: result.detail ?? result.reason }) };
  }

  /** A backup snapshot goes through D's scoped engine, never through restorePopulationCandidate. */
  async function restoreFromBackup(
    handle: DirectoryHandleLike,
    monthFolderName: string,
    backupFolderName: string
  ): Promise<Notice> {
    const outcome = await restorePopulationMonthFromBackup({
      directoryHandle: handle,
      backupFolderName,
      month: monthFolderName,
      username,
    });
    if (outcome.ok) {
      // A backup restore bypasses every normal write path — same signal the Archive restore sends.
      broadcastDataRefresh("manual");
      return {
        kind: "ok",
        text: L.population_recovery_backup_restored
          .replace("{folder}", backupFolderName)
          .replace("{rollback}", outcome.rollbackFolderName),
      };
    }
    if (outcome.reason === "plan-rejected" && outcome.plan.blocked.length > 0) {
      return {
        kind: "error",
        text: L.population_recovery_backup_blocked.replace("{missing}", String(outcome.plan.blocked[0].missingCount)),
      };
    }
    const detail = outcome.reason === "restore-failed" ? outcome.error : L.archive_restore_plan_rejected;
    return { kind: "error", text: L.population_recovery_failed.replace("{error}", detail) };
  }
  async function restore(candidate: PopulationRecoveryCandidate): Promise<void> {
    if (!directoryHandle || !month || !canRestore) return;
    setBusy(true);
    setNotice(null);
    try {
      setNotice(
        candidate.source === "backup"
          ? await restoreFromBackup(directoryHandle, month, candidate.fileName)
          : describe(await restorePopulationCandidate(directoryHandle, month, candidate.fileName, username))
      );
    } catch (error) {
      logError("settings:population-recovery-restore", error);
      setNotice({ kind: "error", text: fill(L.population_recovery_failed, { error: String(error) }) });
    } finally {
      setBusy(false);
    }
    await scan({ keepNotice: true });
  }

  return (
    <section className="template-repair-section" dir="rtl">
      <button type="button" className="template-repair-header" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <History size={16} />
        <span>{L.population_recovery_title}</span>
      </button>
      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.population_recovery_hint}</p>
          {monthsState === "loading" && <p className="template-repair-empty">{L.population_recovery_months_loading}</p>}
          {monthsState === "ready" && months.length === 0 && <p className="template-repair-empty">{L.population_recovery_no_month}</p>}
          <div className="template-repair-controls">
            <label htmlFor="population-recovery-month">{L.population_recovery_month_label}</label>
            <select
              id="population-recovery-month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setCandidates(null);
                setNotice(null);
              }}
            >
              {months.map((info) => (
                <option key={info.folderName} value={info.folderName}>
                  {info.folderName}
                </option>
              ))}
            </select>
            <button type="button" className="ew-btn-secondary" onClick={() => void scan()} disabled={busy || !directoryHandle || !month}>
              {L.population_recovery_scan_btn}
            </button>
          </div>
          {notice && (
            <p className={`template-repair-notice template-repair-notice-${notice.kind}`} role="status">
              {notice.kind === "error" && <AlertTriangle size={14} />}
              {notice.text}
            </p>
          )}
          {candidates !== null && candidates.length === 0 && <p className="template-repair-empty">{L.population_recovery_none}</p>}
          {candidates !== null && candidates.length > 0 && (
            <table className="template-repair-table">
              <thead>
                <tr>
                  <th>{L.population_recovery_col_file}</th>
                  <th>{L.population_recovery_col_processed_at}</th>
                  <th>{L.population_recovery_col_rows}</th>
                  <th>{L.population_recovery_col_coverage}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={`${candidate.source}:${candidate.fileName}`} className={candidate.wouldBlock ? "template-repair-row-damaged" : undefined}>
                    <td title={candidate.fileName}>
                      {candidate.source === "backup"
                        ? `${L.population_recovery_source_backup} ${candidate.fileName}`
                        : candidate.source === "bak"
                          ? L.population_recovery_source_bak
                          : L.population_recovery_source_superseded}
                    </td>
                    <td>{formatDateTime(candidate.processedAt)}</td>
                    <td>{formatNumber(candidate.rowCount)}</td>
                    <td>{`${candidate.coveredSampledIds} / ${candidate.totalSampledIds}`}</td>
                    <td>
                      {candidate.wouldBlock && (
                        <span className="template-repair-hint">
                          {fill(L.population_recovery_blocked_note, { missing: missingOf(candidate) })}
                        </span>
                      )}
                      {canRestore && (
                        <button
                          type="button"
                          className="ew-btn-secondary"
                          disabled={busy || candidate.wouldBlock}
                          onClick={() => setPending(candidate)}
                        >
                          {L.population_recovery_restore_btn}
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
      <ConfirmDialog
        open={pending !== null}
        danger
        title={L.population_recovery_title}
        message={
          <>
            <p>{L.population_recovery_confirm}</p>
            {pending && (
              <p>
                {fill(L.population_recovery_confirm_coverage, {
                  covered: pending.coveredSampledIds,
                  total: pending.totalSampledIds,
                  missing: missingOf(pending),
                })}
              </p>
            )}
          </>
        }
        onConfirm={() => {
          const chosen = pending;
          setPending(null);
          if (chosen) void restore(chosen);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
