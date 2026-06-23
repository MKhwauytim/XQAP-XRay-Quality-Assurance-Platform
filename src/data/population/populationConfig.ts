import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";

export type SystemField = {
  key: string;
  labelAr: string;
  isRequired: boolean;
  dataType: "string" | "date" | "number";
};

export type CustomField = {
  key: string;
  labelAr: string;
  dataType: "string" | "date" | "number";
};

export type MappingTemplate = {
  templateId: string;
  name: string;
  sheetPatterns: {
    risk: string[];
    bi: string[];
  };
  /** Column aliases used when reading the Risk data file. */
  columnMappings: Record<string, string[]>;
  /** Column aliases used when reading the BI data file. Falls back to columnMappings if absent. */
  biColumnMappings?: Record<string, string[]>;
};

export type StageKey = "first" | "second" | "third" | "fourth";

export type StageAliasMappings = Record<StageKey, string[]>;

export type ProcessingStepKind =
  | "validate-xray-id"
  | "deduplicate"
  | "bi-link"
  | "bi-fill"
  | "validate-results"
  | "certscan-match"
  | "finalize"
  | "custom";

export type ProcessingWorkflowStep = {
  stepId: string;
  kind: ProcessingStepKind;
  titleAr: string;
  descriptionAr: string;
  isEnabled: boolean;
  order: number;
  sourceField?: string;
  targetField?: string;
};

export type ProcessingWorkflowPreset = {
  presetId: string;
  nameAr: string;
  descriptionAr: string;
  steps: ProcessingWorkflowStep[];
};

export type ProcessingWorkflowConfig = {
  activePresetId: string;
  steps: ProcessingWorkflowStep[];
};

export type ExportColumnSetting = {
  fieldKey: string;
  exportHeader: string;
  isEnabled: boolean;
  order: number;
};

export type ExportTemplate = {
  templateId: string;
  name: string;
  columns: ExportColumnSetting[];
};

export type StageSamplingRule = {
  stageKey: "first" | "second" | "third" | "fourth";
  method: "percentage" | "exact";
  value: number; // percentage (0-100) or exact count
  isLocked: boolean;
  minRequiredCount: number;
  certScanPercentage: number; // CertScan target % of the stage sample
  certScanExactCount: number; // CertScan target exact count of the stage sample
  certScanMethod: "percentage" | "exact";
  certScanStrategy: "mandatory" | "preferred";
};

export type EmployeeStageAllocation = {
  username: string;
  stageKey: "first" | "second" | "third" | "fourth";
  method: "percentage" | "exact";
  value: number; // percentage (0-100) or exact count
  isActive: boolean;
  maxWorkload?: number;
};

export type PopulationConfig = {
  systemFields: SystemField[];
  customFields: CustomField[];
  mappingTemplates: MappingTemplate[];
  stageMappings: StageAliasMappings;
  processingWorkflow: ProcessingWorkflowConfig;
  exportTemplates: ExportTemplate[];
  samplingRules: StageSamplingRule[];
  employeeAllocations: EmployeeStageAllocation[];
};

const POPULATION_FOLDER = "Population";
const CONFIG_FILE = "config.json";

export const DEFAULT_SYSTEM_FIELDS: SystemField[] = [
  { key: "xrayImageId", labelAr: "معرف الأشعة", isRequired: true, dataType: "string" },
  { key: "xrayEntryDate", labelAr: "تاريخ دخول الأشعة", isRequired: false, dataType: "string" },
  { key: "portCode", labelAr: "رمز المنفذ", isRequired: false, dataType: "string" },
  { key: "portName", labelAr: "اسم المنفذ", isRequired: false, dataType: "string" },
  { key: "portType", labelAr: "نوع المنفذ", isRequired: false, dataType: "string" },
  { key: "declarationNumber", labelAr: "رقم البيان", isRequired: false, dataType: "string" },
  { key: "plateOrContainerNumber", labelAr: "رقم اللوحة/الحاوية", isRequired: false, dataType: "string" },
  { key: "chassisNumber", labelAr: "رقم الهيكل", isRequired: false, dataType: "string" },
  { key: "xrayLevelOneResult", labelAr: "نتيجة المستوى الأول", isRequired: true, dataType: "string" },
  { key: "xrayLevelTwoResult", labelAr: "نتيجة المستوى الثاني", isRequired: true, dataType: "string" },
  { key: "stage", labelAr: "المستوى", isRequired: true, dataType: "string" },
  { key: "movementType", labelAr: "نوع الحركة", isRequired: false, dataType: "string" },
  { key: "reportNumber", labelAr: "رقم المحضر", isRequired: false, dataType: "string" },
  { key: "targetedByRiskEngine", labelAr: "مستهدف محرك المخاطر", isRequired: false, dataType: "string" },
  { key: "riskMessage", labelAr: "رسالة المخاطر", isRequired: false, dataType: "string" }
];

