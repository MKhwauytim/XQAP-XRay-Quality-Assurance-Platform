import { useMemo, useState } from "react";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { FieldAnswer, ItemAnswer } from "../../data/answers/answerTypes";
import type { TemplateField, TemplateSchema } from "../../data/templates/templateTypes";
import {
  getFieldsForPhase,
  getTemplatePhases,
  getVisibleTemplateFields,
  isFieldVisible,
} from "../../data/templates/templateRuntime";
import { PhaseStepper } from "./PhaseStepper";
import { PanelHeader } from "./PanelHeader";
import "./InspectionPanel.css";

export type PanelPosition = "right" | "bottom";

type Props = {
  entry: DistributionEntry;
  template: TemplateSchema | null;
  savedAnswer: ItemAnswer | null;
  readonly: boolean;
  panelPosition: PanelPosition;
  onTogglePosition: () => void;
  onClose: () => void;
  onSave: (ans: FieldAnswer[], submit: boolean) => Promise<void>;
  /** Omit when the current user cannot trigger replacements. */
  onReplace?: (entry: DistributionEntry) => void;
  /** Omit when the current user cannot transfer this sample to another user. */
  onReassign?: (entry: DistributionEntry) => void;
};

export default function InspectionPanel({
  entry,
  template,
  savedAnswer,
  readonly,
  panelPosition,
  onTogglePosition,
  onClose,
  onSave,
  onReplace,
  onReassign,
}: Props) {
  const [ans, setAns] = useState<Record<string, string | number | boolean>>(() => {
    if (!savedAnswer) return {};
    const m: Record<string, string | number | boolean> = {};
    for (const a of savedAnswer.answers) {
      if (a.value !== null) m[a.fieldId] = a.value;
    }
    return m;
  });
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [touchedRequiredIds, setTouchedRequiredIds] = useState<Set<string>>(new Set());

  const phases = useMemo(() => (template ? getTemplatePhases(template) : []), [template]);

  const [activePhaseId, setActivePhaseId] = useState<string>(() => phases[0]?.phaseId ?? "");

  const phaseValidation = useMemo(() => {
    const completed = new Set<string>();
    const enabled = new Set<string>();
    let previousComplete = true;
    if (!template) return { completed, enabled, firstIncompletePhaseId: null as string | null };
    let firstIncompletePhaseId: string | null = null;
    for (const phase of phases) {
      if (previousComplete) enabled.add(phase.phaseId);
      const required = getVisibleRequiredFields(template, phase.phaseId, ans);
      const missing = required.filter((field) => !isAnswerFilled(field, ans[field.fieldId]));
      const isComplete = missing.length === 0;
      if (previousComplete && isComplete) {
        completed.add(phase.phaseId);
      } else if (!firstIncompletePhaseId) {
        firstIncompletePhaseId = phase.phaseId;
      }
      previousComplete = previousComplete && isComplete;
    }
    return { completed, enabled, firstIncompletePhaseId };
  }, [template, phases, ans]);

  const completedPhaseIds = phaseValidation.completed;
  const enabledPhaseIds = phaseValidation.enabled;

  // Derives the phase ID to actually render — auto-corrects when the stored selection is invalid.
  // This avoids setState-in-effect while keeping user navigation (setActivePhaseId) working.
  const safeActivePhaseId: string = (() => {
    if (phases.length === 0) return "";
    if (phases.some((p) => p.phaseId === activePhaseId)) {
      // If the user's selection is disabled (gated by prior phase completion), redirect
      if (template && !enabledPhaseIds.has(activePhaseId)) {
        return phaseValidation.firstIncompletePhaseId ?? phases[0]!.phaseId;
      }
      return activePhaseId;
    }
    return phases[0]!.phaseId;
  })();

  const missingRequiredFields = useMemo(() => {
    if (!template) return [];
    const missing: Array<{ phaseId: string; field: TemplateField }> = [];
    const done = new Set<string>();
    for (const phase of phases) {
      for (const field of getVisibleRequiredFields(template, phase.phaseId, ans)) {
        if (!isAnswerFilled(field, ans[field.fieldId]) && !done.has(field.fieldId)) {
          missing.push({ phaseId: phase.phaseId, field });
          done.add(field.fieldId);
        }
      }
    }
    return missing;
  }, [template, phases, ans]);

  const invalidRequiredIds = useMemo(() => {
    const missingIds = new Set(missingRequiredFields.map(({ field }) => field.fieldId));
    return new Set(
      [...touchedRequiredIds].filter((fieldId) => missingIds.has(fieldId))
    );
  }, [missingRequiredFields, touchedRequiredIds]);

  const isSubmitted = entry.status === "completed" || savedAnswer?.status === "submitted";
  const activePhaseIndex = phases.findIndex((phase) => phase.phaseId === safeActivePhaseId);
  const isLastPhase = activePhaseIndex < 0 || activePhaseIndex === phases.length - 1;
  const currentPhaseMissingRequiredFields = useMemo(() => {
    if (!template || !safeActivePhaseId) return [];
    return getVisibleRequiredFields(template, safeActivePhaseId, ans)
      .filter((field) => !isAnswerFilled(field, ans[field.fieldId]));
  }, [template, safeActivePhaseId, ans]);
  const primaryActionLabel = isLastPhase ? "تقديم" : "المرحلة التالية";

  function collect(): FieldAnswer[] {
    if (!template) return [];
    return getVisibleTemplateFields(template, ans).map((field) => ({
      fieldId: field.fieldId,
      value: field.type === "empty" ? null : (ans[field.fieldId] ?? null),
    }));
  }

  function submitStudy(): void {
    if (!template) return;
    if (missingRequiredFields.length > 0) {
      const firstMissing = missingRequiredFields[0]!;
      setActivePhaseId(firstMissing.phaseId);
      setTouchedRequiredIds(new Set(missingRequiredFields.map(({ field }) => field.fieldId)));
      setValidationMsg("أكمل جميع الحقول الإلزامية قبل التقديم.");
      return;
    }
    setValidationMsg(null);
    void onSave(collect(), true);
  }

  function goToNextPhase(): void {
    if (!template) return;
    if (currentPhaseMissingRequiredFields.length > 0) {
      setTouchedRequiredIds(
        new Set(currentPhaseMissingRequiredFields.map((field) => field.fieldId))
      );
      setValidationMsg("أكمل الحقول الإلزامية في هذه المرحلة قبل الانتقال.");
      return;
    }
    const nextPhase = phases[activePhaseIndex + 1];
    if (!nextPhase) return;
    setValidationMsg(null);
    setActivePhaseId(nextPhase.phaseId);
  }

  function handlePrimaryAction(): void {
    if (isLastPhase) {
      submitStudy();
      return;
    }
    goToNextPhase();
  }

  return (
    <aside className={`ip-panel ip-panel--${panelPosition}`} dir="rtl">
      <PanelHeader
        entry={entry}
        savedAnswer={savedAnswer}
        panelPosition={panelPosition}
        onTogglePosition={onTogglePosition}
        onClose={onClose}
      />

      {template && phases.length > 1 && (
        <PhaseStepper
          phases={phases}
          activePhaseId={safeActivePhaseId}
          completedPhaseIds={completedPhaseIds}
          enabledPhaseIds={enabledPhaseIds}
          onSelect={setActivePhaseId}
        />
      )}

      <div className="ip-form-body">
        {!template ? (
          <p className="ip-no-template">اختر نموذجاً لعرض حقول الفحص.</p>
        ) : isSubmitted || readonly ? (
          <ReadOnlyView template={template} ans={ans} />
        ) : (
          <EditView
            template={template}
            ans={ans}
            activePhaseId={safeActivePhaseId}
            phases={phases}
            invalidRequiredIds={invalidRequiredIds}
            onChange={(fieldId, value) => {
              setValidationMsg(null);
              setAns((prev) => ({ ...prev, [fieldId]: value }));
            }}
          />
        )}
      </div>

      {!isSubmitted && !readonly && (
        <div className="ip-footer">
          {validationMsg && <p className="ip-validation-msg">{validationMsg}</p>}
          <div className="ip-footer-primary">
            <button
              type="button"
              className="ip-btn ip-btn--primary"
              onClick={handlePrimaryAction}
            >
              {primaryActionLabel}
            </button>
          </div>
          <div className="ip-footer-actions">
            {onReplace && (
              <button
                type="button"
                className="ip-btn ip-btn--warning"
                onClick={() => onReplace(entry)}
              >
                استبدال العينة
              </button>
            )}
            {onReassign && (
              <button
                type="button"
                className="ip-btn ip-btn--secondary"
                onClick={() => onReassign(entry)}
              >
                إسناد لموظف آخر
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Read-only view (all phases, submitted or supervisor view) ─────────────────

function ReadOnlyView({
  template,
  ans,
}: {
  template: TemplateSchema;
  ans: Record<string, string | number | boolean>;
}) {
  return (
    <div className="ip-readonly-view">
      {getTemplatePhases(template).map((phase) => {
        const fields = getFieldsForPhase(template, phase.phaseId).filter((f) =>
          isFieldVisible(f, ans, template.fields)
        );
        if (fields.length === 0) return null;
        return (
          <section key={phase.phaseId} className="ip-readonly-phase">
            <h4>{phase.title}</h4>
            {fields.map((field) => (
              <div key={field.fieldId} className="ip-answer-row">
                <span className="ip-answer-label">{field.label}</span>
                <span className="ip-answer-value">
                  {formatAnswerValue(field, ans[field.fieldId])}
                </span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ── Edit view (active phase only) ─────────────────────────────────────────────

function EditView({
  template,
  ans,
  activePhaseId,
  phases,
  invalidRequiredIds,
  onChange,
}: {
  template: TemplateSchema;
  ans: Record<string, string | number | boolean>;
  activePhaseId: string;
  phases: ReturnType<typeof getTemplatePhases>;
  invalidRequiredIds: Set<string>;
  onChange: (fieldId: string, value: string | number | boolean) => void;
}) {
  // For single-phase templates, ignore activePhaseId and show the only phase.
  const phaseId = phases.length === 1 ? (phases[0]?.phaseId ?? activePhaseId) : activePhaseId;

  const fields = useMemo(
    () =>
      getFieldsForPhase(template, phaseId).filter((f) =>
        isFieldVisible(f, ans, template.fields)
      ),
    [template, phaseId, ans]
  );

  if (fields.length === 0) {
    return (
      <p className="ip-no-template">لا توجد حقول ظاهرة في هذه المرحلة.</p>
    );
  }

  return (
    <>
      {fields.map((field) => (
        <FormField
          key={field.fieldId}
          field={field}
          value={ans[field.fieldId] ?? ""}
          invalid={invalidRequiredIds.has(field.fieldId)}
          onChange={(v) => onChange(field.fieldId, v)}
        />
      ))}
    </>
  );
}

// ── FormField ─────────────────────────────────────────────────────────────────

function FormField({
  field,
  value,
  invalid,
  onChange,
}: {
  field: TemplateField;
  value: string | number | boolean;
  invalid: boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = `ipf-${field.fieldId}`;

  if (field.type === "empty") {
    return (
      <div className="ip-field">
        <span className="ip-field-label">{field.label}</span>
      </div>
    );
  }

  return (
    <div className={`ip-field${invalid ? " ip-field--invalid" : ""}`}>
      <label className="ip-field-label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="ip-required">*</span> : null}
      </label>

      {field.type === "text" ? (
        <input
          id={id}
          type="text"
          className="ip-input"
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          className="ip-input ip-textarea"
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "number" ? (
        <input
          id={id}
          type="number"
          className="ip-input"
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      ) : field.type === "date" ? (
        <input
          id={id}
          type="date"
          className="ip-input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "checkbox" ? (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 20, height: 20, cursor: "pointer" }}
        />
      ) : field.type === "dropdown" ? (
        <select
          id={id}
          className="ip-select"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">اختر...</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : null}
      {invalid ? <span className="ip-field-error">هذا الحقل إلزامي.</span> : null}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAnswerValue(
  field: TemplateField,
  value: string | number | boolean | undefined
): string {
  if (field.type === "empty") return "—";
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

function getVisibleRequiredFields(
  template: TemplateSchema,
  phaseId: string,
  ans: Record<string, string | number | boolean>
): TemplateField[] {
  return getFieldsForPhase(template, phaseId).filter(
    (field) => field.required && isFieldVisible(field, ans, template.fields)
  );
}

function isAnswerFilled(
  field: TemplateField,
  value: string | number | boolean | undefined
): boolean {
  if (field.type === "empty") return true;
  if (field.type === "checkbox") return value === true;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}
