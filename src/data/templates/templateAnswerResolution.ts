import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { FieldAnswer, ItemAnswer } from "../answers/answerTypes";
import { loadTemplateIncludingDeleted } from "./templateStorage";
import { getFieldsForPhase, getTemplatePhases } from "./templateRuntime";
import type { TemplateField, TemplateSchema } from "./templateTypes";

/**
 * Resolve every template actually referenced by a set of answers, not just the
 * single workspace-wide active selection (`template.selection.json`).
 *
 * Swapping the active inspection template (Template Builder "delete the old
 * one, add a new one") never touches any already-submitted `ItemAnswer` --
 * `templateId`/`templateVersion` on the answer are stamped once at answer time
 * and are untouched by `deleteTemplate`. But every consumer used to render
 * answers by looking up ONLY the currently active template, so an old answer
 * whose template is gone had nothing to resolve it against and looked like it
 * had vanished. Resolving each answer against the template it actually
 * carries fixes that without touching any stored answer data. A template
 * deleted since is recovered through its `deleteTemplate` tombstone (see
 * `loadTemplateIncludingDeleted`).
 */
export async function resolveAnswerTemplates(
  directoryHandle: DirectoryHandleLike,
  activeTemplate: TemplateSchema | null,
  answers: readonly ItemAnswer[]
): Promise<Map<string, TemplateSchema>> {
  const byId = new Map<string, TemplateSchema>();
  if (activeTemplate) byId.set(activeTemplate.templateId, activeTemplate);

  const missingIds = new Set<string>();
  for (const answer of answers) {
    if (answer.templateId && !byId.has(answer.templateId)) missingIds.add(answer.templateId);
  }

  await Promise.all(
    [...missingIds].map(async (templateId) => {
      const schema = await loadTemplateIncludingDeleted(directoryHandle, templateId);
      if (schema) byId.set(templateId, schema);
    })
  );

  return byId;
}

/** The template a specific answer was actually answered under, falling back to
 *  the active template only when the answer's own template couldn't be resolved
 *  at all (never deleted, or predates `ItemAnswer.templateId`). */
export function resolveTemplateForAnswer(
  answer: ItemAnswer | null | undefined,
  templatesById: ReadonlyMap<string, TemplateSchema>,
  fallback: TemplateSchema | null
): TemplateSchema | null {
  if (!answer) return fallback;
  return templatesById.get(answer.templateId) ?? fallback;
}

/**
 * A question's identity across template edits/rebuilds is its label text, not
 * its generated `fieldId` -- the Template Builder mints a fresh `fieldId` for
 * every field on every save, even one carrying an unchanged question, so
 * `fieldId` cannot be what "the same question" means across a template swap.
 * This mirrors `HAS_IMAGE_FIELD_LABEL` matching in `noImageAnswer.ts`, the
 * one place that already had to solve this: "matched by label, not by field
 * id: the id is generated fresh per workspace/template instance, but this
 * label is the stable, human contract".
 */
export function normalizeFieldLabel(label: string): string {
  return label.trim();
}

function answerableFields(schema: TemplateSchema): TemplateField[] {
  return getTemplatePhases(schema).flatMap((phase) =>
    getFieldsForPhase(schema, phase.phaseId).filter((field) => field.type !== "empty")
  );
}

/**
 * Every distinct question across all resolved templates, one column per
 * label, ordered active-template-first (insertion order of `templatesById`).
 *
 * Two templates that ask the same worded question -- even under different
 * `fieldId`s, even in a template built from scratch to replace a deleted one
 * -- render as ONE column here, so deleting 4 of 10 questions and rebuilding
 * the template around the other 6 keeps every old and new answer to those 6
 * lined up under the same header instead of the old ones spilling into
 * duplicate blank-looking columns.
 */
export function mergeTemplateFields(
  templatesById: ReadonlyMap<string, TemplateSchema>
): TemplateField[] {
  const seen = new Set<string>();
  const merged: TemplateField[] = [];
  for (const schema of templatesById.values()) {
    for (const field of answerableFields(schema)) {
      const key = normalizeFieldLabel(field.label);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(field);
    }
  }
  return merged;
}

/** The field id a given question label resolves to within one template, or
 *  `null` when that template never asked a question by that exact label. */
export function findFieldIdByLabel(
  template: TemplateSchema | null,
  label: string
): string | null {
  if (!template) return null;
  const key = normalizeFieldLabel(label);
  return template.fields.find((field) => normalizeFieldLabel(field.label) === key)?.fieldId ?? null;
}

/**
 * An answer's value for a question identified by LABEL rather than `fieldId`:
 * resolves the answer's own template (never the globally active one), finds
 * that template's field carrying this label, then reads the answer's stored
 * value for that field's actual (answer-time) `fieldId`. Returns `null` when
 * the answer has no value for that question -- either it never answered it,
 * or its own template never asked it under this exact label.
 */
export function getAnswerValueByLabel(
  answer: ItemAnswer | null | undefined,
  label: string,
  templatesById: ReadonlyMap<string, TemplateSchema>,
  fallback: TemplateSchema | null
): FieldAnswer["value"] | null {
  if (!answer) return null;
  const rowTemplate = resolveTemplateForAnswer(answer, templatesById, fallback);
  const fieldId = findFieldIdByLabel(rowTemplate, label);
  if (!fieldId) return null;
  return answer.answers.find((item) => item.fieldId === fieldId)?.value ?? null;
}
