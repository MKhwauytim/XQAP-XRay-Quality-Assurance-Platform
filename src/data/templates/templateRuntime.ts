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
  const sourceField = allFields?.find((f) => f.fieldId === field.condition!.sourceFieldId);
  if (allFields && !visited.has(field.fieldId)) {
    visited.add(field.fieldId);
    if (sourceField && !isFieldVisible(sourceField, answers, allFields, visited)) return false;
  }
  return evaluateCondition(
    field.condition,
    normalizeSourceValue(sourceField, answers[field.condition.sourceFieldId])
  );
}

/**
 * An unanswered checkbox is `false`, not "no answer".
 *
 * Every other field type renders empty until the employee touches it, so
 * "absent" and "unanswered" agree. A checkbox does not: InspectionPanel renders
 * it `checked={Boolean(value)}`, so an untouched box is on screen as visibly
 * UNTICKED while `answers[fieldId]` is still `undefined`. Without this, a
 * condition the Template Builder writes as `equals false` ("show when the box is
 * NOT ticked") stayed hidden until the employee ticked and unticked the box, and
 * its mirror `notEquals false` showed on a fresh form. Reading the absent answer
 * as the `false` the UI is already displaying makes the predicate agree with the
 * control.
 */
function normalizeSourceValue(
  sourceField: TemplateField | undefined,
  value: TemplateAnswerValue | undefined
): TemplateAnswerValue | undefined {
  return value === undefined && sourceField?.type === "checkbox" ? false : value;
}

function evaluateCondition(
  condition: TemplateFieldCondition,
  value: TemplateAnswerValue | undefined
): boolean {
  if (condition.operator === "truthy") return Boolean(value);
  if (condition.operator === "falsy") return !value;

  // An unanswered source satisfies NEITHER branch of an equality test: the
  // employee has not said what it is yet, so no value-comparison can be true.
  // Collapsing `undefined` to "" made `notEquals X` fire on every fresh form,
  // showing (and, when required, gating on) a field whose branch had not been
  // chosen — and `collect()` persists exactly the fields this predicate returns,
  // so the branch that SHOULD have been asked was never stored.
  if (value === undefined) return false;

  const expected = condition.value;
  if (condition.operator === "equals") return String(value) === String(expected ?? "");
  if (condition.operator === "notEquals") return String(value) !== String(expected ?? "");

  return true;
}
