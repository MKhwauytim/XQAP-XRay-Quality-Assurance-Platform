import { ConfirmDialog } from "../../../../ConfirmDialog/ConfirmDialog";
import { useLabels } from "../../../../../data/labels/useLabels";
import { formatNumber } from "../../../../../utils/formatting";
import type { PopulationOverwriteAssessment } from "../../../../../data/population/populationOverwriteGuard";

/**
 * The re-process confirmation (A2). Shows what the overwrite puts at risk —
 * answers, distributed rows, and live sampled ids the new population lacks —
 * and, when the data layer would refuse the save anyway (`blocked`), explains
 * why and offers no way to continue.
 */
export function ReprocessConfirmDialog({
  open,
  assessment,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  assessment: PopulationOverwriteAssessment | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const L = useLabels();
  if (!assessment) return null;
  const counts = L.population_reprocess_impact_counts
    .replace("{answers}", formatNumber(assessment.answerCount))
    .replace("{distribution}", formatNumber(assessment.distributionCount))
    .replace("{missing}", formatNumber(assessment.missingCount));
  return (
    <ConfirmDialog
      open={open}
      danger
      hideConfirm={assessment.blocked}
      title={assessment.blocked ? L.population_reprocess_blocked_title : L.population_reprocess_confirm_title}
      cancelLabel={assessment.blocked ? L.population_reprocess_blocked_close : undefined}
      message={
        <>
          <p>{assessment.blocked ? L.population_reprocess_blocked_message : L.population_reprocess_confirm_message}</p>
          <p>{counts}</p>
          {assessment.missingExamples.length > 0 && (
            <p>{L.population_reprocess_missing_examples.replace("{ids}", assessment.missingExamples.join(L.population_reprocess_examples_separator))}</p>
          )}
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
