/**
 * Shared Arabic wording for selective-restore results, used by the Archive
 * dialog and the Settings population-recovery tool so the two never drift.
 */
import type { Labels } from "../labels/labelsStore";
import { formatMonthFolderShortLabel } from "../population/monthFolder";
import { formatNumber } from "../../utils/formatting";
import type { SelectiveRestoreDerivedWarning, SelectiveRestoreIntegrity } from "./selectiveRestore";

/** {var}-placeholder interpolation for label templates (the ONE copy; the Archive tab re-exports it). */
export function fillTemplate(template: string, vars: Record<string, string>): string {
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
  return fillTemplate(labels.archive_restore_derived_warning, {
    step: steps[warning.step],
    month: formatMonthFolderShortLabel(warning.month),
    error: warning.error,
  });
}

/** True when the post-restore integrity scan found orphans or could not run. */
export function integrityNeedsAttention(integrity: readonly SelectiveRestoreIntegrity[]): boolean {
  return integrity.some((entry) => entry.result === null || !entry.result.clean);
}

/** Appends the "restore had started, roll back from X" note to a failure text. */
export function withRollbackNote(labels: Labels, text: string, rollbackFolderName?: string): string {
  return rollbackFolderName
    ? `${text} ${fillTemplate(labels.archive_restore_failed_rollback, { rollback: rollbackFolderName })}`
    : text;
}

/** The Archive failure text (prefix + reason), naming the rollback folder when the restore had started. */
export function describeRestoreFailure(labels: Labels, reason: string, rollbackFolderName?: string): string {
  return withRollbackNote(labels, `${labels.archive_restore_failed_prefix}: ${reason}`, rollbackFolderName);
}

export function describeIntegrity(labels: Labels, entry: SelectiveRestoreIntegrity): string {
  const month = formatMonthFolderShortLabel(entry.month);
  if (!entry.result) return fillTemplate(labels.archive_restore_integrity_failed, { month, error: entry.error ?? "" });
  if (entry.result.clean) return fillTemplate(labels.archive_restore_integrity_clean, { month });
  const { answersOrphans, approvalsOrphans, sampleOrphans, distributionOrphans } = entry.result;
  const count = answersOrphans.length + approvalsOrphans.length + sampleOrphans.length + distributionOrphans.length;
  return fillTemplate(labels.archive_restore_integrity_orphans, { month, count: formatNumber(count) });
}
