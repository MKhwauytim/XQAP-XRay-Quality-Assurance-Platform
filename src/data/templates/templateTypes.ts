export type TemplateFieldType =
  | "text"
  | "textarea"
  | "number"
  | "dropdown"
  | "combobox"
  | "checkbox"
  | "date"
  | "empty";

export type TemplateFieldConditionOperator =
  | "equals"
  | "notEquals"
  | "truthy"
  | "falsy";

export type TemplateFieldCondition = {
  sourceFieldId: string;
  operator: TemplateFieldConditionOperator;
  value?: string | number | boolean;
};

export type TemplatePhase = {
  phaseId: string;
  title: string;
  description?: string;
  order: number;
};

export type TemplateField = {
  fieldId: string;
  phaseId?: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  options: string[];
  placeholder?: string;
  condition?: TemplateFieldCondition | null;
  order?: number;
};

export type TemplateSchema = {
  templateId: string;
  templateName: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  phases?: TemplatePhase[];
  fields: TemplateField[];
};

export type TemplateIndex = {
  templates: Array<{
    templateId: string;
    templateName: string;
    version: number;
    updatedAt: string;
  }>;
};