export const DEFAULT_MAPPING_TEMPLATE: MappingTemplate = {
  templateId: "default-template",
  name: "القالب الافتراضي المدمج",
  sheetPatterns: {
    risk: ["بحري", "بري", "افراد", "عبور"],
    bi: ["وارد", "صادر"]
  },
  columnMappings: {
    xrayImageId: ["معرف الأشعة", "معرف الاشعة", "رقم صورة الأشعة", "رقم صورة الاشعة", "معرف الأشعة", "معرف الاشعة", "XRAY_SCAN_ID"],
    xrayEntryDate: ["تاريخ دخول الأشعة", "تاريخ دخول الاشعة", "تاريخ الاشعة", "تاريخ الأشعة"],
    portCode: ["رمز المنفذ", "المنفذ", "رمز الجمرك", "PORT_CD"],
    portName: ["اسم المنفذ"],
    portType: ["نوع المنفذ"],
    declarationNumber: ["رقم البيان", "رقم البيان المبدئي", "رقم بيان الترانزيت"],
    plateOrContainerNumber: ["رقم اللوحة", "رقم الحاوية", "رقم تسلسل الحاوية", "PLATE_NO", "رقم اللوحة\\الحاوية", "رقم اللوحة/الحاوية"],
    chassisNumber: ["رقم الهيكل", "رقم الشاص"],
    xrayLevelOneResult: ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الاول", "نتيجة المستوى الأول للاشعة", "نتيجة المستوى الأول للأشعة"],
    xrayLevelTwoResult: ["نتيجة المستوى الثاني", "نتيجة المستوى الثاني للاشعة", "المستوى الثاني", "نتيجة المستوى الثاني للأشعة"],
    stage: ["STAGE", "المستوى"],
    movementType: ["نوع الحركة"],
    reportNumber: ["رقم المحضر"],
    targetedByRiskEngine: ["مستهدف محرك المخاطر", "مستهدف من محرك المخاطر", "استهداف محرك مخاطر"],
    riskMessage: ["رسالة المخاطر"]
  }
};

export const DEFAULT_STAGE_MAPPINGS: StageAliasMappings = {
  first: [
    "FIRST_STAGE", "FIRST STAGE", "FIRST", "STAGE_1", "STAGE 1", "STAGE1", "1",
    "المستوى الأول", "المستوى الاول", "الأول", "الاول"
  ],
  second: [
    "SECOND_STAGE", "SECOND_STAG", "SECOND STAGE", "SECOND STAG", "SECOND", "STAGE_2", "STAGE 2", "STAGE2", "2",
    "المستوى الثاني", "الثاني"
  ],
  third: [
    "THIRD_STAGE", "THIRD STAGE", "THIRD", "STAGE_3", "STAGE 3", "STAGE3", "3",
    "المستوى الثالث", "الثالث"
  ],
  fourth: [
    "FOURTH_STAGE", "FORTH_STAGE", "FOURTH STAGE", "FORTH STAGE", "FOURTH", "FORTH", "STAGE_4", "STAGE 4", "STAGE4", "4",
    "المستوى الرابع", "الرابع"
  ]
};

