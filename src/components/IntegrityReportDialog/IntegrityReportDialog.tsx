import { useMemo } from "react";

import { useLabels } from "../../data/labels/useLabels";
import type { Labels } from "../../data/labels/labelsStore";
import type {
  BootIntegrityReport,
  IntegrityFinding,
  IntegrityProblem,
} from "../../data/integrity/bootIntegrityScan";
import "./IntegrityReportDialog.css";

/**
 * What the admin boot self-check found and did.
 *
 * Shown once per boot, and only when there is something to say — a healthy
 * workspace must not greet an admin with a dialog. Purely informational: the
 * repairs have already happened by the time this renders (owner decision,
 * 2026-09-09), so there is nothing to confirm and one way out.
 *
 * The two groups are kept visually distinct because they ask different things
 * of the reader: "repaired" is a record of what changed under them, and
 * "needs review" is a to-do list.
 */
export type IntegrityReportDialogProps = {
  report: BootIntegrityReport;
  onDismiss: () => void;
};

function problemLabel(problem: IntegrityProblem, labels: Labels): string {
  if (problem === "damaged") return labels.integrity_boot_problem_damaged;
  if (problem === "orphan-sibling") return labels.integrity_boot_problem_orphan;
  return labels.integrity_boot_problem_missing;
}

export function IntegrityReportDialog({ report, onDismiss }: IntegrityReportDialogProps) {
  const labels = useLabels();

  const [repaired, attention] = useMemo(() => {
    const isRepaired = (finding: IntegrityFinding) => finding.outcome === "repaired";
    return [
      report.findings.filter(isRepaired),
      report.findings.filter((finding) => !isRepaired(finding)),
    ];
  }, [report.findings]);

  if (!report.hasFindings) return null;

  return (
    <div className="integrity-dialog-backdrop" role="presentation">
      <div
        className="integrity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integrity-dialog-title"
        dir="rtl"
      >
        <h2 id="integrity-dialog-title" className="integrity-dialog__title">
          {labels.integrity_boot_title}
        </h2>

        <p className="integrity-dialog__summary">
          {repaired.length > 0 &&
            labels.integrity_boot_summary_repaired.replace("{count}", String(repaired.length))}
          {repaired.length > 0 && attention.length > 0 && " "}
          {attention.length > 0 &&
            labels.integrity_boot_summary_attention.replace("{count}", String(attention.length))}
        </p>

        {repaired.length > 0 && (
          <section className="integrity-dialog__group">
            <h3 className="integrity-dialog__group-title">
              {labels.integrity_boot_group_repaired}
            </h3>
            <ul className="integrity-dialog__list">
              {repaired.map((finding) => (
                <li key={`${finding.location}/${finding.subject}`} className="integrity-dialog__item">
                  <span className="integrity-dialog__subject">{finding.subject}</span>
                  <span className="integrity-dialog__meta">
                    {finding.location} · {problemLabel(finding.problem, labels)}
                  </span>
                  {finding.detail && (
                    <span className="integrity-dialog__detail">{finding.detail}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* Both caveats are load-bearing: nothing was destroyed, and a file
                restored from a snapshot may be missing its most recent edit. */}
            <p className="integrity-dialog__note">{labels.integrity_boot_archive_note}</p>
            <p className="integrity-dialog__note">{labels.integrity_boot_restore_note}</p>
          </section>
        )}

        {attention.length > 0 && (
          <section className="integrity-dialog__group integrity-dialog__group--attention">
            <h3 className="integrity-dialog__group-title">
              {labels.integrity_boot_group_attention}
            </h3>
            <ul className="integrity-dialog__list">
              {attention.map((finding) => (
                <li key={`${finding.location}/${finding.subject}`} className="integrity-dialog__item">
                  <span className="integrity-dialog__subject">{finding.subject}</span>
                  <span className="integrity-dialog__meta">
                    {finding.location} · {problemLabel(finding.problem, labels)}
                    {finding.outcome === "could-not-check" &&
                      ` · ${labels.integrity_boot_outcome_checkfail}`}
                  </span>
                  {finding.detail && (
                    <span className="integrity-dialog__detail">{finding.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="integrity-dialog__actions">
          <button type="button" className="integrity-dialog__dismiss" onClick={onDismiss}>
            {labels.integrity_boot_dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
