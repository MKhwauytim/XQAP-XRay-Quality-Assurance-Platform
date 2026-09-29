import { useEffect, useRef, useState } from "react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { useLabels } from "../../../../data/labels/useLabels";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import {
  RESTORE_ELEMENTS,
  type RestoreElementId,
  type RestoreScope,
} from "../../../../data/backup/restoreScope";
import {
  planSelectiveRestore,
  previewSelectiveRestore,
  type RestorePreview,
  type SelectiveRestorePlan,
} from "../../../../data/backup/selectiveRestore";
import { formatNumber } from "../../../../utils/formatting";
import { describeBlock, describeSelectionCount, describeWarning, fillTemplate } from "./selectiveRestoreText";

export type SelectiveRestoreSelection = { scope: RestoreScope; plan: SelectiveRestorePlan };

type SelectiveRestorePanelProps = {
  directoryHandle: DirectoryHandleLike;
  backupFolderName: string;
  /** Called with null while nothing confirmable is selected or a plan is still being computed. */
  onSelectionChange: (selection: SelectiveRestoreSelection | null) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function SelectiveRestorePanel({
  directoryHandle,
  backupFolderName,
  onSelectionChange,
}: SelectiveRestorePanelProps) {
  const labels = useLabels();
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [elements, setElements] = useState<RestoreElementId[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [plan, setPlan] = useState<SelectiveRestorePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  // Only the LATEST plan request may commit: a slow earlier plan must never
  // overwrite the answer for the admin's newer selection.
  const planTokenRef = useRef(0);

  // A plan still in flight when the panel unmounts (mode switched back, dialog
  // closed) must never call onSelectionChange later: the parent would arm a
  // selection for a panel that no longer exists.
  useEffect(
    () => () => {
      planTokenRef.current += 1;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    previewSelectiveRestore(directoryHandle, backupFolderName).then(
      (value) => {
        if (!cancelled) setPreview(value);
      },
      (error: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [directoryHandle, backupFolderName]);

  function requestPlan(nextElements: RestoreElementId[], nextMonths: string[]): void {
    const token = ++planTokenRef.current;
    setPlan(null);
    setPlanError(null);
    onSelectionChange(null);
    if (!preview || nextElements.length === 0) {
      setIsPlanning(false);
      return;
    }
    const scope: RestoreScope = { elements: nextElements, months: nextMonths };
    setIsPlanning(true);
    planSelectiveRestore({ directoryHandle, backupFolderName, scope, preview }).then(
      (nextPlan) => {
        if (token !== planTokenRef.current) return;
        setIsPlanning(false);
        setPlan(nextPlan);
        onSelectionChange(nextPlan.canConfirm ? { scope, plan: nextPlan } : null);
      },
      (error: unknown) => {
        if (token !== planTokenRef.current) return;
        setIsPlanning(false);
        setPlanError(errorMessage(error));
      }
    );
  }

  function toggleElement(id: RestoreElementId): void {
    const next = elements.includes(id) ? elements.filter((item) => item !== id) : [...elements, id];
    setElements(next);
    requestPlan(next, months);
  }

  function toggleMonth(month: string): void {
    const next = months.includes(month) ? months.filter((item) => item !== month) : [...months, month];
    setMonths(next);
    requestPlan(elements, next);
  }

  if (previewError) {
    return (
      <div className="arc-modal-error" role="alert">
        {fillTemplate(labels.archive_restore_preview_error, { error: previewError })}
      </div>
    );
  }
  if (!preview) {
    return <p className="arc-restore-selective-status">{labels.archive_restore_preview_loading}</p>;
  }

  return (
    <div className="arc-restore-selective">
      <p className="arc-restore-selective-intro">{labels.archive_restore_selective_intro}</p>

      <fieldset className="arc-restore-fieldset">
        <legend>{labels.archive_restore_elements_heading}</legend>
        {RESTORE_ELEMENTS.map((definition) => (
          <label key={definition.id} className="arc-restore-option">
            <input
              type="checkbox"
              checked={elements.includes(definition.id)}
              onChange={() => toggleElement(definition.id)}
            />
            <span>{labels[definition.labelKey]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="arc-restore-fieldset">
        <legend>{labels.archive_restore_months_heading}</legend>
        {preview.months.length === 0 ? (
          <p className="arc-restore-selective-status">{labels.archive_restore_months_none}</p>
        ) : (
          preview.months.map((month) => (
            <label key={month} className="arc-restore-option">
              <input type="checkbox" checked={months.includes(month)} onChange={() => toggleMonth(month)} />
              <span>{formatMonthFolderShortLabel(month)}</span>
            </label>
          ))
        )}
      </fieldset>

      {preview.unclassifiedCount > 0 ? (
        <p className="arc-restore-selective-status">
          {fillTemplate(labels.archive_restore_unclassified, { count: formatNumber(preview.unclassifiedCount) })}
        </p>
      ) : null}

      <div className="arc-restore-plan" aria-live="polite">
        {elements.length === 0 || plan?.invalidReason ? (
          <p className="arc-restore-selective-status">{labels.archive_restore_select_prompt}</p>
        ) : null}
        {isPlanning ? <p className="arc-restore-selective-status">{labels.archive_restore_planning}</p> : null}
        {planError ? (
          <div className="arc-modal-error" role="alert">
            {planError}
          </div>
        ) : null}
        {plan && !plan.invalidReason ? (
          <>
            <h4>{labels.archive_restore_preview_heading}</h4>
            <ul className="arc-restore-plan-list">
              {plan.selections.map((cell) => (
                <li key={`${cell.element}:${cell.month ?? ""}`} className={cell.fileCount === 0 ? "is-missing" : undefined}>
                  {describeSelectionCount(labels, cell)}
                </li>
              ))}
            </ul>
            {plan.blocked.map((block) => (
              <div key={`blocked:${block.month}`} className="arc-restore-warning is-danger">
                <p>{describeBlock(labels, block)}</p>
              </div>
            ))}
            {plan.warnings.map((warning) => (
              <div key={`${warning.kind}:${warning.month}`} className="arc-restore-warning">
                <p>{describeWarning(labels, warning)}</p>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
