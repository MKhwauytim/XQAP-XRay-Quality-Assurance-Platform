/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type ReactNode } from "react";

import type { SidebarTabModule } from "../tabTypes";
import { readSession } from "../../../../auth/authSession";
import {
  createFieldId,
  createTemplateId,
  deleteTemplate,
  loadTemplate,
  loadTemplateIndex,
  saveTemplate
} from "../../../../data/templates/templateStorage";
import type {
  TemplateField,
  TemplateFieldType,
  TemplateIndex,
  TemplateSchema
} from "../../../../data/templates/templateTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import "./TemplateBuilder.css";

function TemplateIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" className="sidebar-icon" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-1 1.5L18.5 9H13V3.5ZM8 13h8v1H8v-1Zm0 3h8v1H8v-1Zm0-6h3v1H8v-1Z" />
    </svg>
  );
}

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "template-builder",
  label: "بانئ النماذج",
  order: 20,
  allowedRoles: ["admin"],
  icon: <TemplateIcon />
};

const FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  text: "نص",
  number: "رقم",
  dropdown: "قائمة منسدلة",
  checkbox: "مربع اختيار",
  date: "تاريخ"
};

type EditorMode = "list" | "edit" | "create";

export default function TemplateBuilderTab() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const username = session?.username ?? "unknown";

  const [mode, setMode] = useState<EditorMode>("list");
  const [index, setIndex] = useState<TemplateIndex>({ templates: [] });
  const [activeSchema, setActiveSchema] = useState<TemplateSchema | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!directoryHandle) return;
    void loadTemplateIndex(directoryHandle).then(setIndex);
  }, [directoryHandle]);

  async function handleCreate(): Promise<void> {
    const now = new Date().toISOString();
    const newSchema: TemplateSchema = {
      templateId: createTemplateId(),
      templateName: "نموذج جديد",
      version: 1,
      createdAt: now,
      createdBy: username,
      updatedAt: now,
      updatedBy: username,
      fields: []
    };
    setActiveSchema(newSchema);
    setMode("create");
    setStatusMessage(null);
  }

  async function handleEdit(templateId: string): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    const schema = await loadTemplate(directoryHandle, templateId);
    setIsLoading(false);
    if (!schema) {
      setStatusMessage({ type: "error", text: "تعذر تحميل النموذج." });
      return;
    }
    setActiveSchema(schema);
    setMode("edit");
    setStatusMessage(null);
  }

  async function handleSave(schema: TemplateSchema): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    const now = new Date().toISOString();
    const updated: TemplateSchema = {
      ...schema,
      version: mode === "create" ? 1 : schema.version + 1,
      updatedAt: now,
      updatedBy: username
    };
    const result = await saveTemplate(directoryHandle, updated);
    if (result.ok) {
      setStatusMessage({ type: "ok", text: "تم حفظ النموذج بنجاح." });
      setIndex(await loadTemplateIndex(directoryHandle));
      setMode("list");
      setActiveSchema(null);
    } else {
      setStatusMessage({ type: "error", text: `فشل الحفظ: ${result.error}` });
    }
    setIsLoading(false);
  }

  async function handleDelete(templateId: string): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    const result = await deleteTemplate(directoryHandle, templateId);
    if (result.ok) {
      setStatusMessage({ type: "ok", text: "تم حذف النموذج." });
      setIndex(await loadTemplateIndex(directoryHandle));
    } else {
      setStatusMessage({ type: "error", text: `فشل الحذف: ${result.error}` });
    }
    setIsLoading(false);
  }

  if (!directoryHandle) {
    return (
      <section className="tb-page">
        <p className="tb-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return (
    <section className="tb-page" dir="rtl">
      <header className="tb-header">
        <div>
          <p className="tb-eyebrow">Template Builder</p>
          <h1>بانئ النماذج</h1>
          <p>أنشئ وعدّل نماذج الفحص التي يملأها الموظفون لكل عينة.</p>
        </div>
        {mode === "list" ? (
          <button
            type="button"
            className="tb-btn-primary"
            onClick={() => { void handleCreate(); }}
          >
            + نموذج جديد
          </button>
        ) : (
          <button
            type="button"
            className="tb-btn-secondary"
            onClick={() => { setMode("list"); setActiveSchema(null); setStatusMessage(null); }}
          >
            رجوع للقائمة
          </button>
        )}
      </header>

      {statusMessage ? (
        <div
          className={statusMessage.type === "ok" ? "tb-msg-ok" : "tb-msg-error"}
          role="status"
        >
          {statusMessage.text}
        </div>
      ) : null}

      {isLoading ? (
        <div className="tb-loading">جاري التحميل...</div>
      ) : null}

      {mode === "list" ? (
        <TemplateList
          index={index}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ) : activeSchema ? (
        <TemplateEditor
          schema={activeSchema}
          onSchemaChange={setActiveSchema}
          onSave={handleSave}
          isSaving={isLoading}
        />
      ) : null}
    </section>
  );
}

