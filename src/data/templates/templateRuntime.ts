import type {
  TemplateField,
  TemplateFieldCondition,
  TemplatePhase,
  TemplateSchema
} from "./templateTypes";

export type TemplateAnswerValue = string | number | boolean;

const FALLBACK_PHASE_ID = "default-phase";

/**
 * A `multiselect` answer is stored as its selected options joined by this
 * separator, NOT as an array.
 *
 * `FieldAnswer.value` is `string | number | boolean | null` and is read by the
 * report builders, the Power BI CSV export and the value-history snapshots — a
 * shape change there would have to land in every one of them at once. A joined
 * string keeps all of those readers working unchanged and stays human-readable
 * in a report cell, at the cost of a split before any per-option analytics.
 *
 * `serializeMultiValue` is the ONLY writer: it strips the separator character
 * out of the option text (so an option can never forge a boundary) and emits
 * options in the template's own declared order, so two employees who pick the
 * same set store a byte-identical string and group together when counted.
 */
export const MULTISELECT_SEPARATOR = " | ";

export function parseMultiValue(value: TemplateAnswerValue | null | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function serializeMultiValue(values: readonly string[]): string {
  return values
    .map((value) => value.replace(/\|/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .join(MULTISELECT_SEPARATOR);
}

/**
 * Toggle one option, re-emitting the result in `allOptions` order so the stored
 * string depends on WHAT was selected and never on the click order.
 */
export function toggleMultiValue(
  current: readonly string[],
  option: string,
  allOptions: readonly string[]
): string[] {
  const next = new Set(current);
  if (next.has(option)) next.delete(option);
  else next.add(option);
  const known = allOptions.filter((candidate) => next.has(candidate));
  // Anything selected that the template no longer offers (an option renamed
  // after the answer was drafted) is kept rather than silently dropped.
  const unknown = [...next].filter((candidate) => !allOptions.includes(candidate));
  return [...known, ...unknown];
}

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
    normalizeSourceValue(sourceField, answers[field.condition.sourceFieldId]),
    sourceField
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
  value: TemplateAnswerValue | undefined,
  sourceField?: TemplateField
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

  // On a multiselect source, `equals` asks "is this option among the ones
  // picked?" — comparing against the whole joined string instead would only
  // ever match when the employee happened to pick exactly one option, so a
  // dependent field would vanish the moment they picked a second.
  if (sourceField?.type === "multiselect") {
    const selected = parseMultiValue(value).includes(String(expected ?? "").trim());
    return condition.operator === "notEquals" ? !selected : selected;
  }

  if (condition.operator === "equals") return String(value) === String(expected ?? "");
  if (condition.operator === "notEquals") return String(value) !== String(expected ?? "");

  return true;
}
