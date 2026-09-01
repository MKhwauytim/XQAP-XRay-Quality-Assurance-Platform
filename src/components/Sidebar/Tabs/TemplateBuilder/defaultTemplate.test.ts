import { describe, expect, it } from "vitest";
import { buildDefaultInspectionTemplate } from "./defaultTemplate";
import {
  MULTISELECT_SEPARATOR,
  isFieldVisible,
  serializeMultiValue,
} from "../../../../data/templates/templateRuntime";
import type { TemplateField, TemplateSchema } from "../../../../data/templates/templateTypes";

function phaseFields(schema: TemplateSchema, phaseIndex: number): TemplateField[] {
  const phases = [...(schema.phases ?? [])].sort((a, b) => a.order - b.order);
  const phaseId = phases[phaseIndex]?.phaseId;
  return schema.fields
    .filter((f) => f.phaseId === phaseId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function optionsOf(schema: TemplateSchema, label: string): string[] {
  return schema.fields.find((f) => f.label === label)?.options ?? [];
}

function fieldIdOf(schema: TemplateSchema, label: string): string {
  const field = schema.fields.find((f) => f.label === label);
  if (!field) throw new Error(`no field labelled ${label}`);
  return field.fieldId;
}

/** Phase-2 labels an employee actually sees for a given set of answers. */
function visiblePhaseTwoLabels(
  schema: TemplateSchema,
  answers: Record<string, string | number | boolean>
): string[] {
  return phaseFields(schema, 1)
    .filter((field) => isFieldVisible(field, answers, schema.fields))
    .map((field) => field.label);
}

describe("default inspection template", () => {
  const schema = buildDefaultInspectionTemplate("admin");

  it("runs image quality → customs declaration → result quality, in that order", () => {
    expect([...(schema.phases ?? [])].sort((a, b) => a.order - b.order).map((p) => p.title)).toEqual([
      "ضمان جودة الصورة",
      "تحليل البيان الجمركي",
      "ضمان جودة النتيجة",
    ]);
  });

  it("asks the declaration questions in gate → read → observe → judge order", () => {
    expect(phaseFields(schema, 1).map((f) => f.label)).toEqual([
      "هل يمكن الاطلاع على البيان",
      "نوع البيان",
      "نوع البيان (أخرى)",
      "طبيعة البضاعة المصرح بها",
      "طبيعة البضاعة المصرح بها (أخرى)",
      "طبيعة البضاعة الظاهرة بالأشعة",
      "طبيعة البضاعة الظاهرة بالأشعة (أخرى)",
      "هل الوارد مطابق للبيان الجمركي",
      "أسباب عدم المطابقة",
      "أسباب عدم المطابقة (أخرى)",
      "ملاحظات على البيان الجمركي",
    ]);
  });

  it("keeps the result-quality fields intact as the third phase", () => {
    expect(phaseFields(schema, 2).map((f) => f.label)).toEqual([
      "صحة النتيجة",
      "نوع الاشتباه",
      "تقييم الاشتباه",
      "موقع الاشتباه",
      "الاصناف المشبوهة",
      "الية التهريب المحتملة",
      "الملاحظات العامة",
    ]);
  });

  it("asks the suspicion type only when the result is flagged as a suspicion", () => {
    const validity = fieldIdOf(schema, "صحة النتيجة");
    const suspicionType = schema.fields.find((f) => f.label === "نوع الاشتباه");
    expect(suspicionType?.condition).toEqual({
      sourceFieldId: validity,
      operator: "equals",
      value: "اشتباه",
    });
    expect(suspicionType?.options).toEqual(["اشتباه أمني", "اشتباه جمركي"]);
  });

  it("records both cargo natures and the mismatch reasons as multiselect", () => {
    for (const label of [
      "طبيعة البضاعة المصرح بها",
      "طبيعة البضاعة الظاهرة بالأشعة",
      "أسباب عدم المطابقة",
    ]) {
      expect(schema.fields.find((f) => f.label === label)?.type).toBe("multiselect");
    }
  });

  it("shares one vocabulary between declared and observed cargo nature", () => {
    // Comparing the two answers is the point of the phase; a category offered
    // on one side but not the other would produce a difference that means
    // nothing about the shipment.
    const declared = optionsOf(schema, "طبيعة البضاعة المصرح بها");
    const observed = optionsOf(schema, "طبيعة البضاعة الظاهرة بالأشعة");
    expect(declared.length).toBeGreaterThan(0);
    for (const option of declared) expect(observed).toContain(option);
    // The scan-only answers exist on the observed side alone.
    expect(observed).toContain("لا يمكن التحديد");
    expect(declared).not.toContain("لا يمكن التحديد");
  });

  it("carries a single match verdict, shaped so the panel renders it segmented", () => {
    const verdict = schema.fields.find((f) => f.label === "هل الوارد مطابق للبيان الجمركي");
    expect(verdict?.type).toBe("dropdown");
    expect(verdict?.required).toBe(true);
    expect(verdict?.options).toEqual(["نعم", "لا"]);
    // Exactly one field in the phase holds this judgment — a separate "is
    // there a difference?" yes/no flag alongside it could disagree with it
    // inside one submitted answer.
    const yesNoFields = phaseFields(schema, 1).filter(
      (f) => f.options.length === 2 && f.options[0] === "نعم" && f.options[1] === "لا"
    );
    // The only other yes/no in the phase is the access gate, which asks
    // whether the declaration can be READ — not whether it matches.
    expect(yesNoFields.map((f) => f.label)).toEqual([
      "هل يمكن الاطلاع على البيان",
      "هل الوارد مطابق للبيان الجمركي",
    ]);
  });

  it("asks for mismatch reasons only when the verdict says they do not match", () => {
    const verdict = schema.fields.find((f) => f.label === "هل الوارد مطابق للبيان الجمركي");
    const reasons = schema.fields.find((f) => f.label === "أسباب عدم المطابقة");
    expect(reasons?.condition).toEqual({
      sourceFieldId: verdict?.fieldId,
      operator: "equals",
      value: "لا",
    });
  });

  it("gates the declaration phase on an image existing, through the access gate", () => {
    const hasImage = fieldIdOf(schema, "هل يوجد صورة");
    const canView = fieldIdOf(schema, "هل يمكن الاطلاع على البيان");
    // Only the gate names the image directly; isFieldVisible walks a
    // condition's source field recursively, so gating on the gate keeps the
    // "no image ⇒ no declaration work" rule for everything behind it.
    expect(phaseFields(schema, 1)[0]?.condition).toEqual({
      sourceFieldId: hasImage,
      operator: "equals",
      value: "نعم",
    });
    for (const field of phaseFields(schema, 1)) {
      if (field.fieldId === canView) continue;
      expect(field.condition?.sourceFieldId).not.toBe(hasImage);
    }
    // …and the rule still holds end to end.
    expect(visiblePhaseTwoLabels(schema, { [hasImage]: "لا" })).toEqual([]);
  });

  it("finishes the declaration phase on «لا» — one question, nothing required after it", () => {
    const hasImage = fieldIdOf(schema, "هل يوجد صورة");
    const canView = fieldIdOf(schema, "هل يمكن الاطلاع على البيان");
    const answers = { [hasImage]: "نعم", [canView]: "لا" };
    expect(visiblePhaseTwoLabels(schema, answers)).toEqual(["هل يمكن الاطلاع على البيان"]);
    // Nothing else is visible, so nothing else is required: InspectionPanel's
    // phase-completion check counts VISIBLE required fields, which makes the
    // phase complete the moment the gate is answered «لا».
    const unmet = phaseFields(schema, 1).filter(
      (f) => f.required && isFieldVisible(f, answers, schema.fields) && !answers[f.fieldId]
    );
    expect(unmet).toEqual([]);
  });

  it("re-opens the rest of the declaration phase on «نعم»", () => {
    const hasImage = fieldIdOf(schema, "هل يوجد صورة");
    const canView = fieldIdOf(schema, "هل يمكن الاطلاع على البيان");
    expect(visiblePhaseTwoLabels(schema, { [hasImage]: "نعم", [canView]: "نعم" })).toEqual([
      "هل يمكن الاطلاع على البيان",
      "نوع البيان",
      "طبيعة البضاعة المصرح بها",
      "طبيعة البضاعة الظاهرة بالأشعة",
      "هل الوارد مطابق للبيان الجمركي",
      "ملاحظات على البيان الجمركي",
    ]);
  });

  it("pairs every «أخرى» option with a free-text box revealed by picking it", () => {
    const withOther = schema.fields.filter((f) => f.options.includes("أخرى"));
    expect(withOther.length).toBeGreaterThan(0);
    for (const source of withOther) {
      const companion = schema.fields.find(
        (f) =>
          f.condition?.sourceFieldId === source.fieldId &&
          f.condition.operator === "equals" &&
          f.condition.value === "أخرى"
      );
      expect(companion, `no «أخرى» text box for ${source.label}`).toBeDefined();
      expect(companion?.type).toBe("textarea");
      expect(companion?.phaseId).toBe(source.phaseId);
      expect(companion?.required).toBe(false);
    }
  });

  it("keeps the «أخرى» box visible when a multiselect picks other categories too", () => {
    const hasImage = fieldIdOf(schema, "هل يوجد صورة");
    const canView = fieldIdOf(schema, "هل يمكن الاطلاع على البيان");
    const declared = fieldIdOf(schema, "طبيعة البضاعة المصرح بها");
    const answers = {
      [hasImage]: "نعم",
      [canView]: "نعم",
      [declared]: serializeMultiValue(["مركبات", "أخرى"]),
    };
    expect(visiblePhaseTwoLabels(schema, answers)).toContain("طبيعة البضاعة المصرح بها (أخرى)");
  });

  it("spells the «أخرى» option the same way in every field that offers it", () => {
    // A hamza-less "اخرى" in one field and "أخرى" in the next is invisible on
    // screen but makes the two answers group separately in every report.
    for (const field of schema.fields) {
      expect(field.options).not.toContain("اخرى");
    }
  });

  it("keeps the multiselect separator out of every option label", () => {
    for (const field of schema.fields) {
      for (const option of field.options) {
        expect(option).not.toContain(MULTISELECT_SEPARATOR.trim());
      }
    }
  });
});
