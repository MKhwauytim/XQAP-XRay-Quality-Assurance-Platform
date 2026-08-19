import { describe, expect, it } from "vitest";
import { buildDefaultInspectionTemplate } from "./defaultTemplate";
import { MULTISELECT_SEPARATOR } from "../../../../data/templates/templateRuntime";
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

describe("default inspection template", () => {
  const schema = buildDefaultInspectionTemplate("admin");

  it("runs image quality → customs declaration → result quality, in that order", () => {
    expect([...(schema.phases ?? [])].sort((a, b) => a.order - b.order).map((p) => p.title)).toEqual([
      "ضمان جودة الصورة",
      "تحليل البيان الجمركي",
      "ضمان جودة النتيجة",
    ]);
  });

  it("asks the declaration questions in read → observe → judge order", () => {
    expect(phaseFields(schema, 1).map((f) => f.label)).toEqual([
      "نوع البيان",
      "طبيعة البضاعة المصرح بها",
      "طبيعة البضاعة الظاهرة بالأشعة",
      "هل الوارد مطابق للبيان الجمركي",
      "أسباب عدم المطابقة",
      "ملاحظات على البيان الجمركي",
    ]);
  });

  it("keeps the result-quality fields intact as the third phase", () => {
    expect(phaseFields(schema, 2).map((f) => f.label)).toEqual([
      "صحة النتيجة",
      "تقييم الاشتباه",
      "موقع الاشتباه",
      "الاصناف المشبوهة",
      "الية التهريب المحتملة",
      "الملاحظات العامة",
    ]);
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
    expect(yesNoFields.map((f) => f.label)).toEqual(["هل الوارد مطابق للبيان الجمركي"]);
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

  it("gates the whole declaration phase on an image existing", () => {
    const hasImage = schema.fields.find((f) => f.label === "هل يوجد صورة");
    const gatedOnImage = { sourceFieldId: hasImage?.fieldId, operator: "equals", value: "نعم" };
    const reasons = schema.fields.find((f) => f.label === "أسباب عدم المطابقة");
    for (const field of phaseFields(schema, 1)) {
      if (field.fieldId === reasons?.fieldId) continue;
      expect(field.condition).toEqual(gatedOnImage);
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
