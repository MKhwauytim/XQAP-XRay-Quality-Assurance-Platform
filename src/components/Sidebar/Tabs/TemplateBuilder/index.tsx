import { useEffect, useMemo, useState } from "react";
import { ClipboardList, X } from "lucide-react";

import { readSession } from "../../../../auth/authSession";
import {
  createFieldId,
  createPhaseId,
  createTemplateId,
  deleteTemplate,
  loadTemplate,
  loadTemplateIndex,
  saveTemplate
} from "../../../../data/templates/templateStorage";
import type {
  TemplateField,
  TemplateFieldCondition,
  TemplateFieldConditionOperator,
  TemplateFieldType,
  TemplateIndex,
  TemplatePhase,
  TemplateSchema
} from "../../../../data/templates/templateTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { logRejection } from "../../../../data/storage/errorLogger";
import "./TemplateBuilder.css";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { EmptyState } from "../../../../components/StateViews/StateViews";

const FIELD_TYPE_LABELS: Record<TemplateFieldType, string> = {
  text: "نص",
  textarea: "نص طويل",
  number: "رقم",
  dropdown: "قائمة منسدلة",
  combobox: "نص مع اقتراحات",
  checkbox: "علامة صح",
  date: "تاريخ",
  empty: "خلية فارغة / ملاحظة"
};

const CONDITION_LABELS: Record<TemplateFieldConditionOperator, string> = {
  truthy: "له قيمة / مفعّل",
  falsy: "فارغ / غير مفعّل",
  equals: "تساوي",
  notEquals: "لا تساوي"
};

type EditorMode = "list" | "edit" | "create";
type StatusMessage = { type: "ok" | "error"; text: string } | null;

