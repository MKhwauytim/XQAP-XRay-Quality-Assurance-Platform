import type {
  TemplateField,
  TemplateFieldCondition,
  TemplatePhase,
  TemplateSchema
} from "./templateTypes";

export type TemplateAnswerValue = string | number | boolean;

const FALLBACK_PHASE_ID = "default-phase";

export function getTemplatePhases(schema: TemplateSchema): TemplatePhase[] {
  const phases =
    schema.phases && schema.phases.length > 0
      ? schema.phases
      : [
          {
            phaseId: FALLBACK_PHASE_ID,
            title: "مرحلة الفحص",
            order: 1
          }
        ];

  return [...phases].sort((a, b) => a.order - b.order);
}

export function getFieldsForPhase(
  schema: TemplateSchema,
  phaseId: string
): TemplateField[] {
  const hasExplicitPhases = Boolean(schema.phases && schema.phases.length > 0);

  return schema.fields
    .filter((field) =>
      hasExplicitPhases
        ? (field.phaseId ?? schema.phases?.[0]?.phaseId) === phaseId
        : true
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getVisibleTemplateFields(
  schema: TemplateSchema,
  answers: Record<string, TemplateAnswerValue>
): TemplateField[] {
  return getTemplatePhases(schema).flatMap((phase) =>
    getFieldsForPhase(schema, phase.phaseId).filter((field) =>
      isFieldVisible(field, answers, schema.fields)
    )
  );
}

export function isFieldVisible(
  field: TemplateField,
  answers: Record<string, TemplateAnswerValue>,
  allFields?: TemplateField[],
  visited: Set<string> = new Set()
): boolean {
  if (!field.condition?.sourceFieldId) return true;
  // Guard against cyclical conditions (e.g. field A's visibility depends on
  // field B, and B's depends on A). The Template Builder UI only prevents a
  // field from depending on itself directly, not on a transitive cycle, so
  // this recursion must be defensive rather than assume a DAG.
  if (allFields && !visited.has(field.fieldId)) {
    visited.add(field.fieldId);
    const src = allFields.find((f) => f.fieldId === field.condition!.sourceFieldId);
    if (src && !isFieldVisible(src, answers, allFields, visited)) return false;
  }
  return evaluateCondition(field.condition, answers[field.condition.sourceFieldId]);
}

function evaluateCondition(
  condition: TemplateFieldCondition,
  value: TemplateAnswerValue | undefined
): boolean {
  if (condition.operator === "truthy") return Boolean(value);
  if (condition.operator === "falsy") return !value;

  const expected = condition.value;
  if (condition.operator === "equals") return String(value ?? "") === String(expected ?? "");
  if (condition.operator === "notEquals") return String(value ?? "") !== String(expected ?? "");

  return true;
}
