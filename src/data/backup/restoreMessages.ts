/**
 * Shared Arabic wording for selective-restore results, used by the Archive
 * dialog and the Settings population-recovery tool so the two never drift.
 */
import type { Labels } from "../labels/labelsStore";
import { formatMonthFolderShortLabel } from "../population/monthFolder";
import type { SelectiveRestoreDerivedWarning, SelectiveRestoreIntegrity } from "./selectiveRestore";

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);
}

export function describeDerivedWarning(labels: Labels, warning: SelectiveRestoreDerivedWarning): string {
  const steps: Record<SelectiveRestoreDerivedWarning["step"], string> = {
    manifest: labels.archive_restore_derived_step_manifest,
    "population-derived": labels.archive_restore_derived_step_population,
    "replacement-index": labels.archive_restore_derived_step_replacement_index,
    aggregate: labels.archive_restore_derived_step_aggregate,
    "distribution-cache": labels.archive_restore_derived_step_distribution,
  };
  return fill(labels.archive_restore_derived_warning, {
    step: steps[warning.step],
    month: formatMonthFolderShortLabel(warning.month),
    error: warning.error,
  });
}

/** True when the post-restore integrity scan found orphans or could not run. */
export function integrityNeedsAttention(integrity: readonly SelectiveRestoreIntegrity[]): boolean {
  return integrity.some((entry) => entry.result === null || !entry.result.clean);
}

/** A failure text that names the rollback folder when the restore had already started. */
export function describeRestoreFailure(labels: Labels, reason: string, rollbackFolderName?: string): string {
  const text = `${labels.archive_restore_failed_prefix}: ${reason}`;
  return rollbackFolderName
    ? `${text} ${fill(labels.archive_restore_failed_rollback, { rollback: rollbackFolderName })}`
    : text;
}