function buildDefaultInspectionTemplate(username: string): TemplateSchema {
  const now = new Date().toISOString();
  const phase1Id = createPhaseId();
  const phase2Id = createPhaseId();

  const fHasImage       = createFieldId();
  const fNoImageReason  = createFieldId();
  const fHasMarking     = createFieldId();
  const fImageQuality   = createFieldId();
  const fQualityReason  = createFieldId();
  const fQualityOther   = createFieldId();
  const fResultValidity    = createFieldId();
  const fSuspicionLevel    = createFieldId();
  const fSuspicionLocation = createFieldId();
  const fSuspectedTypes    = createFieldId();
  const fSmuggleMethod     = createFieldId();
  const fNotes             = createFieldId();

  return {
    templateId: createTemplateId(),
    templateName: "نموذج ضمان جودة الأشعة",
    version: 1,
    createdAt: now,
    createdBy: username,
    updatedAt: now,
    updatedBy: username,
    phases: [
      { phaseId: phase1Id, title: "ضمان جودة الصورة",  description: "", order: 1 },
      { phaseId: phase2Id, title: "ضمان جودة النتيجة", description: "", order: 2 },
    ],
    fields: [
      // ── Phase 1 ──────────────────────────────────────────────────────────────
      {
        fieldId: fHasImage, phaseId: phase1Id, label: "هل يوجد صورة",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "", condition: null, order: 1,
      },
      {
        fieldId: fNoImageReason, phaseId: phase1Id, label: "سبب عدم وجود الصورة",
        type: "dropdown", required: false,
        options: ["المعرف غير صحيح", "لا يوجد رقم لوحة", "لا يوجد مستند فحص الصورة", "مؤرشف لفترات سابقة"],
        placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "لا" },
        order: 2,
      },
      {
        fieldId: fHasMarking, phaseId: phase1Id, label: "هل يوجد تحديد",
        type: "dropdown", required: true,
        options: ["نعم", "لا"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 3,
      },
      {
        fieldId: fImageQuality, phaseId: phase1Id, label: "مستوى جودة الصورة",
        type: "dropdown", required: true,
        options: ["عالي", "متوسط", "منخفض"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 4,
      },
      {
        fieldId: fQualityReason, phaseId: phase1Id, label: "اسباب انخفاض جودة الصورة",
        type: "dropdown", required: false,
        options: ["الأرسالية غير كاملة", "جودة التقاط الصورة منخفضة", "يوجد تموجات في الصورة", "اخرى"],
        placeholder: "",
        condition: { sourceFieldId: fImageQuality, operator: "notEquals", value: "عالي" },
        order: 5,
      },
      {
        fieldId: fQualityOther, phaseId: phase1Id, label: "سبب انخفاض الجودة (أخرى)",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر سبب انخفاض الجودة...",
        condition: { sourceFieldId: fQualityReason, operator: "equals", value: "اخرى" },
        order: 6,
      },
      // ── Phase 2 ──────────────────────────────────────────────────────────────
      {
        fieldId: fResultValidity, phaseId: phase2Id, label: "صحة النتيجة",
        type: "dropdown", required: true,
        options: ["سليمة", "اشتباه"], placeholder: "",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 1,
      },
      {
        fieldId: fSuspicionLevel, phaseId: phase2Id, label: "تقييم الاشتباه",
        type: "dropdown", required: false,
        options: ["عالي", "متوسط", "منخفض"], placeholder: "",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 2,
      },
      {
        fieldId: fSuspicionLocation, phaseId: phase2Id, label: "موقع الاشتباه",
        type: "combobox", required: false,
        options: ["الكبينة", "الحمولة", "العجلات", "الإطارات", "الباب الخلفي", "السقف", "الأرضية", "الخزان", "الجانب الأيمن", "الجانب الأيسر"],
        placeholder: "اكتب أو اختر موقع الاشتباه...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 3,
      },
      {
        fieldId: fSuspectedTypes, phaseId: phase2Id, label: "الاصناف المشبوهة",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر الاصناف المشبوهة...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 4,
      },
      {
        fieldId: fSmuggleMethod, phaseId: phase2Id, label: "الية التهريب المحتملة",
        type: "textarea", required: false,
        options: [], placeholder: "اذكر الية التهريب المحتملة...",
        condition: { sourceFieldId: fResultValidity, operator: "equals", value: "اشتباه" },
        order: 5,
      },
      {
        fieldId: fNotes, phaseId: phase2Id, label: "الملاحظات العامة",
        type: "textarea", required: false,
        options: [], placeholder: "أي ملاحظات إضافية...",
        condition: { sourceFieldId: fHasImage, operator: "equals", value: "نعم" }, order: 6,
      },
    ],
  };
}

export default function TemplateBuilderTab() {
  const { directoryHandle } = useWorkspace();
  const session = readSession();
  const username = session?.username ?? "unknown";
  const role = session?.role ?? "employee";

  const [mode, setMode] = useState<EditorMode>("list");
  const [index, setIndex] = useState<TemplateIndex>({ templates: [] });
  const [activeSchema, setActiveSchema] = useState<TemplateSchema | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!directoryHandle) return;
    void loadTemplateIndex(directoryHandle)
      .then(setIndex)
      .catch(logRejection("templateBuilder:loadTemplateIndex"));
  }, [directoryHandle]);

  if (role !== "manager" && role !== "admin") {
    return (
      <section className="tb-page" dir="rtl">
        <div className="tb-empty">إدارة نموذج الفحص متاحة للمدير والإدارة فقط.</div>
      </section>
    );
  }

  async function handleCreate(): Promise<void> {
    const now = new Date().toISOString();
    const firstPhaseId = createPhaseId();
    const secondPhaseId = createPhaseId();
    const newSchema: TemplateSchema = {
      templateId: createTemplateId(),
      templateName: "نموذج فحص جديد",
      version: 1,
      createdAt: now,
      createdBy: username,
      updatedAt: now,
      updatedBy: username,
      phases: [
        { phaseId: firstPhaseId, title: "المرحلة الأولى", description: "", order: 1 },
        { phaseId: secondPhaseId, title: "المرحلة الثانية", description: "", order: 2 }
      ],
      fields: []
    };
    setActiveSchema(newSchema);
    setMode("create");
    setStatusMessage(null);
  }

  function handleCreateDefault(): void {
    setActiveSchema(buildDefaultInspectionTemplate(username));
    setMode("create");
    setStatusMessage(null);
  }

  async function handleEdit(templateId: string): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    try {
      const schema = await loadTemplate(directoryHandle, templateId);
      if (!schema) {
        setStatusMessage({ type: "error", text: "تعذر تحميل النموذج." });
        return;
      }
      setActiveSchema(normalizeSchema(schema));
      setMode("edit");
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: `خطأ في تحميل النموذج: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(schema: TemplateSchema): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    try {
      const now = new Date().toISOString();
      const updated: TemplateSchema = {
        ...normalizeSchema(schema),
        version: mode === "create" ? 1 : (schema.version ?? 0) + 1,
        updatedAt: now,
        updatedBy: username
      };
      const result = await saveTemplate(directoryHandle, updated);
      if (result.ok) {
        setStatusMessage({ type: "ok", text: "تم حفظ نموذج الفحص بنجاح." });
        setIndex(await loadTemplateIndex(directoryHandle));
        setMode("list");
        setActiveSchema(null);
      } else {
        setStatusMessage({ type: "error", text: `فشل الحفظ: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: `خطأ غير متوقع: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(templateId: string): Promise<void> {
    if (!directoryHandle) return;
    setIsLoading(true);
    try {
      const result = await deleteTemplate(directoryHandle, templateId);
      if (result.ok) {
        setStatusMessage({ type: "ok", text: "تم حذف النموذج." });
        setIndex(await loadTemplateIndex(directoryHandle));
      } else {
        setStatusMessage({ type: "error", text: `فشل الحذف: ${result.error}` });
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: `خطأ في الحذف: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsLoading(false);
    }
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
      <PageHeader
        eyebrow="Inspection Form"
        title="نموذج الفحص"
        subtitle="يتم تجهيز قوالب الفحص من خلال هذه القائمة."
      >
        {mode === "list" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="tb-btn-secondary"
              onClick={handleCreateDefault}
              title="يُنشئ النموذج الافتراضي لضمان جودة الأشعة جاهزاً للتعديل"
            >
              النموذج الافتراضي
            </button>
            <button
              type="button"
              className="tb-btn-primary"
              onClick={() => { void handleCreate(); }}
            >
              + نموذج جديد
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="tb-btn-secondary"
            onClick={() => {
              setMode("list");
              setActiveSchema(null);
              setStatusMessage(null);
            }}
          >
            رجوع للقائمة
          </button>
        )}
      </PageHeader>

      {statusMessage ? (
        <div className={statusMessage.type === "ok" ? "tb-msg-ok" : "tb-msg-error"} role="status">
          {statusMessage.text}
        </div>
      ) : null}

      {isLoading ? <div className="tb-loading">جاري التحميل...</div> : null}

      {mode === "list" ? (
        <TemplateList index={index} onEdit={handleEdit} onDelete={handleDelete} />
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
      <EmptyState
        icon={<ClipboardList />}
        title="لا توجد نماذج فحص بعد"
        description="أنشئ نموذجاً جديداً من زر «+ نموذج جديد» أعلى الصفحة للبدء."
      />
    );
  }

  return (
    <div className="tb-list">
      {index.templates.map((template) => (
        <article key={template.templateId} className="tb-card">
          <div className="tb-card-info">
            <h3>{template.templateName}</h3>
            <p>
              الإصدار {template.version} ·{" "}
              {new Date(template.updatedAt).toLocaleDateString("ar-SA-u-nu-latn")}
            </p>
          </div>
          <div className="tb-card-actions">
            <button type="button" className="tb-btn-secondary" onClick={() => onEdit(template.templateId)}>
              تعديل
            </button>
            <button type="button" className="tb-btn-danger" onClick={() => onDelete(template.templateId)}>
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
  onSchemaChange: (schema: TemplateSchema) => void;
  onSave: (schema: TemplateSchema) => void;
  isSaving: boolean;
}) {
  const normalized = useMemo(() => normalizeSchema(schema), [schema]);
  const allFields = normalized.fields;

  function change(next: Partial<TemplateSchema>): void {
    onSchemaChange(normalizeSchema({ ...normalized, ...next }));
  }

  function addPhase(): void {
    const nextOrder = normalized.phases.length + 1;
    const phase: TemplatePhase = {
      phaseId: createPhaseId(),
      title: `مرحلة ${nextOrder}`,
      description: "",
      order: nextOrder
    };
    change({ phases: [...normalized.phases, phase] });
  }

  function updatePhase(phaseId: string, updated: Partial<TemplatePhase>): void {
    change({
      phases: normalized.phases.map((phase) =>
        phase.phaseId === phaseId ? { ...phase, ...updated } : phase
      )
    });
  }

  function removePhase(phaseId: string): void {
    if (normalized.phases.length <= 1) return;
    const targetPhaseId = normalized.phases.find((phase) => phase.phaseId !== phaseId)?.phaseId;
    if (!targetPhaseId) return;
    change({
      phases: normalized.phases.filter((phase) => phase.phaseId !== phaseId),
      fields: normalized.fields.map((field) =>
        field.phaseId === phaseId ? { ...field, phaseId: targetPhaseId } : field
      )
    });
  }

  function movePhase(index: number, direction: "up" | "down"): void {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= normalized.phases.length) return;
    const phases = [...normalized.phases];
    [phases[index], phases[target]] = [phases[target]!, phases[index]!];
    change({ phases: phases.map((phase, idx) => ({ ...phase, order: idx + 1 })) });
  }

  function addField(phaseId: string): void {
    const phaseFields = normalized.fields.filter((field) => field.phaseId === phaseId);
    const field: TemplateField = {
      fieldId: createFieldId(),
      phaseId,
      label: "سؤال جديد",
      type: "text",
      required: false,
      options: [],
      placeholder: "",
      condition: null,
      order: phaseFields.length + 1
    };
    change({ fields: [...normalized.fields, field] });
  }

  function updateField(fieldId: string, updated: TemplateField): void {
    change({
      fields: normalized.fields.map((field) => (field.fieldId === fieldId ? updated : field))
    });
  }

  function removeField(fieldId: string): void {
    change({
      fields: normalized.fields
        .filter((field) => field.fieldId !== fieldId)
        .map((field) =>
          field.condition?.sourceFieldId === fieldId ? { ...field, condition: null } : field
        )
    });
  }

  function moveField(phaseId: string, fieldId: string, direction: "up" | "down"): void {
    const fields = [...normalized.fields];
    const phaseFields = fields
      .filter((field) => field.phaseId === phaseId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = phaseFields.findIndex((field) => field.fieldId === fieldId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= phaseFields.length) return;
    [phaseFields[index], phaseFields[target]] = [phaseFields[target]!, phaseFields[index]!];
    const orderById = new Map(phaseFields.map((field, idx) => [field.fieldId, idx + 1]));
    change({
      fields: fields.map((field) =>
        field.phaseId === phaseId ? { ...field, order: orderById.get(field.fieldId) ?? field.order } : field
      )
    });
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
            value={normalized.templateName}
            onChange={(event) => change({ templateName: event.target.value })}
          />
        </label>
        <p className="tb-version-note">
          الإصدار الحالي: {normalized.version} · سيصبح {normalized.version + 1} عند الحفظ
        </p>
      </div>

      <div className="tb-flow">
        {normalized.phases.map((phase, phaseIndex) => {
          const phaseFields = normalized.fields
            .filter((field) => field.phaseId === phase.phaseId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

          return (
            <section key={phase.phaseId} className="tb-phase">
              <div className="tb-phase-rail" aria-hidden="true">
                <span>{phaseIndex + 1}</span>
              </div>
              <div className="tb-phase-body">
                <div className="tb-phase-header">
                  <div className="tb-phase-title-fields">
                    <label className="tb-label">
                      عنوان المرحلة
                      <input
                        type="text"
                        className="tb-input"
                        value={phase.title}
                        onChange={(event) => updatePhase(phase.phaseId, { title: event.target.value })}
                      />
                    </label>
                    <label className="tb-label tb-wide">
                      وصف مختصر
                      <input
                        type="text"
                        className="tb-input"
                        value={phase.description ?? ""}
                        onChange={(event) => updatePhase(phase.phaseId, { description: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="tb-field-controls">
                    <button
                      type="button"
                      className="tb-btn-icon"
                      disabled={phaseIndex === 0}
                      onClick={() => movePhase(phaseIndex, "up")}
                      aria-label="تحريك المرحلة لأعلى"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="tb-btn-icon"
                      disabled={phaseIndex === normalized.phases.length - 1}
                      onClick={() => movePhase(phaseIndex, "down")}
                      aria-label="تحريك المرحلة لأسفل"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="tb-btn-danger-sm"
                      disabled={normalized.phases.length <= 1}
                      onClick={() => removePhase(phase.phaseId)}
                      aria-label="حذف المرحلة"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div className="tb-fields-list">
                  {phaseFields.map((field, fieldIndex) => (
                    <FieldEditor
                      key={field.fieldId}
                      field={field}
                      allFields={allFields}
                      index={fieldIndex}
                      total={phaseFields.length}
                      onChange={(updated) => updateField(field.fieldId, updated)}
                      onRemove={() => removeField(field.fieldId)}
                      onMove={(direction) => moveField(phase.phaseId, field.fieldId, direction)}
                    />
                  ))}
                  {phaseFields.length === 0 ? (
                    <div className="tb-phase-empty">لا توجد حقول في هذه المرحلة.</div>
                  ) : null}
                </div>

                <button type="button" className="tb-add-field-btn" onClick={() => addField(phase.phaseId)}>
                  + إضافة خلية في هذه المرحلة
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <div className="tb-editor-footer">
        <button type="button" className="tb-btn-secondary" onClick={addPhase}>
          + إضافة مرحلة
        </button>
        <button
          type="button"
          className="tb-btn-primary"
          disabled={isSaving || !normalized.templateName.trim()}
          onClick={() => onSave(normalized)}
        >
          {isSaving ? "جاري الحفظ..." : "حفظ نموذج الفحص"}
        </button>
      </div>
    </div>
  );
}

function FieldEditor({
  field,
  allFields,
  index,
  total,
  onChange,
  onRemove,
  onMove
}: {
  field: TemplateField;
  allFields: TemplateField[];
  index: number;
  total: number;
  onChange: (field: TemplateField) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const [optionInput, setOptionInput] = useState("");
  const sourceFields = allFields.filter((candidate) => candidate.fieldId !== field.fieldId);
  const selectedSourceField = field.condition
    ? sourceFields.find((sourceField) => sourceField.fieldId === field.condition?.sourceFieldId)
    : undefined;

  function addOption(): void {
    const nextOption = optionInput.trim();
    if (!nextOption) return;
    onChange({ ...field, options: [...field.options, nextOption] });
    setOptionInput("");
  }

  function removeOption(optionIndex: number): void {
    onChange({ ...field, options: field.options.filter((_, idx) => idx !== optionIndex) });
  }

  function updateCondition(condition: TemplateFieldCondition | null): void {
    onChange({ ...field, condition });
  }

  function createDefaultCondition(sourceField: TemplateField | undefined): TemplateFieldCondition {
    if (!sourceField) return { sourceFieldId: "", operator: "truthy" };
    if (sourceField.type === "checkbox") {
      return { sourceFieldId: sourceField.fieldId, operator: "equals", value: true };
    }
    if (sourceField.type === "dropdown") {
      return {
        sourceFieldId: sourceField.fieldId,
        operator: "equals",
        value: sourceField.options[0] ?? ""
      };
    }
    return { sourceFieldId: sourceField.fieldId, operator: "truthy" };
  }

  function conditionForSource(sourceFieldId: string): TemplateFieldCondition {
    return createDefaultCondition(
      sourceFields.find((sourceField) => sourceField.fieldId === sourceFieldId)
    );
  }

  const operatorOptions = selectedSourceField?.type === "checkbox" || selectedSourceField?.type === "dropdown"
    ? (["equals", "notEquals"] as TemplateFieldConditionOperator[])
    : (Object.keys(CONDITION_LABELS) as TemplateFieldConditionOperator[]);
  const effectiveOperator =
    field.condition && operatorOptions.includes(field.condition.operator)
      ? field.condition.operator
      : operatorOptions[0]!;

  return (
    <article className="tb-field-card">
      <div className="tb-field-header">
        <span className="tb-field-index">{index + 1}</span>
        <div className="tb-field-controls">
          <button type="button" className="tb-btn-icon" disabled={index === 0} onClick={() => onMove("up")}>
            ↑
          </button>
          <button type="button" className="tb-btn-icon" disabled={index === total - 1} onClick={() => onMove("down")}>
            ↓
          </button>
          <button type="button" className="tb-btn-danger-sm" onClick={onRemove} aria-label="حذف الحقل">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="tb-field-row">
        <label className="tb-label tb-wide">
          التسمية
          <input
            type="text"
            className="tb-input"
            value={field.label}
            onChange={(event) => onChange({ ...field, label: event.target.value })}
          />
        </label>

        <label className="tb-label">
          نوع الخلية
          <select
            className="tb-select"
            value={field.type}
            onChange={(event) =>
              onChange({
                ...field,
                type: event.target.value as TemplateFieldType,
                options: (event.target.value === "dropdown" || event.target.value === "combobox") ? field.options : []
              })
            }
          >
            {(Object.keys(FIELD_TYPE_LABELS) as TemplateFieldType[]).map((type) => (
              <option key={type} value={type}>
                {FIELD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="tb-label tb-checkbox-label">
          <input
            type="checkbox"
            checked={field.required}
            disabled={field.type === "empty"}
            onChange={(event) => onChange({ ...field, required: event.target.checked })}
          />
          <span>مطلوب</span>
        </label>
      </div>

      {field.type !== "checkbox" && field.type !== "empty" ? (
        <label className="tb-label tb-wide tb-field-extra">
          نص مساعد داخل الخلية
          <input
            type="text"
            className="tb-input"
            value={field.placeholder ?? ""}
            onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
          />
        </label>
      ) : null}

      {(field.type === "dropdown" || field.type === "combobox") ? (
        <div className="tb-options-section">
          <p className="tb-options-heading">{field.type === "combobox" ? "اقتراحات الإكمال التلقائي:" : "خيارات القائمة:"}</p>
          <div className="tb-options-list">
            {field.options.map((option, optionIndex) => (
              <div key={`${option}-${optionIndex}`} className="tb-option-item">
                <span>{option}</span>
                <button type="button" className="tb-btn-danger-sm" onClick={() => removeOption(optionIndex)}>
                  <X size={14} />
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
              onChange={(event) => setOptionInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOption();
                }
              }}
            />
            <button type="button" className="tb-btn-secondary" onClick={addOption}>
              إضافة
            </button>
          </div>
        </div>
      ) : null}

      <div className="tb-condition-box">
        <label className="tb-checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(field.condition)}
            disabled={sourceFields.length === 0}
            onChange={(event) =>
              updateCondition(
                event.target.checked
                  ? createDefaultCondition(sourceFields[0])
                  : null
              )
            }
          />
          <span>إظهار هذا الحقل حسب إجابة سابقة</span>
        </label>

        {field.condition ? (
          <div className="tb-condition-grid">
            <label className="tb-label">
              السؤال المرتبط
              <select
                className="tb-select"
                value={field.condition.sourceFieldId}
                onChange={(event) =>
                  updateCondition(conditionForSource(event.target.value))
                }
              >
                {sourceFields.map((sourceField) => (
                  <option key={sourceField.fieldId} value={sourceField.fieldId}>
                    {sourceField.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="tb-label">
              الشرط
              <select
                className="tb-select"
                value={effectiveOperator}
                onChange={(event) =>
                  updateCondition({
                    ...field.condition!,
                    operator: event.target.value as TemplateFieldConditionOperator,
                    value:
                      event.target.value === "truthy" || event.target.value === "falsy"
                        ? undefined
                        : field.condition!.value
                  })
                }
              >
                {operatorOptions.map((operator) => (
                  <option key={operator} value={operator}>
                    {CONDITION_LABELS[operator]}
                  </option>
                ))}
              </select>
            </label>

            {effectiveOperator === "equals" || effectiveOperator === "notEquals" ? (
              <label className="tb-label">
                القيمة
                {selectedSourceField?.type === "dropdown" ? (
                  <select
                    className="tb-select"
                    value={String(field.condition.value ?? "")}
                    onChange={(event) =>
                      updateCondition({ ...field.condition!, value: event.target.value })
                    }
                  >
                    {selectedSourceField.options.length === 0 ? (
                      <option value="">لا توجد خيارات بعد</option>
                    ) : null}
                    {selectedSourceField.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : selectedSourceField?.type === "checkbox" ? (
                  <select
                    className="tb-select"
                    value={String(field.condition.value ?? true)}
                    onChange={(event) =>
                      updateCondition({
                        ...field.condition!,
                        value: event.target.value === "true"
                      })
                    }
                  >
                    <option value="true">نعم / مفعلة</option>
                    <option value="false">لا / غير مفعلة</option>
                  </select>
                ) : (
                  <input
                    type={selectedSourceField?.type === "number" ? "number" : "text"}
                    className="tb-input"
                    value={String(field.condition.value ?? "")}
                    onChange={(event) =>
                      updateCondition({
                        ...field.condition!,
                        value:
                          selectedSourceField?.type === "number" && event.target.value !== ""
                            ? Number(event.target.value)
                            : event.target.value
                      })
                    }
                  />
                )}
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function normalizeSchema(schema: TemplateSchema): TemplateSchema & { phases: TemplatePhase[] } {
  const phases =
    schema.phases && schema.phases.length > 0
      ? schema.phases
      : [{ phaseId: createPhaseId(), title: "مرحلة الفحص", description: "", order: 1 }];
  const sortedPhases = [...phases]
    .sort((a, b) => a.order - b.order)
    .map((phase, index) => ({ ...phase, order: index + 1 }));
  const fallbackPhaseId = sortedPhases[0]!.phaseId;
  const fields = (schema.fields ?? []).map((field, index) => ({
    ...field,
    phaseId: field.phaseId ?? fallbackPhaseId,
    order: field.order ?? index + 1,
    options: field.options ?? [],
    condition: field.condition ?? null
  }));

  return {
    ...schema,
    phases: sortedPhases,
    fields: normalizeFieldConditions(fields)
  };
}


function normalizeFieldConditions(fields: TemplateField[]): TemplateField[] {
  return fields.map((field) => {
    if (!field.condition?.sourceFieldId) return { ...field, condition: null };

    const sourceField = fields.find(
      (candidate) => candidate.fieldId === field.condition?.sourceFieldId
    );
    if (!sourceField) return { ...field, condition: null };

    if (sourceField.type === "checkbox") {
      const value =
        field.condition.value === false || field.condition.value === "false"
          ? false
          : true;
      return {
        ...field,
        condition: {
          sourceFieldId: sourceField.fieldId,
          operator:
            field.condition.operator === "notEquals" ? "notEquals" : "equals",
          value
        }
      };
    }

    if (sourceField.type === "dropdown") {
      const options = sourceField.options ?? [];
      const currentValue = String(field.condition.value ?? "");
      const value = options.includes(currentValue) ? currentValue : options[0] ?? "";
      return {
        ...field,
        condition: {
          sourceFieldId: sourceField.fieldId,
          operator:
            field.condition.operator === "notEquals" ? "notEquals" : "equals",
          value
        }
      };
    }

    return field;
  });
}

// canUseTemplateBuilder has been moved to ./templateBuilderHelpers.ts
// to satisfy the react-refresh/only-export-components rule.
