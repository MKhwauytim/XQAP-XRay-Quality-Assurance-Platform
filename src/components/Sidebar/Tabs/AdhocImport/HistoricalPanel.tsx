import { useMemo } from "react";

import type { HistoricalImportPlan } from "../../../../data/adhocImport/adhocHistoricalImport";
import { useLabels } from "../../../../data/labels/useLabels";

/**
 * Step 3 for a `kind: "historical"` import. Replaces the distribution panel
 * rather than sitting beside it: the action here is not "assign this to
 * somebody", it is "record that these people already did this work", and
 * offering both on the same screen would invite an admin to distribute a study
 * that is already finished.
 *
 * Everything shown is `planHistoricalImport`'s output, unedited:
 *
 * - `errors` are BLOCKING and disable the button. The one that matters in
 *   practice is a reviewer name the live roster cannot resolve — an answer
 *   written under a username nobody owns lands in a file no view ever opens, so
 *   it must be caught before the write, with the offending value named.
 * - `warnings` are NOT errors and are styled as notes. Partial template
 *   coverage lives here, and it is the expected state of an honest historical
 *   file: a study cannot have answered a question the template did not yet ask.
 * - per-row warnings are listed under their own heading so a single unreadable
 *   cell is attributable to its row rather than to the file.
 */

type HistoricalPanelProps = {
  /** Null when no plan can be computed at all; `unavailableReason` says why. */
  plan: HistoricalImportPlan | null;
  unavailableReason: string | null;
  busy: boolean;
  /** The import is closed — no further answers may be imported from it. */
  disabled: boolean;
  canImport: boolean;
  onImport: () => void;
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? `{${key}}`);
}

export default function HistoricalPanel({
  plan,
  unavailableReason,
  busy,
  disabled,
  canImport,
  onImport,
}: HistoricalPanelProps) {
  const L = useLabels();

  const stats = useMemo(() => {
    const entries = plan?.plan ?? [];
    const answers = entries.reduce((sum, entry) => sum + entry.answers.length, 0);
    return {
      rows: entries.length,
      reviewers: new Set(entries.map((entry) => entry.answeredBy)).size,
      answers,
      // One decimal, because "3" and "3.4" answers per row are different files
      // and the difference is exactly what a reviewer of this screen looks for.
      perRow: entries.length === 0 ? "0" : (answers / entries.length).toFixed(1),
    };
  }, [plan]);

  const rowWarnings = useMemo(
    () => (plan?.plan ?? []).filter((entry) => entry.warnings.length > 0),
    [plan]
  );

  const blocked = plan === null || plan.errors.length > 0 || stats.rows === 0;

  return (
    <section className="adhoc-hist-panel" dir="rtl">
      <h3 className="adhoc-assign-title">{L.adhoc_hist_panel_title}</h3>
      <p className="adhoc-import-scope-note">{L.adhoc_hist_panel_note}</p>

      {unavailableReason !== null && (
        <p className="adhoc-hist-unavailable" role="status">
          {unavailableReason}
        </p>
      )}

      {plan !== null && (
        <>
          <ul className="adhoc-hist-stats">
            <li>{fill(L.adhoc_hist_plan_rows, { count: String(stats.rows) })}</li>
            <li>{fill(L.adhoc_hist_plan_reviewers, { count: String(stats.reviewers) })}</li>
            <li>
              {fill(L.adhoc_hist_plan_answers, {
                answers: String(stats.answers),
                perRow: stats.perRow,
              })}
            </li>
          </ul>

          {plan.errors.length > 0 && (
            <div className="adhoc-hist-errors" role="alert">
              <span className="adhoc-assign-errors-title">
                {L.adhoc_hist_plan_errors_title}
              </span>
              <ul>
                {plan.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.warnings.length > 0 && (
            <div className="adhoc-hist-warnings" role="status">
              <span className="adhoc-assign-errors-title">
                {L.adhoc_hist_plan_warnings_title}
              </span>
              <ul>
                {plan.warnings.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {rowWarnings.length > 0 && (
            <div className="adhoc-hist-warnings" role="status">
              <span className="adhoc-assign-errors-title">
                {L.adhoc_hist_row_warnings_title}
              </span>
              <ul>
                {rowWarnings.flatMap((entry) =>
                  entry.warnings.map((warning) => (
                    <li key={`${entry.rowKey}:${warning}`}>
                      {fill(L.adhoc_hist_row_warning, { rowKey: entry.rowKey, warning })}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </>
      )}

      {canImport && (
        <button
          type="button"
          className="adhoc-assign-submit"
          disabled={blocked || busy || disabled}
          onClick={onImport}
        >
          {busy ? L.adhoc_hist_importing : L.adhoc_hist_import_button}
        </button>
      )}
    </section>
  );
}
