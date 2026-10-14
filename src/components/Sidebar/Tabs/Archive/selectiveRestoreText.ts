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
import { describeIntegrity, fillTemplate } from "../../../../data/backup/restoreMessages";

// One copy of each helper, shared with the Settings recovery tool.
export { describeIntegrity, fillTemplate };

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

/**
 * `RestoreResult.answerSnapshotRebuildFailures` (`{month}/{assigneeFolder}`) as
 * one warning line naming every affected assignee; null when there are none.
 */
export function describeSnapshotRebuildFailures(labels: Labels, failures: readonly string[] | undefined): string | null {
  if (!failures || failures.length === 0) return null;
  const list = failures
    .map((entry) => {
      const slash = entry.indexOf("/");
      const month = slash > 0 ? entry.slice(0, slash) : "";
      const assignee = slash > 0 ? entry.slice(slash + 1) : entry;
      return fillTemplate(labels.archive_restore_snapshot_rebuild_item, {
        assignee,
        month: month ? formatMonthFolderShortLabel(month) : "",
      });
    })
    .join("، ");
  return fillTemplate(labels.archive_restore_snapshot_rebuild_warning, { count: formatNumber(failures.length), list });
}