export const DEFAULT_PROCESSING_WORKFLOW_STEPS: ProcessingWorkflowStep[] = [
  {
    stepId: "validate-xray-id",
    kind: "validate-xray-id",
    titleAr: "التحقق من معرف الأشعة",
    descriptionAr: "استبعاد الصفوف التي لا تحتوي على معرف أشعة صالح قبل أي ربط أو معالجة لاحقة.",
    isEnabled: true,
    order: 10,
    sourceField: "xrayImageId"
  },
  {
    stepId: "deduplicate-xray-id",
    kind: "deduplicate",
    titleAr: "إزالة التكرار",
    descriptionAr: "إبقاء أول سجل لكل معرف أشعة وإرسال السجلات المكررة إلى تقرير الاستبعاد.",
    isEnabled: true,
    order: 20,
    sourceField: "xrayImageId"
  },
  {
    stepId: "bi-link",
    kind: "bi-link",
    titleAr: "ربط المخاطر مع BI",
    descriptionAr: "مطابقة صف المخاطر مع صف BI باستخدام معرف الأشعة واسم المنفذ.",
    isEnabled: true,
    order: 30,
    sourceField: "xrayImageId",
    targetField: "portName"
  },
  {
    stepId: "bi-fill-empty-fields",
    kind: "bi-fill",
    titleAr: "تعبئة الخانات الفارغة من BI",
    descriptionAr: "تعبئة الحقول الناقصة في بيانات المخاطر من صف BI المطابق فقط عندما تكون الخانة الأصلية فارغة.",
    isEnabled: true,
    order: 40
  },
  {
    stepId: "validate-results",
    kind: "validate-results",
    titleAr: "توحيد نتائج المستوى الأول والثاني",
    descriptionAr: "تحويل قيم النتائج إلى سليمة أو اشتباه واستبعاد الصفوف التي لا يمكن فهم نتيجتها.",
    isEnabled: true,
    order: 50,
    sourceField: "xrayLevelOneResult",
    targetField: "xrayLevelTwoResult"
  },
  {
    stepId: "certscan-match",
    kind: "certscan-match",
    titleAr: "مطابقة CertScan",
    descriptionAr: "مطابقة معرف الأشعة مع قائمة CertScan حسب المنفذ لتحديد Certscan أو NonCertscan.",
    isEnabled: true,
    order: 60,
    sourceField: "xrayImageId",
    targetField: "portName"
  },
  {
    stepId: "finalize-population",
    kind: "finalize",
    titleAr: "إنشاء مجتمع المعالجة النهائي",
    descriptionAr: "إنشاء الصفوف النهائية، الملخصات، وسجلات التقارير المستخدمة في الحفظ والتصدير.",
    isEnabled: true,
    order: 70
  }
];

export const PROCESSING_WORKFLOW_PRESETS: ProcessingWorkflowPreset[] = [
  {
    presetId: "default",
    nameAr: "المعالجة الافتراضية",
    descriptionAr: "الترتيب الحالي المستخدم في النظام: تحقق، إزالة تكرار، ربط BI، تعبئة، تحقق نتائج، CertScan، ثم إنشاء المجتمع.",
    steps: DEFAULT_PROCESSING_WORKFLOW_STEPS
  },
  {
    presetId: "link-before-dedup",
    nameAr: "الربط قبل إزالة التكرار",
    descriptionAr: "تصور بديل يضع ربط BI قبل إزالة التكرار للمراجعة أو التجارب المستقبلية.",
    steps: DEFAULT_PROCESSING_WORKFLOW_STEPS.map((step) => {
      if (step.stepId === "deduplicate-xray-id") return { ...step, order: 30 };
      if (step.stepId === "bi-link") return { ...step, order: 20 };
      return step;
    })
  },
  {
    presetId: "minimal",
    nameAr: "معالجة مختصرة",
    descriptionAr: "يبقي خطوات التحقق الأساسية وإنشاء المجتمع، مع تعطيل خطوات BI وCertScan في الخريطة.",
    steps: DEFAULT_PROCESSING_WORKFLOW_STEPS.map((step) =>
      step.kind === "bi-link" || step.kind === "bi-fill" || step.kind === "certscan-match"
        ? { ...step, isEnabled: false }
        : step
    )
  }
];

export const DEFAULT_PROCESSING_WORKFLOW: ProcessingWorkflowConfig = {
  activePresetId: "default",
  steps: DEFAULT_PROCESSING_WORKFLOW_STEPS
};

