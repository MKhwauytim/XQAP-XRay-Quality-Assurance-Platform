import { useState } from "react";
import { AlertTriangle, ChevronRight, Wrench } from "lucide-react";

import {
  inspectAllTemplateFiles,
  recoverTemplateFile,
  type TemplateFileReport,
} from "../../../../data/templates/templateFileRecovery";
import { logError } from "../../../../data/storage/errorLogger";
import { useLabels } from "../../../../data/labels/useLabels";
import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./TemplateRepairSection.css";

type Notice = { kind: "ok" | "error" | "info"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template
  );
}

/**
 * Admin repair surface for a template file that reads fine through the
 * `.bak`/`.tmp` fallback but whose LIVE copy is damaged — the condition that
 * makes `App.tsx`'s "تعذّرت قراءة النسخة الأصلية ... وسيتكرر هذا التنبيه حتى
 * تُعاد كتابتها" banner recur on every read of that file, forever, because
 * nothing before this rewrote the live file (see `templateFileRecovery.ts`).
 *
 * Gated on `canMutate("view-error-log")`, same as `DecisionRepairSection`:
 * the "settings" tab admits the guest role for read-only viewing, and this
 * displaces files on the shared folder.
 */
export function TemplateRepairSection() {
  const { can, canMutate } = usePermissions();
  const canView = can("view-error-log");
  const canRepair = canMutate("view-error-log");
  const { directoryHandle } = useWorkspace();
  const L = useLabels();

  const [isOpen, setIsOpen] = useState(false);
  const [reports, setReports] = useState<TemplateFileReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const damaged = reports?.filter((report) => report.needsRepair) ?? [];

  if (!canView) return null;

  async function scan(options?: { keepNotice?: boolean }): Promise<void> {
    if (!directoryHandle) return;
    setBusy(true);
    if (!options?.keepNotice) setNotice(null);
    try {
      const found = await inspectAllTemplateFiles(directoryHandle);
      setReports(found);
    } catch (error) {
      logError("settings:template-repair-scan", error);
      setReports(null);
      setNotice({
        kind: "error",
        text: fill(L.template_repair_scan_failed, {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function repair(report: TemplateFileReport): Promise<void> {
    if (!directoryHandle || !canRepair) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await recoverTemplateFile(directoryHandle, report.templateId);
      if (outcome.kind === "restored") {
        setNotice({
          kind: "ok",
          text: fill(L.template_repair_restored, {
            source: outcome.from,
            archived: outcome.archivedAs,
          }),
        });
      } else if (outcome.kind === "unrecoverable") {
        setNotice({ kind: "info", text: L.template_repair_unrecoverable });
      } else if (outcome.kind === "unavailable") {
        setNotice({ kind: "error", text: L.template_repair_unavailable });
      } else if (outcome.kind === "unsupported") {
        setNotice({ kind: "error", text: L.template_repair_unsupported });
      } else if (outcome.kind === "failed") {
        setNotice({ kind: "error", text: fill(L.template_repair_failed, { error: outcome.error }) });
      }
      await scan({ keepNotice: true });
    } catch (error) {
      logError("settings:template-repair", error);
      setNotice({
        kind: "error",
        text: fill(L.template_repair_failed, {
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  function stateText(report: TemplateFileReport): string {
    if (report.live.kind === "unavailable") return L.template_repair_state_unavailable;
    if (report.needsRepair) return L.template_repair_state_covered;
    if (report.live.kind === "absent") return L.template_repair_state_absent;
    return fill(L.template_repair_state_ok, {
      name: report.live.kind === "readable" ? report.live.templateName : "",
      count: report.live.kind === "readable" ? report.live.fieldCount : 0,
    });
  }

  return (
    <section className="template-repair-section" dir="rtl">
      <button
        type="button"
        className="template-repair-header"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <ChevronRight size={16} className={isOpen ? "template-repair-chevron-open" : ""} />
        <Wrench size={16} />
        <span>{L.template_repair_title}</span>
        {damaged.length > 0 && <span className="template-repair-badge">{damaged.length}</span>}
      </button>

      {isOpen && (
        <div className="template-repair-body">
          <p className="template-repair-hint">{L.template_repair_hint}</p>

          <div className="template-repair-controls">
            <button
              type="button"
              className="ew-btn-secondary"
              onClick={() => void scan()}
              disabled={busy || !directoryHandle}
            >
              {busy ? L.template_repair_scanning : L.template_repair_scan_btn}
            </button>
          </div>

          {notice && (
            <p className={`template-repair-notice template-repair-notice-${notice.kind}`} role="status">
              {notice.kind === "error" && <AlertTriangle size={14} />}
              {notice.text}
            </p>
          )}

          {reports !== null && reports.length === 0 && (
            <p className="template-repair-empty">{L.template_repair_none}</p>
          )}

          {reports !== null && reports.length > 0 && damaged.length === 0 && (
            <p className="template-repair-empty">{L.template_repair_all_ok}</p>
          )}

          {reports !== null && reports.length > 0 && (
            <table className="template-repair-table">
              <thead>
                <tr>
                  <th>{L.template_repair_col_template}</th>
                  <th>{L.template_repair_col_state}</th>
                  <th>{L.template_repair_col_action}</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr
                    key={report.templateId}
                    className={report.needsRepair ? "template-repair-row-damaged" : undefined}
                  >
                    <td>{report.templateId}</td>
                    <td>{stateText(report)}</td>
                    <td>
                      {report.needsRepair && canRepair && report.recoverableFrom !== null && (
                        <button
                          type="button"
                          className="ew-btn-secondary"
                          disabled={busy}
                          onClick={() => void repair(report)}
                        >
                          {L.template_repair_restore_btn}
                        </button>
                      )}
                      {report.needsRepair && report.recoverableFrom === null && (
                        <span>{L.template_repair_unrecoverable}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
