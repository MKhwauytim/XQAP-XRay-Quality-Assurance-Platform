import type { ExecutiveReportRow } from "../../reporting/executiveReportTypes";
import { FACT_FIELDS, type FieldMeta } from "./fieldCatalog";

export type TableId = "fact" | "portProfiles" | "stageProfiles";
export type DataModelTable = {
  label: string;
  fields: FieldMeta[];
  rows: Array<Record<string, unknown>>;
};
export type DataModel = { tables: Record<TableId, DataModelTable> };

function inferFields(rows: Array<Record<string, unknown>>): FieldMeta[] {
  const sample = rows[0] ?? {};
  return Object.keys(sample).map((field) => {
    const v = sample[field];
    const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
    return { field, label: field, role: type === "number" ? "measure" : "dimension", type };
  });
}

export function buildDataModel(input: {
  factRows: ExecutiveReportRow[];
  portProfiles: Array<Record<string, unknown>>;
  stageProfiles: Array<Record<string, unknown>>;
}): DataModel {
  return {
    tables: {
      fact: {
        label: "بيانات الصور (تفصيلي)",
        fields: FACT_FIELDS,
        rows: input.factRows as unknown as Array<Record<string, unknown>>,
      },
      portProfiles: {
        label: "ملخص الموانئ",
        fields: inferFields(input.portProfiles),
        rows: input.portProfiles,
      },
      stageProfiles: {
        label: "ملخص المراحل",
        fields: inferFields(input.stageProfiles),
        rows: input.stageProfiles,
      },
    },
  };
}
