import type { TemplatePhase } from "../../data/templates/templateTypes";

type Props = {
  phases: TemplatePhase[];
  activePhaseId: string;
  completedPhaseIds: Set<string>;
  enabledPhaseIds: Set<string>;
  onSelect: (phaseId: string) => void;
};

export function PhaseStepper({
  phases,
  activePhaseId,
  completedPhaseIds,
  enabledPhaseIds,
  onSelect,
}: Props) {
  return (
    <div className="ip-stepper" dir="rtl" role="tablist" aria-label="مراحل النموذج">
      {phases.map((phase, i) => {
        const isActive = phase.phaseId === activePhaseId;
        const isDone   = completedPhaseIds.has(phase.phaseId);
        const isEnabled = enabledPhaseIds.has(phase.phaseId);
        return (
          <button
            key={phase.phaseId}
            role="tab"
            aria-selected={isActive}
            aria-disabled={!isEnabled}
            disabled={!isEnabled}
            className={`ip-step${isActive ? " ip-step--active" : ""}${isDone ? " ip-step--done" : ""}${!isEnabled ? " ip-step--locked" : ""}`}
            onClick={() => {
              if (isEnabled) onSelect(phase.phaseId);
            }}
            title={phase.title}
          >
            <span className="ip-step-num" aria-hidden="true">
              {isDone ? "✓" : i + 1}
            </span>
            <span className="ip-step-text">
              <span className="ip-step-label">المرحلة {i + 1}</span>
              <span className="ip-step-title">{phase.title}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
