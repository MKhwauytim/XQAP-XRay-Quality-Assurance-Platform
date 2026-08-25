import type { FieldAnswer, ItemAnswer } from "./answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";

/**
 * The default inspection template's image-availability gate field (see
 * `buildDefaultInspectionTemplate` in `TemplateBuilder/defaultTemplate.ts`).
 * Matched by label, not by field id: the id is generated fresh per
 * workspace/template instance, but this label is the stable, human contract
 * every default template shares.
 */
export const HAS_IMAGE_FIELD_LABEL = "هل يوجد صورة";
const NO_IMAGE_VALUE = "لا";

function hasImageFieldId(template: TemplateSchema | null): string | null {
  return template?.fields.find((field) => field.label === HAS_IMAGE_FIELD_LABEL)?.fieldId ?? null;
}

function fieldValue(answers: FieldAnswer[], fieldId: string): FieldAnswer["value"] | undefined {
  return answers.find((a) => a.fieldId === fieldId)?.value;
}

/**
 * A submitted answer that says "لا يوجد صورة" is a complete, valid submission
 * by the template's own rules (every other field becomes optional the moment
 * this one is "لا" — see defaultTemplate.ts), but it is not a finished
 * inspection: there is nothing to inspect until an image turns up. Every
 * "did this case actually complete?" display reads through this so a case
 * answered this way is never shown as done.
 */
export function isNoImageSubmission(
  answer: ItemAnswer | null | undefined,
  template: TemplateSchema | null
): boolean {
  if (!answer || answer.status !== "submitted") return false;
  const fieldId = hasImageFieldId(template);
  if (!fieldId) return false;
  return fieldValue(answer.answers, fieldId) === NO_IMAGE_VALUE;
}
