export type TemplateFieldType =
  | "text"
  | "number"
  | "dropdown"
  | "checkbox"
  | "date";

export type TemplateField = {
  fieldId: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  options: string[];
  placeholder?: string;
};

export type TemplateSchema = {
  templateId: string;
  templateName: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
