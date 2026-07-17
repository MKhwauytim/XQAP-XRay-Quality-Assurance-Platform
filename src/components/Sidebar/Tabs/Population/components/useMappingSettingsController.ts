import { useEffect, useState } from "react";
import type {
  CustomField,
  ExportColumnSetting,
  MappingTemplate,
  PopulationConfig,
  ProcessingWorkflowStep,
  ProcessingStepKind,
  StageAliasMappings,
  StageKey,
} from "../../../../../data/population/populationConfig";
import {
  DEFAULT_PROCESSING_WORKFLOW,
  DEFAULT_STAGE_MAPPINGS,
  PROCESSING_WORKFLOW_PRESETS,
} from "../../../../../data/population/populationConfig";
import type { PendingFieldRemoval } from "./ColumnMappingsSection";
import type { MappingSettingsTab } from "./MappingSettingsTabBar";
import {
  mergeMappingAliases,
  normalizeWorkflowOrders,
  parseMappingAliases,
} from "./mappingSettingsConfig";

export type MappingSettingsProcessingContext = {
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

type ControllerOptions = {
  isOpen: boolean;
  mode: "mapping" | "processing";
  config: PopulationConfig;
  onConfigChange: (config: PopulationConfig) => void;
  processingContext?: MappingSettingsProcessingContext;
};

export function useMappingSettingsController({
  isOpen,
  mode,
  config,
  onConfigChange,
  processingContext,
}: ControllerOptions) {
  const [activeTab, setActiveTab] = useState<MappingSettingsTab>("mappings");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newStepTitle, setNewStepTitle] = useState("");
  const [selectedWorkflowStepId, setSelectedWorkflowStepId] = useState<
    string | null
  >(null);
  const [processingMapView, setProcessingMapView] = useState<
    "topDown" | "horizontal"
  >("topDown");
  const [pendingRemoval, setPendingRemoval] =
    useState<PendingFieldRemoval | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the mounted modal resets to its requested initial surface whenever it opens
    setActiveTab(mode === "processing" ? "processing" : "mappings");
  }, [isOpen, mode]);

  const template: MappingTemplate = config.mappingTemplates[0] ?? {
    templateId: "default-template",
    name: "قالب مخصص",
    sheetPatterns: { risk: [], bi: [] },
    columnMappings: {},
  };
  const stageMappings = config.stageMappings ?? DEFAULT_STAGE_MAPPINGS;
  const workflow = config.processingWorkflow ?? DEFAULT_PROCESSING_WORKFLOW;
  const workflowSteps = [...workflow.steps].sort((a, b) => a.order - b.order);
  const selectedWorkflowStep =
    workflowSteps.find((step) => step.stepId === selectedWorkflowStepId) ??
    workflowSteps[0] ??
    null;
  const fieldOptions = [
    ...config.systemFields.map((field) => ({
      key: field.key,
      label: field.labelAr,
    })),
    ...config.customFields.map((field) => ({
      key: field.key,
      label: field.labelAr,
    })),
  ];
  const stepKindLabels: Record<ProcessingStepKind, string> = {
    "validate-xray-id": "تحقق معرف",
    deduplicate: "إزالة تكرار",
    "bi-link": "ربط BI",
    "bi-fill": "تعبئة BI",
    "validate-results": "تحقق النتائج",
    "certscan-match": "مطابقة CertScan",
    finalize: "إنشاء نهائي",
    custom: "مخصص",
  };
  const dataSourceCards = [
    {
      id: "risk",
      label: "ملف المخاطر",
      detail: processingContext?.riskFileName ?? "لم يتم رفع ملف",
      meta:
        processingContext?.riskRows !== null &&
        processingContext?.riskRows !== undefined
          ? `${processingContext.riskRows.toLocaleString("ar-SA-u-nu-latn")} صف`
          : "بانتظار القراءة",
      isReady: Boolean(processingContext?.riskFileName),
      feeds: ["validate-xray-id", "deduplicate", "bi-link", "validate-results"],
    },
    {
      id: "bi",
      label: "ملف BI",
      detail: processingContext?.biFileName ?? "اختياري - لم يتم رفع ملف",
      meta:
        processingContext?.biRows !== null &&
        processingContext?.biRows !== undefined
          ? `${processingContext.biRows.toLocaleString("ar-SA-u-nu-latn")} صف`
          : "يستخدم للتعبئة والربط",
      isReady: Boolean(processingContext?.biFileName),
      feeds: ["bi-link", "bi-fill"],
    },
    {
      id: "certscan",
      label: "قائمة CertScan",
      detail: processingContext?.certScanProvided
        ? "تم إدخال بيانات CertScan"
        : "لم يتم إدخال بيانات",
      meta: "تغذي خطوة المطابقة",
      isReady: Boolean(processingContext?.certScanProvided),
      feeds: ["certscan-match"],
    },
  ];
  const riskSheetNames = processingContext?.riskSheetNames ?? [];
  const biSheetNames = processingContext?.biSheetNames ?? [];

  const updateTemplate = (patch: Partial<MappingTemplate>) => {
    onConfigChange({
      ...config,
      mappingTemplates: config.mappingTemplates.map((item) =>
        item.templateId === template.templateId ? { ...item, ...patch } : item,
      ),
    });
  };

  const handleApplyDetectedWorkbookSettings = () => {
    updateTemplate({
      sheetPatterns: {
        risk:
          riskSheetNames.length > 0
            ? riskSheetNames
            : template.sheetPatterns.risk,
        bi:
          biSheetNames.length > 0 ? biSheetNames : template.sheetPatterns.bi,
      },
      columnMappings: mergeMappingAliases(
        template.columnMappings,
        processingContext?.riskColumnHints,
      ),
      biColumnMappings: mergeMappingAliases(
        template.biColumnMappings ?? template.columnMappings,
        processingContext?.biColumnHints,
      ),
    });
  };

  const handleMappingChange = (fieldKey: string, value: string) => {
    updateTemplate({
      columnMappings: {
        ...template.columnMappings,
        [fieldKey]: parseMappingAliases(value),
      },
    });
  };

  const handleBiMappingChange = (fieldKey: string, value: string) => {
    updateTemplate({
      biColumnMappings: {
        ...template.biColumnMappings,
        [fieldKey]: parseMappingAliases(value),
      },
    });
  };

  const handleSheetPatternChange = (type: "risk" | "bi", value: string) => {
    updateTemplate({
      sheetPatterns: {
        ...template.sheetPatterns,
        [type]: parseMappingAliases(value),
      },
    });
  };

  const handleStageMappingChange = (stageKey: StageKey, value: string) => {
    const updatedStageMappings: StageAliasMappings = {
      ...stageMappings,
      [stageKey]: parseMappingAliases(value),
    };
    onConfigChange({ ...config, stageMappings: updatedStageMappings });
  };

  const handleWorkflowStepChange = (
    stepId: string,
    patch: Partial<ProcessingWorkflowStep>,
  ) => {
    const steps = workflow.steps.map((step) =>
      step.stepId === stepId ? { ...step, ...patch } : step,
    );
    onConfigChange({
      ...config,
      processingWorkflow: { ...workflow, activePresetId: "custom", steps },
    });
  };

  const handleMoveWorkflowStep = (stepId: string, direction: "up" | "down") => {
    const index = workflowSteps.findIndex((step) => step.stepId === stepId);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= workflowSteps.length) return;
    const nextSteps = [...workflowSteps];
    [nextSteps[index], nextSteps[swapIndex]] = [
      nextSteps[swapIndex]!,
      nextSteps[index]!,
    ];
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: normalizeWorkflowOrders(nextSteps),
      },
    });
  };

  const handleApplyWorkflowPreset = (presetId: string) => {
    const preset = PROCESSING_WORKFLOW_PRESETS.find(
      (item) => item.presetId === presetId,
    );
    if (!preset) return;
    onConfigChange({
      ...config,
      processingWorkflow: {
        activePresetId: preset.presetId,
        steps: preset.steps.map((step) => ({ ...step })),
      },
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
      stepId: `custom-${crypto.randomUUID().slice(0, 8)}`,
      kind: "custom",
      titleAr: title,
      descriptionAr: "خطوة مخصصة ضمن خريطة المعالجة.",
      isEnabled: true,
      order:
        workflowSteps.length > 0
          ? workflowSteps[workflowSteps.length - 1]!.order + 10
          : 10,
    };
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: [...workflow.steps, nextStep],
      },
    });
    setNewStepTitle("");
  };

  const handleRemoveWorkflowStep = (stepId: string) => {
    const steps = normalizeWorkflowOrders(
      workflowSteps.filter((step) => step.stepId !== stepId),
    );
    onConfigChange({
      ...config,
      processingWorkflow: { ...workflow, activePresetId: "custom", steps },
    });
    setSelectedWorkflowStepId(steps[0]?.stepId ?? null);
  };

  const handleInsertWorkflowStepAfter = (afterStepId: string) => {
    const afterIndex = workflowSteps.findIndex(
      (step) => step.stepId === afterStepId,
    );
    const nextStep: ProcessingWorkflowStep = {
      stepId: `custom-${crypto.randomUUID().slice(0, 8)}`,
      kind: "custom",
      titleAr: "خطوة مخصصة",
      descriptionAr: "خطوة مخصصة مرتبطة بهذا الموضع في خريطة المعالجة.",
      isEnabled: true,
      order:
        afterIndex >= 0
          ? workflowSteps[afterIndex]!.order + 1
          : workflowSteps.length * 10 + 10,
    };
    const nextSteps = [...workflowSteps];
    nextSteps.splice(afterIndex + 1, 0, nextStep);
    onConfigChange({
      ...config,
      processingWorkflow: {
        ...workflow,
        activePresetId: "custom",
        steps: normalizeWorkflowOrders(nextSteps),
      },
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
    if (
      config.systemFields.some((field) => field.key === key) ||
      config.customFields.some((field) => field.key === key)
    ) {
      alert("اسم الكود هذا مستخدم بالفعل.");
      return;
    }
    const newField: CustomField = { key, labelAr, dataType: "string" };
    const newExportColumn: ExportColumnSetting = {
      fieldKey: key,
      exportHeader: labelAr,
      isEnabled: true,
      order: config.exportTemplates[0]?.columns.length + 1 || 20,
    };
    onConfigChange({
      ...config,
      customFields: [...config.customFields, newField],
      mappingTemplates: config.mappingTemplates.map((item) =>
        item.templateId === template.templateId
          ? {
              ...item,
              columnMappings: {
                ...template.columnMappings,
                [key]: [labelAr],
              },
            }
          : item,
      ),
      exportTemplates: config.exportTemplates.map((item) => ({
        ...item,
        columns: [...item.columns, newExportColumn],
      })),
    });
    setNewFieldName("");
    setNewFieldLabel("");
  };

  const removeField = (key: string, kind: "system" | "custom") => {
    const columnMappings = { ...template.columnMappings };
    delete columnMappings[key];
    onConfigChange({
      ...config,
      ...(kind === "system"
        ? { systemFields: config.systemFields.filter((field) => field.key !== key) }
        : { customFields: config.customFields.filter((field) => field.key !== key) }),
      mappingTemplates: config.mappingTemplates.map((item) =>
        item.templateId === template.templateId
          ? { ...item, columnMappings }
          : item,
      ),
      exportTemplates: config.exportTemplates.map((item) => ({
        ...item,
        columns: item.columns.filter((column) => column.fieldKey !== key),
      })),
    });
  };

  const handleMoveColumn = (fieldKey: string, direction: "up" | "down") => {
    const sorted = [...(config.exportTemplates[0]?.columns ?? [])].sort(
      (a, b) => a.order - b.order,
    );
    const index = sorted.findIndex((column) => column.fieldKey === fieldKey);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const nextColumns = [...sorted];
    const currentOrder = nextColumns[index]!.order;
    nextColumns[index] = { ...nextColumns[index]!, order: nextColumns[swapIndex]!.order };
    nextColumns[swapIndex] = { ...nextColumns[swapIndex]!, order: currentOrder };
    onConfigChange({
      ...config,
      exportTemplates: config.exportTemplates.map((item) => ({
        ...item,
        columns: nextColumns,
      })),
    });
  };

  const handleExportColumnChange = (
    fieldKey: string,
    field: keyof ExportColumnSetting,
    value: ExportColumnSetting[keyof ExportColumnSetting],
  ) => {
    if (!config.exportTemplates[0]) return;
    const columns = config.exportTemplates[0].columns.map((column) =>
      column.fieldKey === fieldKey ? { ...column, [field]: value } : column,
    );
    onConfigChange({
      ...config,
      exportTemplates: config.exportTemplates.map((item) => ({
        ...item,
        columns,
      })),
    });
  };

  return {
    activeTab,
    setActiveTab,
    newFieldName,
    setNewFieldName,
    newFieldLabel,
    setNewFieldLabel,
    newStepTitle,
    setNewStepTitle,
    selectedWorkflowStepId,
    setSelectedWorkflowStepId,
    processingMapView,
    setProcessingMapView,
    pendingRemoval,
    setPendingRemoval,
    template,
    stageMappings,
    workflow,
    workflowSteps,
    selectedWorkflowStep,
    fieldOptions,
    stepKindLabels,
    dataSourceCards,
    riskSheetNames,
    biSheetNames,
    handleApplyDetectedWorkbookSettings,
    handleMappingChange,
    handleBiMappingChange,
    handleSheetPatternChange,
    handleStageMappingChange,
    handleResetStageMappings: () =>
      onConfigChange({ ...config, stageMappings: DEFAULT_STAGE_MAPPINGS }),
    handleWorkflowStepChange,
    handleMoveWorkflowStep,
    handleApplyWorkflowPreset,
    handleAddWorkflowStep,
    handleRemoveWorkflowStep,
    handleInsertWorkflowStepAfter,
    handleAddCustomField,
    handleToggleSystemFieldRequired: (key: string) =>
      onConfigChange({
        ...config,
        systemFields: config.systemFields.map((field) =>
          field.key === key
            ? { ...field, isRequired: !field.isRequired }
            : field,
        ),
      }),
    handleRemoveSystemField: (key: string) => removeField(key, "system"),
    handleRemoveCustomField: (key: string) => removeField(key, "custom"),
    handleMoveColumn,
    handleExportColumnChange,
  };
}
