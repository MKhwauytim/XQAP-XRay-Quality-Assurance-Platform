import { useState } from "react";
import { AlertTriangle, ChevronRight, History } from "lucide-react";

import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import { useLabels } from "../../../../data/labels/useLabels";
import { logError } from "../../../../data/storage/errorLogger";
import {
  listPopulationRecoveryCandidates,
  restorePopulationCandidate,
  type PopulationRecoveryCandidate,
} from "../../../../data/population/populationRecovery";
import { ConfirmDialog } from "../../../ConfirmDialog/ConfirmDialog";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "error"; text: string };

/**
 * A2 admin tool: restore a previous `population.final.json` for the selected
 * month from the copies kept beside it. Admin only — it replaces the month's
 * population. Backup-snapshot candidates arrive with Workstream D.
 */
export function PopulationRecoverySection() {
  const { role, username } = usePermissions();
  const { directoryHandle } = useWorkspace();
  const { selection } = useGlobalMonth();
  const L = useLabels();
  const [isOpen, setIsOpen] = useState(false);
  const [candidates, setCandidates] = useState<PopulationRecoveryCandidate[] | null>(null);
  const [pending, setPending] = useState<PopulationRecoveryCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (role !== "admin") return null;
  const month = selection.kind === "existing" ? selection.folderName : "";

  async function scan(): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    try {
      setCandidates(await listPopulationRecoveryCandidates(directoryHandle, month));
    } catch (error) {
      logError("settings:population-recovery-scan", error);
      setCandidates([]);
    } finally {
      setBusy(false);
    }
  }

  async function restore(candidate: PopulationRecoveryCandidate): Promise<void> {
    if (!directoryHandle || !month) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await restorePopulationCandidate(directoryHandle, month, candidate.fileName, username);
      setNotice(
        result.ok
          ? { kind: "ok", text: L.population_recovery_restored.replace("{archived}", result.archivedAs ?? "—") }
          : { kind: "error", text: L.population_recovery_failed.replace("{error}", result.detail ?? result.reason) }
      );
    } catch (error) {
      logError("settings:population-recovery-restore", error);
      setNotice({ kind: "error", text: L.population_recovery_failed.replace("{error}", String(error)) });
    } finally {
      setBusy(false);
    }
    await scan();
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
          {!month && <p className="template-repair-empty">{L.population_recovery_no_month}</p>}
          <div className="template-repair-controls">
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
                  <th>{L.population_recovery_col_rows}</th>
                  <th>{L.population_recovery_col_coverage}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.fileName}>
                    <td title={candidate.fileName}>
                      {candidate.source === "bak" ? L.population_recovery_source_bak : L.population_recovery_source_superseded}
                      {candidate.processedAt ? ` — ${candidate.processedAt.slice(0, 16).replace("T", " ")}` : ""}
                    </td>
                    <td>{candidate.rowCount.toLocaleString("ar-SA-u-nu-latn")}</td>
                    <td>{`${candidate.coveredSampledIds} / ${candidate.totalSampledIds}`}</td>
                    <td>
                      <button type="button" className="ew-btn-secondary" disabled={busy} onClick={() => setPending(candidate)}>
                        {L.population_recovery_restore_btn}
                      </button>
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
        message={L.population_recovery_confirm}
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
