import { useCallback, useEffect, useMemo, useState } from "react";
import { readSession } from "../../../../../auth/authSession";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import {
  loadEmployeeAnswers,
  upsertItemAnswer
} from "../../../../../data/answers/answerStorage";
import type { FieldAnswer, ItemAnswer } from "../../../../../data/answers/answerTypes";
import { loadOrDeriveDistributionCurrent } from "../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../data/distribution/distributionTypes";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";
import {
  loadTemplate,
  loadTemplateIndex
} from "../../../../../data/templates/templateStorage";
import {
  getFieldsForPhase,
  getTemplatePhases,
  getVisibleTemplateFields,
  isFieldVisible
} from "../../../../../data/templates/templateRuntime";
import type {
  TemplateField,
  TemplateSchema
} from "../../../../../data/templates/templateTypes";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";

type LoadState = "idle" | "loading" | "ready" | "error";

type StatusMessage = { type: "ok" | "error"; text: string } | null;

type Props = { directoryHandle: DirectoryHandleLike };

export default function EmployeeDashboard({ directoryHandle }: Props) {
  const session = readSession();
  const username = session?.username ?? "";

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [availableMonths, setAvailableMonths] = useState<
    Array<{ month: number; year: number; folderName: string }>
  >([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [myEntries, setMyEntries] = useState<DistributionEntry[]>([]);
  const [templateIndex, setTemplateIndex] = useState<
    Array<{ templateId: string; templateName: string; version: number }>
  >([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [activeTemplate, setActiveTemplate] = useState<TemplateSchema | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<ItemAnswer[]>([]);
  const answerMap = useMemo(
    () => new Map(savedAnswers.map((a) => [a.xrayImageId, a])),
    [savedAnswers]
  );
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  useEffect(() => {
    void listMonthFolders(directoryHandle).then((months) => {
      setAvailableMonths(months);
      if (months.length > 0) setSelectedMonth(months[months.length - 1]!.folderName);
    });
    void loadTemplateIndex(directoryHandle).then((idx) =>
      setTemplateIndex(idx.templates)
    );
  }, [directoryHandle]);

  const loadMonthData = useCallback(async () => {
    if (!selectedMonth) return;
    setLoadState("loading");
    setStatusMessage(null);
    try {
      const [sample, answers] = await Promise.all([
        loadSampleMaster(directoryHandle, selectedMonth),
        loadEmployeeAnswers(directoryHandle, selectedMonth, username),
      ]);
      const dist = sample
        ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows)
        : null;
      const entries = (dist?.entries ?? []).filter(
        (e) => e.assignedTo === username && e.status !== "replaced"
      );
      setMyEntries(entries);
      setSavedAnswers(answers.items);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [directoryHandle, selectedMonth, username]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadMonthData(); }, [loadMonthData]);

  async function handleTemplateSelect(templateId: string): Promise<void> {
    if (!templateId) { setActiveTemplate(null); return; }
    const schema = await loadTemplate(directoryHandle, templateId);
    setActiveTemplate(schema);
    setSelectedTemplateId(templateId);
  }

  async function handleSaveAnswers(
    xrayImageId: string,
    answers: FieldAnswer[],
    submit: boolean
  ): Promise<void> {
    if (!activeTemplate) return;
    const now = new Date().toISOString();
    const item: ItemAnswer = {
      xrayImageId,
      templateId: activeTemplate.templateId,
      templateVersion: activeTemplate.version,
      answers,
      lastSavedAt: now,
      submittedAt: submit ? now : null,
      answeredBy: username,
      status: submit ? "submitted" : "draft"
    };
    const result = await upsertItemAnswer(directoryHandle, selectedMonth, username, item);
    if (result.ok) {
      setSavedAnswers((prev) => {
        const others = prev.filter((a) => a.xrayImageId !== xrayImageId);
        return [...others, item];
      });
      setStatusMessage({ type: "ok", text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة." });
    } else {
      setStatusMessage({ type: "error", text: result.error });
    }
  }

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Employee Dashboard"
        title="لوحة الموظف"
        subtitle="استعرض الصفوف المعينة لك وأكمل نماذج الفحص."
      />

      {statusMessage && (
        <div
          className={statusMessage.type === "ok" ? "ew-msg-ok" : "ew-msg-error"}
          role="status"
        >
          {statusMessage.text}
        </div>
      )}

      <div className="ew-controls">
        <label className="ew-label" htmlFor="ew-month">
          الشهر
          <select
            id="ew-month"
            className="ew-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {availableMonths.map((m) => (
              <option key={m.folderName} value={m.folderName}>{m.folderName}</option>
            ))}
          </select>
        </label>

        <label className="ew-label" htmlFor="ew-template">
          النموذج
          <select
            id="ew-template"
            className="ew-select"
            value={selectedTemplateId}
            onChange={(e) => { void handleTemplateSelect(e.target.value); }}
          >
            <option value="">اختر نموذجاً...</option>
            {templateIndex.map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.templateName} (v{t.version})
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadState === "loading" ? (
        <p className="ew-empty">جاري التحميل...</p>
      ) : loadState === "error" ? (
        <p className="ew-empty">تعذر تحميل البيانات.</p>
      ) : myEntries.length === 0 ? (
        <div className="ew-empty">
          {selectedMonth ? "لا توجد صفوف معينة لك في هذا الشهر." : "اختر شهراً للبدء."}
        </div>
      ) : (
        <div className="ew-items-list">
          {myEntries.map((entry) => {
            const saved = answerMap.get(entry.xrayImageId);
            return (
              <ItemFormCard
                key={entry.xrayImageId}
                entry={entry}
                template={activeTemplate}
                savedAnswer={saved ?? null}
                onSave={handleSaveAnswers}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── ItemFormCard ──────────────────────────────────────────────────────────────

type ItemFormCardProps = {
  entry: DistributionEntry;
  template: TemplateSchema | null;
  savedAnswer: ItemAnswer | null;
  onSave: (xrayImageId: string, answers: FieldAnswer[], submit: boolean) => void;
};

function ItemFormCard({ entry, template, savedAnswer, onSave }: ItemFormCardProps) {
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>(() => {
    if (!savedAnswer) return {};
    const map: Record<string, string | number | boolean> = {};
    for (const a of savedAnswer.answers) {
      if (a.value !== null) map[a.fieldId] = a.value;
    }
    return map;
  });

  const isSubmitted = savedAnswer?.status === "submitted";
  const row = entry.row;

  function updateAnswer(fieldId: string, value: string | number | boolean): void {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  function collectAnswers(): FieldAnswer[] {
    return template
      ? getVisibleTemplateFields(template, answers).map((field) => ({
          fieldId: field.fieldId,
          value: field.type === "empty" ? null : answers[field.fieldId] ?? null
        }))
      : [];
  }

  return (
    <article
      className={`ew-item-card ${isSubmitted ? "ew-submitted" : ""}`}
      aria-label={`صف ${row.xrayImageId}`}
    >
      <div className="ew-item-header">
        <div>
          <h3 className="ew-item-id">{row.xrayImageId}</h3>
          <p className="ew-item-meta">
            {row.portName ?? ""} — {row.certScanStatus} — {row.stage ?? ""}
          </p>
        </div>
        <span className={`ew-status-badge ${isSubmitted ? "ew-badge-done" : "ew-badge-pending"}`}>
          {isSubmitted ? "مقدم" : "قيد التحرير"}
        </span>
      </div>

      {!template ? (
        <p className="ew-no-template">اختر نموذجاً من الأعلى لعرض حقول الفحص.</p>
      ) : isSubmitted ? (
        <div className="ew-submitted-view">
          {getTemplatePhases(template).map((phase) => {
            const fields = getFieldsForPhase(template, phase.phaseId).filter((field) =>
              isFieldVisible(field, answers)
            );
            if (fields.length === 0) return null;
            return (
              <section key={phase.phaseId} className="ew-form-phase">
                <h4>{phase.title}</h4>
                {phase.description ? <p>{phase.description}</p> : null}
                {fields.map((field) => (
                  <div key={field.fieldId} className="ew-answer-row">
                    <span className="ew-answer-label">{field.label}</span>
                    <span className="ew-answer-value">{formatAnswerValue(field, answers[field.fieldId])}</span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <div className="ew-form-flow">
            {getTemplatePhases(template).map((phase) => {
              const fields = getFieldsForPhase(template, phase.phaseId).filter((field) =>
                isFieldVisible(field, answers)
              );
              if (fields.length === 0) return null;
              return (
                <section key={phase.phaseId} className="ew-form-phase">
                  <h4>{phase.title}</h4>
                  {phase.description ? <p>{phase.description}</p> : null}
                  <div className="ew-form-fields">
                    {fields.map((field) => (
                      <FormField
                        key={field.fieldId}
                        field={field}
                        value={answers[field.fieldId] ?? ""}
                        onChange={(v) => updateAnswer(field.fieldId, v)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="ew-form-actions">
            <button
              type="button"
              className="ew-btn-secondary"
              onClick={() => onSave(row.xrayImageId, collectAnswers(), false)}
            >
              حفظ مسودة
            </button>
            <button
              type="button"
              className="ew-btn-primary"
              onClick={() => onSave(row.xrayImageId, collectAnswers(), true)}
            >
              تقديم
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function formatAnswerValue(field: TemplateField, value: string | number | boolean | undefined): string {
  if (field.type === "empty") return "—";
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

// ── FormField ─────────────────────────────────────────────────────────────────

function FormField({
  field,
  value,
  onChange
}: {
  field: TemplateField;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const inputId = `field-${field.fieldId}`;

  if (field.type === "empty") {
    return (
      <div className="ew-form-field ew-form-note">
        <span className="ew-field-label">{field.label}</span>
      </div>
    );
  }

  return (
    <div className="ew-form-field">
      <label className="ew-field-label" htmlFor={inputId}>
        {field.label}
        {field.required ? <span className="ew-required">*</span> : null}
      </label>

      {field.type === "text" ? (
        <input id={inputId} type="text" className="ew-input" value={String(value)}
          onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "textarea" ? (
        <textarea id={inputId} className="ew-input ew-textarea" value={String(value)}
          onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "number" ? (
        <input id={inputId} type="number" className="ew-input" value={String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
      ) : field.type === "date" ? (
        <input id={inputId} type="date" className="ew-input" value={String(value)}
          onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "checkbox" ? (
        <input id={inputId} type="checkbox" className="ew-checkbox" checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)} />
      ) : field.type === "dropdown" ? (
        <select id={inputId} className="ew-select" value={String(value)}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">اختر...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
