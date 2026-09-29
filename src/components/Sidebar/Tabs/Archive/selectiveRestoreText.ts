import type { Labels } from "../../../../data/labels/labelsStore";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import {
  RESTORE_ELEMENTS,
  type RestoreElementId,
  type RestoreScopeCell,
} from "../../../../data/backup/restoreScope";
import type {
  SelectiveRestoreBlock,
  SelectiveRestoreIntegrity,
  SelectiveRestoreWarning,
} from "../../../../data/backup/selectiveRestore";
import { formatNumber } from "../../../../utils/formatting";

/** {var}-placeholder interpolation for label templates (the Archive tab's one copy). */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? `{${key}}`);
}

export function restoreElementLabel(labels: Labels, element: RestoreElementId): string {
  const definition = RESTORE_ELEMENTS.find((item) => item.id === element);
  return definition ? labels[definition.labelKey] : element;
}

export function describeSelectionCount(
  labels: Labels,
  cell: RestoreScopeCell & { fileCount: number }
): string {
  const vars = {
    element: restoreElementLabel(labels, cell.element),
    month: cell.month ? formatMonthFolderShortLabel(cell.month) : "",
    count: formatNumber(cell.fileCount),
  };
  if (cell.fileCount === 0) {
    return fillTemplate(cell.month ? labels.archive_restore_not_present : labels.archive_restore_not_present_workspace, vars);
  }
  return fillTemplate(cell.month ? labels.archive_restore_preview_row : labels.archive_restore_preview_row_workspace, vars);
}

export function describeBlock(labels: Labels, block: SelectiveRestoreBlock): string {
  return fillTemplate(labels.archive_restore_blocked_population, {
    month: formatMonthFolderShortLabel(block.month),
    missing: formatNumber(block.missingCount),
    sampled: formatNumber(block.sampledCount),
    examples: block.missingExamples.join("، "),
  });
}

export function describeWarning(labels: Labels, warning: SelectiveRestoreWarning): string {
  const templates: Record<SelectiveRestoreWarning["kind"], string> = {
    "sample-without-answers": labels.archive_restore_warning_sample_without_answers,
    "answers-without-sample": labels.archive_restore_warning_answers_without_sample,
    "answers-restore-embedded-requests": labels.archive_restore_warning_answers_embed_requests,
    "requests-embedded-in-answers": labels.archive_restore_warning_requests_embedded,
  };
  return fillTemplate(templates[warning.kind], { month: formatMonthFolderShortLabel(warning.month) });
}

export function describeIntegrity(labels: Labels, entry: SelectiveRestoreIntegrity): string {
  const month = formatMonthFolderShortLabel(entry.month);
  if (!entry.result) return fillTemplate(labels.archive_restore_integrity_failed, { month, error: entry.error ?? "" });
  if (entry.result.clean) return fillTemplate(labels.archive_restore_integrity_clean, { month });
  const { answersOrphans, approvalsOrphans, sampleOrphans, distributionOrphans } = entry.result;
  const count = answersOrphans.length + approvalsOrphans.length + sampleOrphans.length + distributionOrphans.length;
  return fillTemplate(labels.archive_restore_integrity_orphans, { month, count: formatNumber(count) });
}

export function describeSelectiveRestoreSuccess(
  labels: Labels,
  params: { folderName: string; restoredCount: number; rollbackFolderName: string; integrity: SelectiveRestoreIntegrity[] }
): string {
  const head = fillTemplate(labels.archive_restore_selective_done, {
    folder: params.folderName,
    count: formatNumber(params.restoredCount),
    rollback: params.rollbackFolderName,
  });
  return [head, ...params.integrity.map((entry) => describeIntegrity(labels, entry))].join(" ");
}