function TemplateList({
  index,
  onEdit,
  onDelete
}: {
  index: TemplateIndex;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (index.templates.length === 0) {
    return (
      <div className="tb-empty">
        لا توجد نماذج بعد. أنشئ نموذجاً جديداً للبدء.
      </div>
    );
  }

  return (
    <div className="tb-list">
      {index.templates.map((t) => (
        <article key={t.templateId} className="tb-card">
          <div className="tb-card-info">
            <h3>{t.templateName}</h3>
            <p>
              الإصدار {t.version} —{" "}
              {new Date(t.updatedAt).toLocaleDateString("ar-SA")}
            </p>
          </div>
          <div className="tb-card-actions">
            <button
              type="button"
              className="tb-btn-secondary"
              onClick={() => onEdit(t.templateId)}
            >
              تعديل
            </button>
            <button
              type="button"
              className="tb-btn-danger"
              onClick={() => onDelete(t.templateId)}
            >
              حذف
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TemplateEditor({
  schema,
  onSchemaChange,
  onSave,
  isSaving
}: {
  schema: TemplateSchema;
  onSchemaChange: (s: TemplateSchema) => void;
  onSave: (s: TemplateSchema) => void;
  isSaving: boolean;
}) {
  function updateField(index: number, updated: TemplateField): void {
    const fields = [...schema.fields];
    fields[index] = updated;
    onSchemaChange({ ...schema, fields });
  }

  function addField(): void {
    const newField: TemplateField = {
      fieldId: createFieldId(),
      label: "حقل جديد",
      type: "text",
      required: false,
      options: []
    };
    onSchemaChange({ ...schema, fields: [...schema.fields, newField] });
  }

  function removeField(index: number): void {
    const fields = [...schema.fields];
    fields.splice(index, 1);
    onSchemaChange({ ...schema, fields });
  }

  function moveField(index: number, direction: "up" | "down"): void {
    const fields = [...schema.fields];
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target]!, fields[index]!];
    onSchemaChange({ ...schema, fields });
  }

  return (
    <div className="tb-editor">
      <div className="tb-editor-header">
        <label className="tb-label" htmlFor="tmpl-name">
          اسم النموذج
          <input
            id="tmpl-name"
            type="text"
            className="tb-input"
            value={schema.templateName}
            onChange={(e) =>
              onSchemaChange({ ...schema, templateName: e.target.value })
            }
          />
        </label>
        <p className="tb-version-note">
          الإصدار الحالي: {schema.version}
          {" — "}سيصبح {schema.version + 1} عند الحفظ
        </p>
      </div>

      <div className="tb-fields-list">
        {schema.fields.map((field, idx) => (
          <FieldEditor
            key={field.fieldId}
            field={field}
            index={idx}
            total={schema.fields.length}
            onChange={(updated) => updateField(idx, updated)}
            onRemove={() => removeField(idx)}
            onMove={(dir) => moveField(idx, dir)}
          />
        ))}
      </div>

      <div className="tb-editor-footer">
        <button
          type="button"
          className="tb-btn-secondary"
          onClick={addField}
        >
          + إضافة حقل
        </button>
        <button
          type="button"
          className="tb-btn-primary"
          disabled={isSaving || !schema.templateName.trim()}
          onClick={() => onSave(schema)}
        >
          {isSaving ? "جاري الحفظ..." : "حفظ النموذج"}
        </button>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  index,
  total,
  onChange,
  onRemove,
  onMove
}: {
  field: TemplateField;
  index: number;
  total: number;
  onChange: (f: TemplateField) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  const [optionInput, setOptionInput] = useState("");

  function addOption(): void {
    if (!optionInput.trim()) return;
    onChange({ ...field, options: [...field.options, optionInput.trim()] });
    setOptionInput("");
  }

  function removeOption(i: number): void {
    const opts = [...field.options];
    opts.splice(i, 1);
    onChange({ ...field, options: opts });
  }

  return (
    <article className="tb-field-card">
      <div className="tb-field-header">
        <span className="tb-field-index">{index + 1}</span>
        <div className="tb-field-controls">
          <button
            type="button"
            className="tb-btn-icon"
            disabled={index === 0}
            onClick={() => onMove("up")}
            aria-label="تحريك لأعلى"
          >
            ↑
          </button>
          <button
            type="button"
            className="tb-btn-icon"
            disabled={index === total - 1}
            onClick={() => onMove("down")}
            aria-label="تحريك لأسفل"
          >
            ↓
          </button>
          <button
            type="button"
            className="tb-btn-danger-sm"
            onClick={onRemove}
            aria-label="حذف الحقل"
          >
            ×
          </button>
        </div>
      </div>

      <div className="tb-field-row">
        <label className="tb-label">
          التسمية (عربي)
          <input
            type="text"
            className="tb-input"
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
          />
        </label>

        <label className="tb-label">
          نوع الحقل
          <select
            className="tb-select"
            value={field.type}
            onChange={(e) =>
              onChange({
                ...field,
                type: e.target.value as TemplateFieldType,
                options: []
              })
            }
          >
            {(Object.keys(FIELD_TYPE_LABELS) as TemplateFieldType[]).map(
              (t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              )
            )}
          </select>
        </label>

        <label className="tb-label tb-checkbox-label">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ ...field, required: e.target.checked })}
          />
          <span>مطلوب</span>
        </label>
      </div>

      {field.type === "dropdown" ? (
        <div className="tb-options-section">
          <p className="tb-options-heading">خيارات القائمة المنسدلة:</p>
          <div className="tb-options-list">
            {field.options.map((opt, i) => (
              <div key={i} className="tb-option-item">
                <span>{opt}</span>
                <button
                  type="button"
                  className="tb-btn-danger-sm"
                  onClick={() => removeOption(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="tb-option-add">
            <input
              type="text"
              className="tb-input"
              placeholder="خيار جديد..."
              value={optionInput}
              onChange={(e) => setOptionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
            />
            <button
              type="button"
              className="tb-btn-secondary"
              onClick={addOption}
            >
              إضافة
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