export const DEFAULT_EXPORT_COLUMNS: ExportColumnSetting[] = [
  { fieldKey: "stage", exportHeader: "المستوى", isEnabled: true, order: 1 },
  { fieldKey: "xrayImageId", exportHeader: "معرف الأشعة", isEnabled: true, order: 2 },
  { fieldKey: "xrayEntryDate", exportHeader: "تاريخ دخول الأشعة", isEnabled: true, order: 3 },
  { fieldKey: "portCode", exportHeader: "رمز المنفذ", isEnabled: true, order: 4 },
  { fieldKey: "portType", exportHeader: "نوع المنفذ", isEnabled: true, order: 5 },
  { fieldKey: "portName", exportHeader: "اسم المنفذ", isEnabled: true, order: 6 },
  { fieldKey: "declarationNumber", exportHeader: "رقم البيان", isEnabled: true, order: 7 },
  { fieldKey: "plateOrContainerNumber", exportHeader: "رقم اللوحة/الحاوية", isEnabled: true, order: 8 },
  { fieldKey: "chassisNumber", exportHeader: "رقم الهيكل", isEnabled: true, order: 9 },
  { fieldKey: "xrayLevelOneResult", exportHeader: "نتيجة المستوى الأول للأشعة", isEnabled: true, order: 10 },
  { fieldKey: "xrayLevelTwoResult", exportHeader: "نتيجة المستوى الثاني للأشعة", isEnabled: true, order: 11 },
  { fieldKey: "movementType", exportHeader: "نوع الحركة", isEnabled: true, order: 12 },
  { fieldKey: "reportNumber", exportHeader: "رقم المحضر", isEnabled: true, order: 13 },
  { fieldKey: "targetedByRiskEngine", exportHeader: "مستهدف من محرك المخاطر", isEnabled: true, order: 14 },
  { fieldKey: "riskMessage", exportHeader: "رسالة المخاطر", isEnabled: true, order: 15 }
];

export const DEFAULT_SAMPLING_RULES: StageSamplingRule[] = [
  {
    stageKey: "first",
    method: "percentage",
    value: 100,
    isLocked: true,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred"
  },
  {
    stageKey: "second",
    method: "exact",
    value: 2500,
    isLocked: false,
    minRequiredCount: 2500,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred"
  },
  {
    stageKey: "third",
    method: "exact",
    value: 1875,
    isLocked: false,
    minRequiredCount: 1875,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred"
  },
  {
    stageKey: "fourth",
    method: "exact",
    value: 1875,
    isLocked: false,
    minRequiredCount: 1875,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred"
  }
];

export const DEFAULT_POPULATION_CONFIG: PopulationConfig = {
  systemFields: DEFAULT_SYSTEM_FIELDS,
  customFields: [],
  mappingTemplates: [DEFAULT_MAPPING_TEMPLATE],
  stageMappings: DEFAULT_STAGE_MAPPINGS,
  processingWorkflow: DEFAULT_PROCESSING_WORKFLOW,
  exportTemplates: [
    {
      templateId: "default-export",
      name: "تصدير افتراضي كامل",
      columns: DEFAULT_EXPORT_COLUMNS
    }
  ],
  samplingRules: DEFAULT_SAMPLING_RULES,
  employeeAllocations: []
};

export async function loadPopulationConfig(
  directoryHandle: DirectoryHandleLike | null
): Promise<PopulationConfig> {
  if (!directoryHandle) {
    return DEFAULT_POPULATION_CONFIG;
  }

  try {
    const populationDir = await directoryHandle.getDirectoryHandle(POPULATION_FOLDER, { create: false });
    const result = await safeReadJson<PopulationConfig>(populationDir, CONFIG_FILE);

    if (result.ok && result.value) {
      // Merge values to verify structure defaults
      const loaded = result.value;
      return {
        systemFields: loaded.systemFields || DEFAULT_SYSTEM_FIELDS,
        customFields: loaded.customFields || [],
        mappingTemplates: loaded.mappingTemplates || [DEFAULT_MAPPING_TEMPLATE],
        stageMappings: {
          ...DEFAULT_STAGE_MAPPINGS,
          ...(loaded.stageMappings || {})
        },
        processingWorkflow: loaded.processingWorkflow || DEFAULT_PROCESSING_WORKFLOW,
        exportTemplates: loaded.exportTemplates || [{ templateId: "default-export", name: "تصدير افتراضي كامل", columns: DEFAULT_EXPORT_COLUMNS }],
        samplingRules: loaded.samplingRules || DEFAULT_SAMPLING_RULES,
        employeeAllocations: loaded.employeeAllocations || []
      };
    }
  } catch {
    // Fail silently, write default config
    try {
      const populationDir = await directoryHandle.getDirectoryHandle(POPULATION_FOLDER, { create: true });
      await safeWriteJson(populationDir, CONFIG_FILE, DEFAULT_POPULATION_CONFIG);
    } catch {
      // directory write failed
    }
  }

  return DEFAULT_POPULATION_CONFIG;
}

export async function savePopulationConfig(
  directoryHandle: DirectoryHandleLike,
  config: PopulationConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const populationDir = await directoryHandle.getDirectoryHandle(POPULATION_FOLDER, { create: true });
    await safeWriteJson(populationDir, CONFIG_FILE, config);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error while saving config"
    };
  }
}
