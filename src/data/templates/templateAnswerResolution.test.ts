import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { ItemAnswer } from "../answers/answerTypes";
import type { TemplateField, TemplateSchema } from "./templateTypes";
import { deleteTemplate, saveTemplate } from "./templateStorage";
import {
  findFieldIdByLabel,
  getAnswerValueByLabel,
  mergeTemplateFields,
  resolveAnswerTemplates,
  resolveTemplateForAnswer,
} from "./templateAnswerResolution";

function field(partial: Partial<TemplateField> & Pick<TemplateField, "fieldId" | "type">): TemplateField {
  return { label: partial.fieldId, required: false, options: [], ...partial };
}

function templateOf(templateId: string, templateName: string, fields: TemplateField[]): TemplateSchema {
  return {
    templateId,
    templateName,
    version: 1,
    createdAt: "2026-08-18T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-08-18T00:00:00.000Z",
    updatedBy: "admin",
    fields,
  };
}

function answerOf(templateId: string, answers: ItemAnswer["answers"]): ItemAnswer {
  return {
    xrayImageId: "img-1",
    templateId,
    templateVersion: 1,
    answers,
    lastSavedAt: "2026-08-18T00:00:00.000Z",
    submittedAt: "2026-08-18T00:00:00.000Z",
    answeredBy: "employee1",
    status: "submitted",
  };
}

describe("templateAnswerResolution — deleted-and-replaced template scenario", () => {
  it("resolves an answer submitted under a template that has since been deleted", async () => {
    const root = createMemoryDirectory();

    // The reported scenario: an admin builds a template, employees answer
    // against it, then the admin deletes it and creates a brand-new one with
    // "the same" questions plus one extra -- the Template Builder mints fresh
    // fieldIds even for identical-looking questions, so the old and new
    // templates never share a fieldId even when the wording is unchanged.
    const oldTemplate = templateOf("tmpl-old", "قالب الفحص", [
      field({ fieldId: "fld-old-result", type: "dropdown", label: "نتيجة الفحص" }),
    ]);
    await saveTemplate(root, oldTemplate);

    const oldAnswer = answerOf("tmpl-old", [{ fieldId: "fld-old-result", value: "سليم" }]);

    await deleteTemplate(root, "tmpl-old");

    const newTemplate = templateOf("tmpl-new", "قالب الفحص", [
      // Same wording as the old template's question, brand-new fieldId.
      field({ fieldId: "fld-new-result", type: "dropdown", label: "نتيجة الفحص" }),
      field({ fieldId: "fld-new-extra", type: "text", label: "سؤال إضافي" }),
    ]);

    const templatesById = await resolveAnswerTemplates(root, newTemplate, [oldAnswer]);

    // Both the active template and the deleted one the old answer references
    // must resolve -- this is what "don't lose the old answer data" requires.
    expect(templatesById.has("tmpl-new")).toBe(true);
    expect(templatesById.has("tmpl-old")).toBe(true);
    expect(templatesById.get("tmpl-old")?.templateName).toBe("قالب الفحص");

    // The old answer must be rendered against ITS OWN template, not the new one.
    const rowTemplate = resolveTemplateForAnswer(oldAnswer, templatesById, newTemplate);
    expect(rowTemplate?.templateId).toBe("tmpl-old");

    // Same wording => ONE merged column, not two, so the old answer lines up
    // under the same header the new template's identical question uses.
    const merged = mergeTemplateFields(templatesById);
    expect(merged.map((f) => f.label)).toEqual(["نتيجة الفحص", "سؤال إضافي"]);

    // And the value actually reads back through that shared label, resolved
    // against the OLD answer's own fieldId, not the new template's.
    expect(getAnswerValueByLabel(oldAnswer, "نتيجة الفحص", templatesById, newTemplate)).toBe("سليم");
    // The new question the old template never asked reads back nothing, not
    // a crash and not the wrong field.
    expect(getAnswerValueByLabel(oldAnswer, "سؤال إضافي", templatesById, newTemplate)).toBeNull();
  });

  it("falls back to the active template when an answer's own template can't be resolved at all", async () => {
    const root = createMemoryDirectory();
    const activeTemplate = templateOf("tmpl-active", "قالب حالي", [
      field({ fieldId: "fld-a", type: "text" }),
    ]);
    const orphanAnswer = answerOf("tmpl-nonexistent", [{ fieldId: "fld-x", value: "y" }]);

    const templatesById = await resolveAnswerTemplates(root, activeTemplate, [orphanAnswer]);
    expect(templatesById.has("tmpl-nonexistent")).toBe(false);

    const rowTemplate = resolveTemplateForAnswer(orphanAnswer, templatesById, activeTemplate);
    expect(rowTemplate?.templateId).toBe("tmpl-active");
  });

  it("resolveTemplateForAnswer returns the fallback for a null answer", () => {
    const activeTemplate = templateOf("tmpl-active", "قالب حالي", []);
    expect(resolveTemplateForAnswer(null, new Map(), activeTemplate)).toBe(activeTemplate);
  });

  it("mergeTemplateFields dedupes by LABEL (not fieldId) across templates, active-first order", () => {
    const shared = field({ fieldId: "fld-shared-v1", type: "text", label: "نفس السؤال", order: 1 });
    const sharedRebuilt = field({ fieldId: "fld-shared-v2", type: "text", label: "نفس السؤال", order: 1 });
    const active = templateOf("tmpl-active", "نشط", [sharedRebuilt]);
    const historical = templateOf("tmpl-old", "قديم", [
      shared,
      field({ fieldId: "fld-only-old", type: "text", label: "سؤال قديم فقط", order: 2 }),
    ]);

    const templatesById = new Map([
      ["tmpl-active", active],
      ["tmpl-old", historical],
    ]);
    const merged = mergeTemplateFields(templatesById);
    // Active template's version of the shared question wins (kept first),
    // the old-only question still gets a column of its own.
    expect(merged.map((f) => f.label)).toEqual(["نفس السؤال", "سؤال قديم فقط"]);
    expect(merged[0].fieldId).toBe("fld-shared-v2");
  });

  it("findFieldIdByLabel returns null for a template that never asked that question, and null for a null template", () => {
    const template = templateOf("tmpl-a", "أ", [field({ fieldId: "fld-a", type: "text", label: "سؤال" })]);
    expect(findFieldIdByLabel(template, "سؤال")).toBe("fld-a");
    expect(findFieldIdByLabel(template, "سؤال غير موجود")).toBeNull();
    expect(findFieldIdByLabel(null, "سؤال")).toBeNull();
  });

  it("getAnswerValueByLabel returns null for a null answer", () => {
    expect(getAnswerValueByLabel(null, "سؤال", new Map(), null)).toBeNull();
  });
});
