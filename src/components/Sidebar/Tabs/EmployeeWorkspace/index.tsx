/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { SidebarTabModule } from "../tabTypes";
import { readSession } from "../../../../auth/authSession";
import {
  loadEmployeeAnswers,
  upsertItemAnswer
} from "../../../../data/answers/answerStorage";
import type { FieldAnswer, ItemAnswer } from "../../../../data/answers/answerTypes";
import {
  loadDistributionCurrent
} from "../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../data/distribution/distributionTypes";
import { listMonthFolders } from "../../../../data/population/populationStorage";
import {
  loadTemplate,
  loadTemplateIndex
} from "../../../../data/templates/templateStorage";
import type {
  TemplateField,
  TemplateSchema
} from "../../../../data/templates/templateTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./EmployeeWorkspace.css";

function WorkspaceIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm-1 14H9V8h2v8Zm4 0h-2V8h2v8Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "employee-workspace",
  label: "مساحة الموظف",
  order: 15,
  allowedRoles: ["employee", "supervisor", "admin"],
  icon: <WorkspaceIcon />
};

type WorkspaceLoadState = "idle" | "loading" | "ready" | "error";

export default function EmployeeWorkspaceTab() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const username = session?.username ?? "";

  const [loadState, setLoadState] = useState<WorkspaceLoadState>("idle");
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
  const [statusMessage, setStatusMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);

  // Load available months on mount
  useEffect(() => {
    if (!directoryHandle) return;
    void listMonthFolders(directoryHandle).then((months) => {
      setAvailableMonths(months);
      if (months.length > 0) {
        setSelectedMonth(months[months.length - 1]!.folderName);
      }
    });
    void loadTemplateIndex(directoryHandle).then((idx) =>
      setTemplateIndex(idx.templates)
    );
  }, [directoryHandle]);

  const loadMonthData = useCallback(async () => {
    if (!directoryHandle || !selectedMonth) return;
    setLoadState("loading");
    setStatusMessage(null);
    try {
      const dist = await loadDistributionCurrent(directoryHandle, selectedMonth);
      const entries = (dist?.entries ?? []).filter(
        (e) => e.assignedTo === username && e.status !== "replaced"
      );
      setMyEntries(entries);

      const answers = await loadEmployeeAnswers(
        directoryHandle,
        selectedMonth,
        username
      );
      setSavedAnswers(answers.items);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [directoryHandle, selectedMonth, username]);

  useEffect(() => {
    void loadMonthData();
  }, [loadMonthData]);

  async function handleTemplateSelect(templateId: string): Promise<void> {
    if (!directoryHandle || !templateId) {
      setActiveTemplate(null);
      return;
    }
    const schema = await loadTemplate(directoryHandle, templateId);
    setActiveTemplate(schema);
    setSelectedTemplateId(templateId);
  }

  async function handleSaveAnswers(
    xrayImageId: string,
    answers: FieldAnswer[],
    submit: boolean
  ): Promise<void> {
    if (!directoryHandle || !activeTemplate) return;
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
    const result = await upsertItemAnswer(
      directoryHandle,
      selectedMonth,
      username,
      item
    );
    if (result.ok) {
      setSavedAnswers((prev) => {
        const others = prev.filter((a) => a.xrayImageId !== xrayImageId);
        return [...others, item];
      });
      setStatusMessage({
        type: "ok",
        text: submit ? "تم تقديم الإجابات." : "تم حفظ المسودة."
      });
    } else {
      setStatusMessage({ type: "error", text: result.error });
    }
  }

  if (!directoryHandle) {
    return (
      <section className="ew-page">
        <p className="ew-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return (
    <section className="ew-page" dir="rtl">
      <header className="ew-header">
        <div>
          <p className="ew-eyebrow">Employee Workspace</p>
          <h1>مساحة الموظف</h1>
          <p>استعرض الصفوف المعينة لك وأكمل نماذج الفحص.</p>
        </div>
      </header>

      {statusMessage ? (
        <div
          className={
            statusMessage.type === "ok" ? "ew-msg-ok" : "ew-msg-error"
          }
          role="status"
        >
          {statusMessage.text}
        </div>
      ) : null}

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
              <option key={m.folderName} value={m.folderName}>
                {m.folderName}
              </option>
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
          {selectedMonth
            ? "لا توجد صفوف معينة لك في هذا الشهر."
            : "اختر شهراً للبدء."}
        </div>
      ) : (
        <div className="ew-items-list">
          {myEntries.map((entry) => {
            const saved = savedAnswers.find(
              (a) => a.xrayImageId === entry.xrayImageId
            );
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

type ItemFormCardProps = {
  entry: DistributionEntry;
  template: TemplateSchema | null;
  savedAnswer: ItemAnswer | null;
  onSave: (
    xrayImageId: string,
    answers: FieldAnswer[],
    submit: boolean
  ) => void;
};

function ItemFormCard({
  entry,
  template,
  savedAnswer,
  onSave
}: ItemFormCardProps) {
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>(
    () => {
      if (!savedAnswer) return {};
      const map: Record<string, string | number | boolean> = {};
      for (const a of savedAnswer.answers) {
        if (a.value !== null) map[a.fieldId] = a.value;
      }
      return map;
    }
  );

  const isSubmitted = savedAnswer?.status === "submitted";
  const row = entry.row;

  function updateAnswer(
    fieldId: string,
    value: string | number | boolean
  ): void {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  function collectAnswers(): FieldAnswer[] {
    return template?.fields.map((f) => ({
      fieldId: f.fieldId,
      value: answers[f.fieldId] ?? null
    })) ?? [];
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
        <span
          className={`ew-status-badge ${isSubmitted ? "ew-badge-done" : "ew-badge-pending"}`}
        >
          {isSubmitted ? "مقدم" : "قيد التحرير"}
        </span>
      </div>

      {!template ? (
        <p className="ew-no-template">اختر نموذجاً من الأعلى لعرض حقول الفحص.</p>
      ) : isSubmitted ? (
        <div className="ew-submitted-view">
          {template.fields.map((field) => {
            const val = answers[field.fieldId];
            return (
              <div key={field.fieldId} className="ew-answer-row">
                <span className="ew-answer-label">{field.label}</span>
                <span className="ew-answer-value">
                  {val !== undefined ? String(val) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="ew-form-fields">
            {template.fields.map((field) => (
              <FormField
                key={field.fieldId}
                field={field}
                value={answers[field.fieldId] ?? ""}
                onChange={(v) => updateAnswer(field.fieldId, v)}
              />
            ))}
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

  return (
    <div className="ew-form-field">
      <label className="ew-field-label" htmlFor={inputId}>
        {field.label}
        {field.required ? <span className="ew-required">*</span> : null}
      </label>

      {field.type === "text" ? (
        <input
          id={inputId}
          type="text"
          className="ew-input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "number" ? (
        <input
          id={inputId}
          type="number"
          className="ew-input"
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : field.type === "date" ? (
        <input
          id={inputId}
          type="date"
          className="ew-input"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "checkbox" ? (
        <input
          id={inputId}
          type="checkbox"
          className="ew-checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : field.type === "dropdown" ? (
        <select
          id={inputId}
          className="ew-select"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">اختر...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
