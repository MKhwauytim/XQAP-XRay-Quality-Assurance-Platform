import { useEffect, useState } from "react";
import { Settings2, X } from "lucide-react";
import type {
  CustomField,
  ExportColumnSetting,
  MappingTemplate,
  PopulationConfig,
  ProcessingWorkflowStep,
  ProcessingStepKind,
  StageAliasMappings,
  StageKey
} from "../../../../../data/population/populationConfig";
import {
  DEFAULT_PROCESSING_WORKFLOW,
  DEFAULT_STAGE_MAPPINGS,
  PROCESSING_WORKFLOW_PRESETS
} from "../../../../../data/population/populationConfig";

type MappingSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  config: PopulationConfig;
  onConfigChange: (config: PopulationConfig) => void;
  mode?: "mapping" | "processing";
  processingContext?: {
    riskFileName: string | null;
    biFileName: string | null;
    riskRows: number | null;
    biRows: number | null;
    certScanProvided: boolean;
    finalRows: number | null;
    riskSheetNames?: string[];
    biSheetNames?: string[];
    riskColumnHints?: Record<string, string[]>;
    biColumnHints?: Record<string, string[]>;
  };
};

export default function MappingSettingsModal({
  isOpen,
  onClose,
  config,
  onConfigChange,
  mode = "mapping",
  processingContext
}: MappingSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"mappings" | "processing" | "stages" | "sheets" | "exports">("mappings");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newStepTitle, setNewStepTitle] = useState("");
  const [selectedWorkflowStepId, setSelectedWorkflowStepId] = useState<string | null>(null);
  const [processingMapView, setProcessingMapView] = useState<"topDown" | "horizontal">("topDown");

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(mode === "processing" ? "processing" : "mappings");
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const template = config.mappingTemplates[0] || {
    templateId: "default-template",
    name: "قالب مخصص",
    sheetPatterns: { risk: [], bi: [] },
    columnMappings: {}
  };
  const stageMappings = config.stageMappings || DEFAULT_STAGE_MAPPINGS;
  const stageLabels: Record<StageKey, string> = {
    first: "المستوى الأول",
    second: "المستوى الثاني",
    third: "المستوى الثالث",
    fourth: "المستوى الرابع"
  };
  const workflow = config.processingWorkflow || DEFAULT_PROCESSING_WORKFLOW;
  const workflowSteps = [...workflow.steps].sort((a, b) => a.order - b.order);
  const selectedWorkflowStep =
    workflowSteps.find((step) => step.stepId === selectedWorkflowStepId) ?? workflowSteps[0] ?? null;
  const fieldOptions = [
    ...config.systemFields.map((field) => ({ key: field.key, label: field.labelAr })),
    ...config.customFields.map((field) => ({ key: field.key, label: field.labelAr }))
  ];
  const stepKindLabels: Record<ProcessingStepKind, string> = {
    "validate-xray-id": "تحقق معرف",
    deduplicate: "إزالة تكرار",
    "bi-link": "ربط BI",
    "bi-fill": "تعبئة BI",
    "validate-results": "تحقق النتائج",
    "certscan-match": "مطابقة CertScan",
    finalize: "إنشاء نهائي",
    custom: "مخصص"
  };
  const dataSourceCards = [
    {
      id: "risk",
      label: "ملف المخاطر",
      detail: processingContext?.riskFileName ?? "لم يتم رفع ملف",
      meta: processingContext?.riskRows !== null && processingContext?.riskRows !== undefined
        ? `${processingContext.riskRows.toLocaleString("ar-SA-u-nu-latn")} صف`
        : "بانتظار القراءة",
      isReady: Boolean(processingContext?.riskFileName),
      feeds: ["validate-xray-id", "deduplicate", "bi-link", "validate-results"]
    },
    {
      id: "bi",
      label: "ملف BI",
      detail: processingContext?.biFileName ?? "اختياري - لم يتم رفع ملف",
      meta: processingContext?.biRows !== null && processingContext?.biRows !== undefined
        ? `${processingContext.biRows.toLocaleString("ar-SA-u-nu-latn")} صف`
        : "يستخدم للتعبئة والربط",
      isReady: Boolean(processingContext?.biFileName),
      feeds: ["bi-link", "bi-fill"]
    },
    {
      id: "certscan",
      label: "قائمة CertScan",
      detail: processingContext?.certScanProvided ? "تم إدخال بيانات CertScan" : "لم يتم إدخال بيانات",
      meta: "تغذي خطوة المطابقة",
      isReady: Boolean(processingContext?.certScanProvided),
      feeds: ["certscan-match"]
    }
  ];
  const requiredFields = config.systemFields.filter((field) => field.isRequired);
  const riskSheetNames = processingContext?.riskSheetNames ?? [];
  const biSheetNames = processingContext?.biSheetNames ?? [];

  const mergeAliases = (
    current: Record<string, string[]> = {},
    hints: Record<string, string[]> = {}
  ) => {
    const next = { ...current };
    for (const [fieldKey, aliases] of Object.entries(hints)) {
      const merged = new Set([...(next[fieldKey] ?? []), ...aliases]);
      next[fieldKey] = Array.from(merged);
    }
    return next;
  };

  const handleApplyDetectedWorkbookSettings = () => {
    const updatedTemplates = config.mappingTemplates.map((t: MappingTemplate) => {
      if (t.templateId !== template.templateId) return t;
      return {
        ...t,
        sheetPatterns: {
          risk: riskSheetNames.length > 0 ? riskSheetNames : t.sheetPatterns.risk,
          bi: biSheetNames.length > 0 ? biSheetNames : t.sheetPatterns.bi
        },
        columnMappings: mergeAliases(t.columnMappings, processingContext?.riskColumnHints),
        biColumnMappings: mergeAliases(t.biColumnMappings ?? t.columnMappings, processingContext?.biColumnHints)
      };
    });
    onConfigChange({ ...config, mappingTemplates: updatedTemplates });
  };

  const handleMappingChange = (fieldKey: string, val: string) => {
    const aliases = val.split(",").map((s) => s.trim()).filter(Boolean);
    const updatedMappings = { ...template.columnMappings, [fieldKey]: aliases };
    const updatedTemplates = config.mappingTemplates.map((t: any) =>
      t.templateId === template.templateId ? { ...t, columnMappings: updatedMappings } : t
    );
    onConfigChange({ ...config, mappingTemplates: updatedTemplates });
  };

  const handleBiMappingChange = (fieldKey: string, val: string) => {
    const aliases = val.split(",").map((s) => s.trim()).filter(Boolean);
    const updatedBiMappings = { ...(template.biColumnMappings ?? {}), [fieldKey]: aliases };
    const updatedTemplates = config.mappingTemplates.map((t: any) =>
      t.templateId === template.templateId ? { ...t, biColumnMappings: updatedBiMappings } : t
    );
    onConfigChange({ ...config, mappingTemplates: updatedTemplates });
  };

  const handleSheetPatternChange = (type: "risk" | "bi", val: string) => {
    const patterns = val.split(",").map((s) => s.trim()).filter(Boolean);
    const updatedTemplates = config.mappingTemplates.map((t: any) => {
      if (t.templateId === template.templateId) {
        return {
          ...t,
          sheetPatterns: {
            ...t.sheetPatterns,
            [type]: patterns
          }
        };
      }
      return t;
    });
    onConfigChange({ ...config, mappingTemplates: updatedTemplates });
  };

  const handleStageMappingChange = (stageKey: StageKey, val: string) => {
    const aliases = val.split(",").map((s) => s.trim()).filter(Boolean);
    const updatedStageMappings: StageAliasMappings = {
      ...stageMappings,
      [stageKey]: aliases
    };
    onConfigChange({ ...config, stageMappings: updatedStageMappings });
  };

  const handleResetStageMappings = () => {
    onConfigChange({ ...config, stageMappings: DEFAULT_STAGE_MAPPINGS });
  };

  const normalizeWorkflowOrders = (steps: ProcessingWorkflowStep[]) =>
    steps.map((step, index) => ({ ...step, order: (index + 1) * 10 }));

  const handleWorkflowStepChange = (
    stepId: string,
    patch: Partial<ProcessingWorkflowStep>
  ) => {
    const updatedSteps = workflow.steps.map((step) =>
      step.stepId === stepId ? { ...step, ...patch } : step
    );
    onConfigChange({
      ...config,
      processingWorkflow: { ...workflow, activePresetId: "custom", steps: updatedSteps }
    });
  };

  const handleMoveWorkflowStep = (stepId: string, direction: "up" | "down") => {
    const index = workflowSteps.findIndex((step) => step.stepId === stepId);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= workflowSteps.length) return;
    const nextSteps = [...workflowSteps];
    const current = nextSteps[index]!;
    nextSteps[index] = nextSteps[swapIndex]!;
    nextSteps[swapIndex] = current;
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: normalizeWorkflowOrders(nextSteps)
      }
    });
  };

  const handleApplyWorkflowPreset = (presetId: string) => {
    const preset = PROCESSING_WORKFLOW_PRESETS.find((item) => item.presetId === presetId);
    if (!preset) return;
    onConfigChange({
      ...config,
      processingWorkflow: {
        activePresetId: preset.presetId,
        steps: preset.steps.map((step) => ({ ...step }))
      }
    });
    setSelectedWorkflowStepId(preset.steps[0]?.stepId ?? null);
  };

  const handleAddWorkflowStep = () => {
    const title = newStepTitle.trim();
    if (!title) {
      alert("الرجاء إدخال اسم خطوة المعالجة.");
      return;
    }
    const nextStep: ProcessingWorkflowStep = {
      stepId: `custom-${Date.now()}`,
      kind: "custom",
      titleAr: title,
      descriptionAr: "خطوة مخصصة ضمن خريطة المعالجة.",
      isEnabled: true,
      order: workflowSteps.length > 0 ? workflowSteps[workflowSteps.length - 1]!.order + 10 : 10
    };
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: [...workflow.steps, nextStep]
      }
    });
    setNewStepTitle("");
  };

  const handleRemoveWorkflowStep = (stepId: string) => {
    const nextSteps = normalizeWorkflowOrders(workflowSteps.filter((step) => step.stepId !== stepId));
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: nextSteps
      }
    });
    setSelectedWorkflowStepId(nextSteps[0]?.stepId ?? null);
  };

  const handleInsertWorkflowStepAfter = (afterStepId: string) => {
    const afterIndex = workflowSteps.findIndex((step) => step.stepId === afterStepId);
    const nextStep: ProcessingWorkflowStep = {
      stepId: `custom-${Date.now()}`,
      kind: "custom",
      titleAr: "خطوة مخصصة",
      descriptionAr: "خطوة مخصصة مرتبطة بهذا الموضع في خريطة المعالجة.",
      isEnabled: true,
      order: afterIndex >= 0 ? workflowSteps[afterIndex]!.order + 1 : workflowSteps.length * 10 + 10
    };
    const nextSteps = [...workflowSteps];
    nextSteps.splice(afterIndex + 1, 0, nextStep);
    const normalized = normalizeWorkflowOrders(nextSteps);
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: normalized
      }
    });
    setSelectedWorkflowStepId(nextStep.stepId);
  };

  const handleAddCustomField = () => {
    if (!newFieldName || !newFieldLabel) {
      alert("الرجاء إدخال اسم الكود والاسم العربي للحقل.");
      return;
    }
    const key = newFieldName.trim();
    const labelAr = newFieldLabel.trim();

    if (config.systemFields.some((f: any) => f.key === key) || config.customFields.some((f: any) => f.key === key)) {
      alert("اسم الكود هذا مستخدم بالفعل.");
      return;
    }

    const newField: CustomField = {
      key,
      labelAr,
      dataType: "string"
    };

    // Add to mappings and export columns too
    const updatedCustomFields = [...config.customFields, newField];
    const updatedMappings = {
      ...template.columnMappings,
      [key]: [labelAr]
    };
    const updatedTemplates = config.mappingTemplates.map((t: any) => {
      if (t.templateId === template.templateId) {
        return { ...t, columnMappings: updatedMappings };
      }
      return t;
    });

    const newExportCol: ExportColumnSetting = {
      fieldKey: key,
      exportHeader: labelAr,
      isEnabled: true,
      order: config.exportTemplates[0]?.columns.length + 1 || 20
    };
    const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
      ...exp,
      columns: [...exp.columns, newExportCol]
    }));

    onConfigChange({
      ...config,
      customFields: updatedCustomFields,
      mappingTemplates: updatedTemplates,
      exportTemplates: updatedExportTemplates
    });

    setNewFieldName("");
    setNewFieldLabel("");
  };

  const handleToggleSystemFieldRequired = (key: string) => {
    const updated = config.systemFields.map((f: any) =>
      f.key === key ? { ...f, isRequired: !f.isRequired } : f
    );
    onConfigChange({ ...config, systemFields: updated });
  };

  const handleRemoveSystemField = (key: string) => {
    if (!confirm(`هل أنت متأكد من حذف الحقل "${key}" من القائمة؟ يمكنك استعادته من الإعدادات الافتراضية.`)) return;
    const updatedFields = config.systemFields.filter((f: any) => f.key !== key);
    const updatedMappings = { ...template.columnMappings };
    delete updatedMappings[key];
    const updatedTemplates = config.mappingTemplates.map((t: any) =>
      t.templateId === template.templateId ? { ...t, columnMappings: updatedMappings } : t
    );
    const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
      ...exp,
      columns: exp.columns.filter((c: any) => c.fieldKey !== key)
    }));
    onConfigChange({
      ...config,
      systemFields: updatedFields,
      mappingTemplates: updatedTemplates,
      exportTemplates: updatedExportTemplates
    });
  };

  const handleRemoveCustomField = (key: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا الحقل المخصص؟")) return;

    const updatedCustomFields = config.customFields.filter((f: any) => f.key !== key);
    const updatedMappings = { ...template.columnMappings };
    delete updatedMappings[key];

    const updatedTemplates = config.mappingTemplates.map((t: any) => {
      if (t.templateId === template.templateId) {
        return { ...t, columnMappings: updatedMappings };
      }
      return t;
    });

    const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
      ...exp,
      columns: exp.columns.filter((c: any) => c.fieldKey !== key)
    }));

    onConfigChange({
      ...config,
      customFields: updatedCustomFields,
      mappingTemplates: updatedTemplates,
      exportTemplates: updatedExportTemplates
    });
  };

  const handleMoveColumn = (fieldKey: string, direction: "up" | "down") => {
    const sorted = [...(config.exportTemplates[0]?.columns || [])].sort(
      (a: any, b: any) => a.order - b.order
    );
    const idx = sorted.findIndex((c: any) => c.fieldKey === fieldKey);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newSorted = [...sorted];
    const tempOrder = newSorted[idx].order;
    newSorted[idx] = { ...newSorted[idx], order: newSorted[swapIdx].order };
    newSorted[swapIdx] = { ...newSorted[swapIdx], order: tempOrder };
    onConfigChange({
      ...config,
      exportTemplates: config.exportTemplates.map((exp: any) => ({ ...exp, columns: newSorted }))
    });
  };

  const handleExportColumnChange = (fieldKey: string, field: keyof ExportColumnSetting, val: any) => {
    const updatedColumns = config.exportTemplates[0].columns.map((col: any) => {
      if (col.fieldKey === fieldKey) {
        return { ...col, [field]: val };
      }
      return col;
    });
    const updatedExportTemplates = config.exportTemplates.map((exp: any) => ({
      ...exp,
      columns: updatedColumns
    }));
    onConfigChange({ ...config, exportTemplates: updatedExportTemplates });
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
        direction: "rtl"
      }}
    >
      <div
        style={{
          background: "var(--population-bg-card, #ffffff)",
          border: "1px solid var(--population-border, #e0e0e0)",
          borderRadius: "16px",
          width: "90%",
          maxWidth: mode === "processing" ? "1180px" : "800px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.15)",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--population-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: 0 }}>
            <Settings2 size={18} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />{mode === "processing" ? "إعدادات المعالجة" : "إعدادات الربط والخرائط والتصدير"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--population-muted)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection */}
        {mode === "mapping" && (
        <div style={{ display: "flex", background: "var(--population-bg-light)", borderBottom: "1px solid var(--population-border)" }}>
          <button
            type="button"
            onClick={() => setActiveTab("mappings")}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: activeTab === "mappings" ? "var(--population-bg-card)" : "none",
              fontWeight: activeTab === "mappings" ? "bold" : "normal",
              borderBottom: activeTab === "mappings" ? "2px solid var(--population-primary)" : "none",
              cursor: "pointer"
            }}
          >
            تطابق الأعمدة والربط
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sheets")}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: activeTab === "sheets" ? "var(--population-bg-card)" : "none",
              fontWeight: activeTab === "sheets" ? "bold" : "normal",
              borderBottom: activeTab === "sheets" ? "2px solid var(--population-primary)" : "none",
              cursor: "pointer"
            }}
          >
            أوراق العمل (Tabs)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stages")}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: activeTab === "stages" ? "var(--population-bg-card)" : "none",
              fontWeight: activeTab === "stages" ? "bold" : "normal",
              borderBottom: activeTab === "stages" ? "2px solid var(--population-primary)" : "none",
              cursor: "pointer"
            }}
          >
            ترجمة المستويات
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("exports")}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: activeTab === "exports" ? "var(--population-bg-card)" : "none",
              fontWeight: activeTab === "exports" ? "bold" : "normal",
              borderBottom: activeTab === "exports" ? "2px solid var(--population-primary)" : "none",
              cursor: "pointer"
            }}
          >
            أعمدة التصدير
          </button>
        </div>
        )}

        {/* Tab Body */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
          {activeTab === "mappings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
                اربط كل حقل بأسماء الأعمدة المتوقعة في ملفات Excel لكل مصدر بيانات على حدة. افصل بين التسميات بفواصل (،). عمود BI يُطبَّق على ملف BI فقط، بينما عمود المخاطر يُطبَّق على ملف بيانات المخاطر.
              </p>

              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr 36px", gap: "8px", alignItems: "center", padding: "6px 8px", background: "var(--population-bg-card)", borderRadius: "8px", fontSize: "12px", fontWeight: "700", color: "var(--population-muted)" }}>
                <span>الحقل</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                  أعمدة ملف المخاطر
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#3b82f6", display: "inline-block" }} />
                  أعمدة ملف BI
                </span>
                <span />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {config.systemFields.map((field) => (
                  <div key={field.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr 36px", gap: "8px", alignItems: "center" }}>
                    {/* Field label */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--population-text)" }}>{field.labelAr}</span>
                      <span style={{ fontSize: "11px", color: "var(--population-muted)", fontFamily: "monospace" }}>{field.key}</span>
                      <button
                        type="button"
                        onClick={() => handleToggleSystemFieldRequired(field.key)}
                        title={field.isRequired ? "انقر لإلغاء الإلزامية" : "انقر لجعله إلزامياً"}
                        style={{
                          fontSize: "10px", fontWeight: "700", padding: "1px 6px", border: "none",
                          borderRadius: "20px", cursor: "pointer", width: "fit-content",
                          background: field.isRequired ? "#fee2e2" : "#f1f5f9",
                          color: field.isRequired ? "#b91c1c" : "var(--population-muted)",
                          transition: "all 150ms"
                        }}
                      >
                        {field.isRequired ? "● إلزامي" : "○ اختياري"}
                      </button>
                    </div>
                    {/* Risk column aliases */}
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="أسماء الأعمدة في ملف المخاطر..."
                      value={(template.columnMappings[field.key] || []).join(", ")}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      style={{ borderColor: "#fca5a5" }}
                    />
                    {/* BI column aliases */}
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="أسماء الأعمدة في ملف BI... (اتركه فارغاً لاستخدام نفس أعمدة المخاطر)"
                      value={((template.biColumnMappings ?? {})[field.key] || []).join(", ")}
                      onChange={(e) => handleBiMappingChange(field.key, e.target.value)}
                      style={{ borderColor: "#93c5fd" }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveSystemField(field.key)}
                      title="إزالة هذا الحقل من القائمة"
                      style={{
                        background: "#f8fafc", color: "var(--population-muted)",
                        border: "1px solid var(--population-border)", borderRadius: "8px",
                        padding: "0", cursor: "pointer", height: "36px", width: "36px",
                        fontSize: "14px", transition: "all 150ms"
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2"; (e.currentTarget as HTMLButtonElement).style.color = "#b91c1c"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; (e.currentTarget as HTMLButtonElement).style.color = "var(--population-muted)"; }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

                {config.customFields.map((field) => (
                  <div key={field.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr 1fr 36px", gap: "8px", alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--population-text)" }}>{field.labelAr}</span>
                      <span style={{ fontSize: "11px", color: "var(--population-muted)", fontFamily: "monospace" }}>{field.key}</span>
                      <span style={{ fontSize: "10px", color: "var(--population-success)", fontWeight: "600" }}>حقل مخصص</span>
                    </div>
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="أعمدة ملف المخاطر..."
                      value={(template.columnMappings[field.key] || []).join(", ")}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      style={{ borderColor: "#fca5a5" }}
                    />
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="أعمدة ملف BI..."
                      value={((template.biColumnMappings ?? {})[field.key] || []).join(", ")}
                      onChange={(e) => handleBiMappingChange(field.key, e.target.value)}
                      style={{ borderColor: "#93c5fd" }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomField(field.key)}
                      style={{
                        background: "var(--population-error, #f44336)", color: "white",
                        border: "none", borderRadius: "8px", padding: "0",
                        cursor: "pointer", height: "36px", width: "36px", fontSize: "14px"
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Custom Field Form */}
              <div style={{ borderTop: "1px dashed var(--population-border)", paddingTop: "16px", marginTop: "16px" }}>
                <h4 style={{ fontSize: "14px", fontWeight: "bold", marginBottom: "8px" }}>➕ إضافة حقل مخصص جديد</h4>
                <div style={{ display: "flex", gap: "10px" }}>
                  <label className="save-disk-label" style={{ flex: 1 }}>
                    اسم الكود (لاتيني - e.g. inspectionLocation)
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="inspectionLocation"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                    />
                  </label>
                  <label className="save-disk-label" style={{ flex: 1 }}>
                    الاسم باللغة العربية (e.g. موقع التفتيش)
                    <input
                      type="text"
                      className="save-disk-input"
                      placeholder="موقع التفتيش"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-action"
                    style={{ alignSelf: "flex-end", height: "36px" }}
                    onClick={handleAddCustomField}
                  >
                    إضافة الحقل
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "processing" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(280px, 0.9fr)", gap: "16px", alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label className="save-disk-label" style={{ flex: "1 1 260px" }}>
                    قالب خريطة المعالجة
                    <select
                      className="save-disk-input"
                      value={workflow.activePresetId}
                      onChange={(event) => handleApplyWorkflowPreset(event.target.value)}
                    >
                      {PROCESSING_WORKFLOW_PRESETS.map((preset) => (
                        <option key={preset.presetId} value={preset.presetId}>
                          {preset.nameAr}
                        </option>
                      ))}
                      <option value="custom">قالب مخصص</option>
                    </select>
                  </label>
                  <label className="save-disk-label" style={{ flex: "1 1 240px" }}>
                    إضافة خطوة سريعة
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        className="save-disk-input"
                        placeholder="مثال: نقل قيمة من عمود إلى آخر"
                        value={newStepTitle}
                        onChange={(event) => setNewStepTitle(event.target.value)}
                      />
                      <button
                        type="button"
                        className="primary-action"
                        style={{ height: "36px", whiteSpace: "nowrap" }}
                        onClick={handleAddWorkflowStep}
                      >
                        إضافة
                      </button>
                    </div>
                  </label>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", alignSelf: "flex-end", background: "#f1f5f9", border: "1px solid #dce4ee", borderRadius: "10px", padding: "4px" }}>
                    <button
                      type="button"
                      onClick={() => setProcessingMapView("topDown")}
                      style={{
                        border: "none",
                        borderRadius: "7px",
                        padding: "7px 10px",
                        cursor: "pointer",
                        background: processingMapView === "topDown" ? "var(--population-primary)" : "transparent",
                        color: processingMapView === "topDown" ? "#fff" : "#334155",
                        fontWeight: 800,
                        fontSize: "12px"
                      }}
                    >
                      عرض علوي
                    </button>
                    <button
                      type="button"
                      onClick={() => setProcessingMapView("horizontal")}
                      style={{
                        border: "none",
                        borderRadius: "7px",
                        padding: "7px 10px",
                        cursor: "pointer",
                        background: processingMapView === "horizontal" ? "var(--population-primary)" : "transparent",
                        color: processingMapView === "horizontal" ? "#fff" : "#334155",
                        fontWeight: 800,
                        fontSize: "12px"
                      }}
                    >
                      عرض أفقي
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--population-border)",
                    borderRadius: "14px",
                    background: "#f8fafc",
                    padding: "16px",
                    minHeight: "460px",
                    overflowX: "auto"
                  }}
                >
                  {processingMapView === "topDown" ? (
                    <div style={{ display: "grid", gap: "14px", minWidth: "620px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: "10px" }}>
                        {dataSourceCards.map((source) => (
                          <div
                            key={source.id}
                            style={{
                              border: source.isReady ? "1px solid #86efac" : "1px solid #dce4ee",
                              borderRadius: "12px",
                              background: source.isReady ? "#f0fdf4" : "#fff",
                              padding: "10px",
                              minHeight: "98px"
                            }}
                          >
                            <strong style={{ color: "#17365d", fontSize: "13px" }}>{source.label}</strong>
                            <p style={{ margin: "6px 0", color: "#334155", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.detail}</p>
                            <span style={{ color: source.isReady ? "#166534" : "#94a3b8", fontSize: "11px", fontWeight: 800 }}>{source.meta}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ textAlign: "center", color: "#94a3b8", fontWeight: 800 }}>↓ البيانات تدخل إلى خطوات المعالجة ↓</div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
                        {workflowSteps.map((step, index) => {
                          const isSelected = selectedWorkflowStep?.stepId === step.stepId;
                          const feeds = dataSourceCards.filter((source) => source.feeds.includes(step.kind));
                          return (
                            <div key={step.stepId} style={{ width: "100%", maxWidth: "620px", display: "grid", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => setSelectedWorkflowStepId(step.stepId)}
                                style={{
                                  width: "100%",
                                  border: isSelected ? "2px solid var(--population-primary)" : "1px solid #dce4ee",
                                  borderRadius: "12px",
                                  background: step.isEnabled ? "#fff" : "#eef2f7",
                                  boxShadow: isSelected ? "0 10px 26px rgba(23, 54, 93, 0.16)" : "0 4px 12px rgba(15, 23, 42, 0.05)",
                                  padding: "10px 12px",
                                  cursor: "pointer",
                                  textAlign: "right",
                                  opacity: step.isEnabled ? 1 : 0.62,
                                  display: "grid",
                                  gridTemplateColumns: "42px 1fr auto",
                                  gap: "10px",
                                  alignItems: "center"
                                }}
                              >
                                <span style={{ width: "30px", height: "30px", borderRadius: "50%", background: step.isEnabled ? "var(--population-primary)" : "#94a3b8", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                                  {index + 1}
                                </span>
                                <span>
                                  <strong style={{ display: "block", color: "#172033", fontSize: "13px" }}>{step.titleAr}</strong>
                                  <span style={{ color: "#64748b", fontSize: "11px" }}>
                                    {feeds.length > 0 ? `مدخلات: ${feeds.map((item) => item.label).join("، ")}` : stepKindLabels[step.kind]}
                                  </span>
                                </span>
                                <span style={{ color: "#0f766e", fontSize: "11px", fontWeight: 800, direction: "ltr" }}>
                                  {step.sourceField || step.targetField ? `${step.sourceField ?? "?"} → ${step.targetField ?? "?"}` : "—"}
                                </span>
                              </button>
                              {index < workflowSteps.length - 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleInsertWorkflowStepAfter(step.stepId)}
                                  title="إرفاق خطوة هنا"
                                  style={{ justifySelf: "center", width: "30px", height: "30px", borderRadius: "50%", border: "1px dashed var(--population-primary)", background: "#fff", color: "var(--population-primary)", cursor: "pointer", fontWeight: 800 }}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ textAlign: "center", color: "#94a3b8", fontWeight: 800 }}>↓</div>
                      <div style={{ justifySelf: "center", width: "min(100%, 360px)", border: "1px solid #bfdbfe", borderRadius: "12px", background: "#eff6ff", padding: "12px", textAlign: "center" }}>
                        <strong style={{ color: "#17365d" }}>مجتمع المعالجة النهائي</strong>
                        <p style={{ margin: "6px 0 0", color: "#334155", fontSize: "12px" }}>
                          {processingContext?.finalRows !== null && processingContext?.finalRows !== undefined
                            ? `${processingContext.finalRows.toLocaleString("ar-SA-u-nu-latn")} صف جاهز`
                            : "يظهر بعد تشغيل المعالجة"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "720px" }}>
                      {workflowSteps.map((step, index) => {
                        const isSelected = selectedWorkflowStep?.stepId === step.stepId;
                        const hasLink = Boolean(step.sourceField || step.targetField);
                        return (
                          <div key={step.stepId} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedWorkflowStepId(step.stepId)}
                              style={{
                                width: "150px",
                                minHeight: "126px",
                                border: isSelected ? "2px solid var(--population-primary)" : "1px solid #dce4ee",
                                borderRadius: "12px",
                                background: step.isEnabled ? "#fff" : "#eef2f7",
                                boxShadow: isSelected ? "0 10px 26px rgba(23, 54, 93, 0.16)" : "0 4px 12px rgba(15, 23, 42, 0.05)",
                                padding: "10px",
                                cursor: "pointer",
                                textAlign: "right",
                                opacity: step.isEnabled ? 1 : 0.62,
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px"
                              }}
                            >
                              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                                <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: step.isEnabled ? "var(--population-primary)" : "#94a3b8", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 800 }}>
                                  {index + 1}
                                </span>
                                <span style={{ padding: "2px 7px", borderRadius: "999px", background: hasLink ? "#dcfce7" : "#eef2ff", color: hasLink ? "#166534" : "#3730a3", fontSize: "10.5px", fontWeight: 800 }}>
                                  {hasLink ? "مرتبط" : stepKindLabels[step.kind]}
                                </span>
                              </span>
                              <strong style={{ color: "#172033", fontSize: "13px", lineHeight: 1.45 }}>{step.titleAr}</strong>
                              <span style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                {step.descriptionAr}
                              </span>
                              {(step.sourceField || step.targetField) && (
                                <span style={{ marginTop: "auto", color: "#0f766e", fontSize: "11px", fontWeight: 700, direction: "ltr", textAlign: "left" }}>
                                  {step.sourceField ?? "?"} → {step.targetField ?? "?"}
                                </span>
                              )}
                            </button>
                            {index < workflowSteps.length - 1 && (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                <span style={{ color: "#94a3b8", fontWeight: 800 }}>←</span>
                                <button type="button" onClick={() => handleInsertWorkflowStepAfter(step.stepId)} title="إرفاق خطوة هنا" style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px dashed var(--population-primary)", background: "#fff", color: "var(--population-primary)", cursor: "pointer", fontWeight: 800 }}>+</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <aside
                style={{
                  border: "1px solid var(--population-border)",
                  borderRadius: "14px",
                  background: "#fff",
                  padding: "14px",
                  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
                  position: "sticky",
                  top: 0
                }}
              >
                {selectedWorkflowStep ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                      <div>
                        <strong style={{ color: "var(--population-primary)", fontSize: "15px" }}>خصائص الخطوة</strong>
                        <p style={{ margin: "4px 0 0", color: "var(--population-muted)", fontSize: "12px" }}>
                          اربط الحقول أو غيّر موضع الخطوة من هنا.
                        </p>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--population-muted)" }}>
                        <input
                          type="checkbox"
                          checked={selectedWorkflowStep.isEnabled}
                          onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { isEnabled: event.target.checked })}
                        />
                        مفعل
                      </label>
                    </div>

                    <label className="save-disk-label">
                      اسم الخطوة
                      <input
                        type="text"
                        className="save-disk-input"
                        value={selectedWorkflowStep.titleAr}
                        onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { titleAr: event.target.value })}
                      />
                    </label>

                    <label className="save-disk-label">
                      نوع الخطوة
                      <select
                        className="save-disk-input"
                        value={selectedWorkflowStep.kind}
                        onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { kind: event.target.value as ProcessingStepKind })}
                      >
                        {(Object.keys(stepKindLabels) as ProcessingStepKind[]).map((kind) => (
                          <option key={kind} value={kind}>{stepKindLabels[kind]}</option>
                        ))}
                      </select>
                    </label>

                    <label className="save-disk-label">
                      وصف الخطوة
                      <textarea
                        className="save-disk-input"
                        rows={3}
                        value={selectedWorkflowStep.descriptionAr}
                        onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { descriptionAr: event.target.value })}
                        style={{ resize: "vertical", minHeight: "72px" }}
                      />
                    </label>

                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "10px", background: "#f8fafc" }}>
                      <strong style={{ display: "block", marginBottom: "8px", color: "#334155", fontSize: "13px" }}>ربط أو إرفاق الحقول</strong>
                      <label className="save-disk-label" style={{ marginBottom: "8px" }}>
                        الحقل المصدر
                        <select
                          className="save-disk-input"
                          value={selectedWorkflowStep.sourceField ?? ""}
                          onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { sourceField: event.target.value || undefined })}
                        >
                          <option value="">بدون</option>
                          {fieldOptions.map((field) => (
                            <option key={field.key} value={field.key}>{field.label} ({field.key})</option>
                          ))}
                        </select>
                      </label>
                      <label className="save-disk-label">
                        الحقل الهدف
                        <select
                          className="save-disk-input"
                          value={selectedWorkflowStep.targetField ?? ""}
                          onChange={(event) => handleWorkflowStepChange(selectedWorkflowStep.stepId, { targetField: event.target.value || undefined })}
                        >
                          <option value="">بدون</option>
                          {fieldOptions.map((field) => (
                            <option key={field.key} value={field.key}>{field.label} ({field.key})</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => handleMoveWorkflowStep(selectedWorkflowStep.stepId, "up")}
                        disabled={workflowSteps[0]?.stepId === selectedWorkflowStep.stepId}
                      >
                        تحريك لأعلى
                      </button>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => handleMoveWorkflowStep(selectedWorkflowStep.stepId, "down")}
                        disabled={workflowSteps[workflowSteps.length - 1]?.stepId === selectedWorkflowStep.stepId}
                      >
                        تحريك لأسفل
                      </button>
                    </div>

                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => handleInsertWorkflowStepAfter(selectedWorkflowStep.stepId)}
                    >
                      إرفاق خطوة بعد هذه الخطوة
                    </button>

                    {selectedWorkflowStep.kind === "custom" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveWorkflowStep(selectedWorkflowStep.stepId)}
                        style={{ border: "none", borderRadius: "8px", background: "#fee2e2", color: "#b91c1c", padding: "9px 12px", cursor: "pointer", fontWeight: 800 }}
                      >
                        حذف الخطوة المخصصة
                      </button>
                    )}
                  </div>
                ) : (
                  <p style={{ color: "var(--population-muted)", margin: 0 }}>اختر خطوة من الخريطة لتعديلها.</p>
                )}
              </aside>
            </div>
          )}

          {activeTab === "stages" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
                حدد الكلمات أو القيم التي تعني كل مستوى. سيتم استخدام هذه القائمة في العرض، التصفية، المؤشرات، سحب العينة، والتوزيع. افصل بين القيم بفواصل.
              </p>

              {(Object.keys(stageLabels) as StageKey[]).map((stageKey) => (
                <label key={stageKey} className="save-disk-label">
                  {stageLabels[stageKey]}
                  <input
                    type="text"
                    className="save-disk-input"
                    value={(stageMappings[stageKey] || []).join(", ")}
                    onChange={(e) => handleStageMappingChange(stageKey, e.target.value)}
                  />
                </label>
              ))}

              <button
                type="button"
                className="secondary-action"
                style={{ alignSelf: "flex-start" }}
                onClick={handleResetStageMappings}
              >
                استعادة القائمة الافتراضية
              </button>
            </div>
          )}

          {activeTab === "sheets" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
                قم بتكوين الكلمات المفتاحية لمطابقة أسماء أوراق العمل (Sheets) في الملفات المرفوعة.
              </p>

              {(riskSheetNames.length > 0 || biSheetNames.length > 0) && (
                <div style={{ border: "1px solid #dbeafe", borderRadius: "12px", background: "#eff6ff", padding: "12px", display: "grid", gap: "10px" }}>
                  <strong style={{ color: "#17365d" }}>الأوراق والأعمدة المكتشفة من الملفات المرفوعة</strong>
                  {riskSheetNames.length > 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: "#334155" }}>
                      أوراق المخاطر: {riskSheetNames.join("، ")}
                    </p>
                  )}
                  {biSheetNames.length > 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: "#334155" }}>
                      أوراق BI: {biSheetNames.join("، ")}
                    </p>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <ColumnHints title="أعمدة المخاطر المطلوبة" fields={requiredFields} hints={processingContext?.riskColumnHints ?? {}} />
                    <ColumnHints title="أعمدة BI المطلوبة" fields={requiredFields} hints={processingContext?.biColumnHints ?? {}} />
                  </div>
                  <button type="button" className="secondary-action" style={{ justifySelf: "start" }} onClick={handleApplyDetectedWorkbookSettings}>
                    تطبيق الأسماء والأعمدة المكتشفة
                  </button>
                </div>
              )}

              <label className="save-disk-label">
                أنماط أسماء أوراق المخاطر (Risk Sheet Patterns)
                <input
                  type="text"
                  className="save-disk-input"
                  value={template.sheetPatterns.risk.join(", ")}
                  onChange={(e) => handleSheetPatternChange("risk", e.target.value)}
                />
              </label>

              <label className="save-disk-label">
                أنماط أسماء أوراق ذكاء الأعمال (BI Sheet Patterns)
                <input
                  type="text"
                  className="save-disk-input"
                  value={template.sheetPatterns.bi.join(", ")}
                  onChange={(e) => handleSheetPatternChange("bi", e.target.value)}
                />
              </label>
            </div>
          )}

          {activeTab === "exports" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
                تحكم في تفعيل أو تعطيل، ترتيب، وتغيير عناوين الأعمدة المخرجة عند تصدير العينات لملفات Excel.
              </p>

              <div className="report-sheet-table" role="table">
                <div className="report-sheet-header" role="row" style={{ gridTemplateColumns: "auto 2fr 2fr 1fr" }}>
                  <span>الترتيب</span>
                  <span>اسم الحقل</span>
                  <span>عنوان التصدير</span>
                  <span>مفعل</span>
                </div>

                {[...(config.exportTemplates[0]?.columns || [])]
                  .sort((a: any, b: any) => a.order - b.order)
                  .map((col: any, idx: number, arr: any[]) => (
                    <div key={col.fieldKey} className="report-sheet-row" role="row" style={{ gridTemplateColumns: "auto 2fr 2fr 1fr", alignItems: "center" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "center" }}>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveColumn(col.fieldKey, "up")}
                          style={{
                            width: "26px", height: "22px", border: "1px solid var(--population-border)",
                            borderRadius: "4px", background: idx === 0 ? "#f8fafc" : "#fff",
                            cursor: idx === 0 ? "default" : "pointer", fontSize: "11px",
                            color: idx === 0 ? "#ccc" : "var(--population-primary)", lineHeight: 1
                          }}
                          title="تحريك لأعلى"
                        >▲</button>
                        <button
                          type="button"
                          disabled={idx === arr.length - 1}
                          onClick={() => handleMoveColumn(col.fieldKey, "down")}
                          style={{
                            width: "26px", height: "22px", border: "1px solid var(--population-border)",
                            borderRadius: "4px", background: idx === arr.length - 1 ? "#f8fafc" : "#fff",
                            cursor: idx === arr.length - 1 ? "default" : "pointer", fontSize: "11px",
                            color: idx === arr.length - 1 ? "#ccc" : "var(--population-primary)", lineHeight: 1
                          }}
                          title="تحريك لأسفل"
                        >▼</button>
                      </span>

                      <span style={{ fontSize: "12px", color: "var(--population-muted)", fontFamily: "monospace" }}>
                        {col.fieldKey}
                      </span>

                      <span>
                        <input
                          type="text"
                          className="save-disk-input"
                          style={{ padding: "4px", margin: 0 }}
                          value={col.exportHeader}
                          onChange={(e) => handleExportColumnChange(col.fieldKey, "exportHeader", e.target.value)}
                        />
                      </span>

                      <span style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={col.isEnabled}
                          onChange={(e) => handleExportColumnChange(col.fieldKey, "isEnabled", e.target.checked)}
                        />
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--population-border)", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="primary-action" onClick={onClose}>
            حفظ وإغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnHints({
  title,
  fields,
  hints,
}: {
  title: string;
  fields: Array<{ key: string; labelAr: string }>;
  hints: Record<string, string[]>;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dbeafe", borderRadius: "10px", padding: "10px" }}>
      <strong style={{ display: "block", marginBottom: "8px", color: "#1e3a8a", fontSize: 12 }}>{title}</strong>
      <div style={{ display: "grid", gap: "6px" }}>
        {fields.map((field) => {
          const matches = hints[field.key] ?? [];
          return (
            <div key={field.key} style={{ display: "grid", gap: "2px", fontSize: 11 }}>
              <span style={{ color: "#334155", fontWeight: 800 }}>{field.labelAr}</span>
              <span style={{ color: matches.length > 0 ? "#166534" : "#b45309" }}>
                {matches.length > 0 ? matches.join("، ") : "لم يتم العثور على تطابق واضح"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
