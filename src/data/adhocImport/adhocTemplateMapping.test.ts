import { describe, expect, it } from "vitest";

import { parseMultiValue, serializeMultiValue } from "../templates/templateRuntime";
import type { TemplateField, TemplateFieldType, TemplateSchema } from "../templates/templateTypes";
import type { FieldSource } from "./adhocImportModel";
import {
  autoDetectTemplateMapping,
  buildFieldAnswers,
  coerceTemplateValue,
  detectTemplateHeaderCandidates,
} from "./adhocTemplateMapping";

function makeField(
  fieldId: string,
  label: string,
  type: TemplateFieldType,
  options: string[] = [],
  required = false
): TemplateField {
  return { fieldId, label, type, required, options };
}

function makeSchema(fields: TemplateField[]): TemplateSchema {
  return {
    templateId: "tpl-1",
    templateName: "قالب اختبار",
    version: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-08-21T00:00:00.000Z",
    updatedBy: "admin",
    fields,
  };
}

describe("coerceTemplateValue — text / textarea / date", () => {
  it("trims a text value and nulls a blank one", () => {
    const field = makeField("f1", "ملاحظة", "text");
    expect(coerceTemplateValue(field, "  قيمة  ")).toEqual({ ok: true, value: "قيمة" });
    expect(coerceTemplateValue(field, "   ")).toEqual({ ok: true, value: null });
    expect(coerceTemplateValue(field, null)).toEqual({ ok: true, value: null });
  });

  it("trims a textarea value", () => {
    const field = makeField("f2", "شرح", "textarea");
    expect(coerceTemplateValue(field, " سطر\nسطر ")).toEqual({ ok: true, value: "سطر\nسطر" });
  });

  it("keeps a date exactly as the file wrote it", () => {
    const field = makeField("f3", "تاريخ الفحص", "date");
    expect(coerceTemplateValue(field, " 15/03/1447 ")).toEqual({ ok: true, value: "15/03/1447" });
  });
});

describe("coerceTemplateValue — number", () => {
  const field = makeField("n1", "عدد الطرود", "number");

  it("parses a plain and a thousands-separated number", () => {
    expect(coerceTemplateValue(field, "42")).toEqual({ ok: true, value: 42 });
    expect(coerceTemplateValue(field, "1,234")).toEqual({ ok: true, value: 1234 });
    expect(coerceTemplateValue(field, "1٬234")).toEqual({ ok: true, value: 1234 });
  });

  it("parses Arabic-Indic digits", () => {
    expect(coerceTemplateValue(field, "١٢٣")).toEqual({ ok: true, value: 123 });
    expect(coerceTemplateValue(field, "٣٫٥")).toEqual({ ok: true, value: 3.5 });
  });

  it("rejects non-numeric text and names it", () => {
    const result = coerceTemplateValue(field, "غير معروف");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("غير معروف");
  });
});

describe("coerceTemplateValue — checkbox", () => {
  const field = makeField("c1", "تم التفتيش", "checkbox");

  it("accepts the Arabic and Latin truthy/falsy tokens", () => {
    for (const raw of ["نعم", "صح", "true", "TRUE", "1", "✓", "y", "yes"]) {
      expect(coerceTemplateValue(field, raw)).toEqual({ ok: true, value: true });
    }
    for (const raw of ["لا", "خطأ", "خطا", "false", "0", "n", "no"]) {
      expect(coerceTemplateValue(field, raw)).toEqual({ ok: true, value: false });
    }
  });

  it("rejects anything else", () => {
    const result = coerceTemplateValue(field, "ربما");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ربما");
  });

  it("treats a blank cell as unanswered rather than false", () => {
    expect(coerceTemplateValue(field, "")).toEqual({ ok: true, value: null });
  });
});

describe("coerceTemplateValue — dropdown vs combobox", () => {
  const options = ["الأولى", "الثانية"];
  const dropdown = makeField("d1", "الدرجة", "dropdown", options);
  const combobox = makeField("cb1", "الدرجة", "combobox", options);

  it("resolves a dropdown value exactly and after folding", () => {
    expect(coerceTemplateValue(dropdown, "الأولى")).toEqual({ ok: true, value: "الأولى" });
    // Folded: bare alef for hamza-alef — canonical spelling comes back.
    expect(coerceTemplateValue(dropdown, " الاولى ")).toEqual({ ok: true, value: "الأولى" });
  });

  it("rejects an unknown dropdown value, naming it and the options", () => {
    const result = coerceTemplateValue(dropdown, "الخامسة");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("الخامسة");
      expect(result.reason).toContain("الأولى");
      expect(result.reason).toContain("الثانية");
    }
  });

  it("keeps an unmatched combobox value while the dropdown rejects it", () => {
    expect(coerceTemplateValue(combobox, "الخامسة")).toEqual({ ok: true, value: "الخامسة" });
    expect(coerceTemplateValue(combobox, "الاولى")).toEqual({ ok: true, value: "الأولى" });
    expect(coerceTemplateValue(dropdown, "الخامسة").ok).toBe(false);
  });
});

describe("coerceTemplateValue — multiselect", () => {
  const options = ["تهريب", "تلاعب", "مواد ممنوعة"];
  const field = makeField("m1", "الملاحظات", "multiselect", options);

  it("splits on every supported separator and round-trips through parseMultiValue", () => {
    for (const raw of [
      "تهريب, تلاعب",
      "تهريب،تلاعب",
      "تهريب|تلاعب",
      "تهريب؛تلاعب",
      "تهريب;تلاعب",
      "تهريب/تلاعب",
      "تهريب\nتلاعب",
    ]) {
      const result = coerceTemplateValue(field, raw);
      expect(result).toEqual({ ok: true, value: serializeMultiValue(["تهريب", "تلاعب"]) });
      if (result.ok) expect(parseMultiValue(result.value as string)).toEqual(["تهريب", "تلاعب"]);
    }
  });

  it("resolves each part to its canonical spelling", () => {
    const result = coerceTemplateValue(field, "مواد ممنوعه ، تهريب");
    expect(result).toEqual({ ok: true, value: serializeMultiValue(["مواد ممنوعة", "تهريب"]) });
  });

  it("fails when only some parts resolve, naming the unresolved ones", () => {
    const result = coerceTemplateValue(field, "تهريب, شيء آخر");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("شيء آخر");
      expect(result.reason).not.toContain("لا توجد خيارات");
    }
  });

  it("nulls a cell that holds only separators", () => {
    expect(coerceTemplateValue(field, " , ; | ")).toEqual({ ok: true, value: null });
  });
});

describe("coerceTemplateValue — empty", () => {
  it("never produces a value for a layout spacer", () => {
    const field = makeField("e1", "فاصل", "empty");
    expect(coerceTemplateValue(field, "أي شيء")).toEqual({ ok: true, value: null });
  });
});

describe("detectTemplateHeaderCandidates", () => {
  it("ranks exact above folded-exact above containment", () => {
    const field = makeField("f1", "نتيجة الفحص", "text");
    const headers = ["نتيجة الفحص النهائية", "نتيجه الفحص", "نتيجة الفحص", "المنفذ"];
    expect(detectTemplateHeaderCandidates(headers, field)).toEqual([
      "نتيجة الفحص",
      "نتيجه الفحص",
      "نتيجة الفحص النهائية",
    ]);
  });

  it("returns nothing for an empty-type field or a blank label", () => {
    expect(detectTemplateHeaderCandidates(["فاصل"], makeField("e1", "فاصل", "empty"))).toEqual([]);
    expect(detectTemplateHeaderCandidates(["فاصل"], makeField("t1", "  ", "text"))).toEqual([]);
  });
});

describe("autoDetectTemplateMapping", () => {
  it("never assigns one header to two fields", () => {
    const schema = makeSchema([
      makeField("exact", "نتيجة الفحص", "text"),
      // Would match "نتيجة الفحص" by containment, but it is already claimed.
      makeField("broad", "نتيجة", "text"),
    ]);
    const mapping = autoDetectTemplateMapping(["نتيجة الفحص"], schema);
    expect(mapping.exact).toEqual({ kind: "column", header: "نتيجة الفحص" });
    expect(mapping.broad).toEqual({ kind: "none" });
  });

  it("falls back to the next candidate when the best one is taken", () => {
    const schema = makeSchema([
      makeField("a", "الملاحظات", "text"),
      makeField("b", "ملاحظات", "text"),
    ]);
    const mapping = autoDetectTemplateMapping(["الملاحظات", "ملاحظات"], schema);
    expect(mapping.a).toEqual({ kind: "column", header: "الملاحظات" });
    expect(mapping.b).toEqual({ kind: "column", header: "ملاحظات" });
  });

  it("skips empty-type fields entirely", () => {
    const schema = makeSchema([
      makeField("spacer", "فاصل", "empty"),
      makeField("note", "ملاحظة", "text"),
    ]);
    const mapping = autoDetectTemplateMapping(["فاصل", "ملاحظة"], schema);
    expect(Object.keys(mapping)).toEqual(["note"]);
    expect(mapping.note).toEqual({ kind: "column", header: "ملاحظة" });
  });

  it("marks a field with no matching header as none", () => {
    const schema = makeSchema([makeField("note", "ملاحظة", "text")]);
    expect(autoDetectTemplateMapping(["المنفذ"], schema).note).toEqual({ kind: "none" });
  });
});

describe("buildFieldAnswers", () => {
  const schema = makeSchema([
    makeField("note", "ملاحظة", "text", [], true),
    makeField("count", "عدد الطرود", "number"),
    makeField("grade", "الدرجة", "dropdown", ["الأولى", "الثانية"]),
    makeField("spacer", "فاصل", "empty"),
    makeField("done", "تم التفتيش", "checkbox"),
  ]);

  const columns = (map: Record<string, string>): Record<string, FieldSource> =>
    Object.fromEntries(
      Object.entries(map).map(([fieldId, header]) => [fieldId, { kind: "column", header } as FieldSource])
    );

  it("omits unmapped and blank fields — partial coverage is not an error", () => {
    const { answers, warnings } = buildFieldAnswers({
      schema,
      templateFields: {
        ...columns({ note: "ملاحظة", count: "عدد" }),
        grade: { kind: "none" },
      },
      values: { "ملاحظة": "تم بنجاح", "عدد": "" },
    });

    expect(warnings).toEqual([]);
    // 5 schema fields, 1 answer: the study predates the template.
    expect(answers).toEqual([{ fieldId: "note", value: "تم بنجاح" }]);
  });

  it("ignores field.required — a back-fill cannot answer a question the study never asked", () => {
    const { answers, warnings } = buildFieldAnswers({
      schema,
      templateFields: columns({ count: "عدد" }),
      values: { "عدد": "٧" },
    });
    expect(warnings).toEqual([]);
    expect(answers).toEqual([{ fieldId: "count", value: 7 }]);
  });

  it("warns and omits only the offending field on a failed coercion", () => {
    const { answers, warnings } = buildFieldAnswers({
      schema,
      templateFields: columns({ note: "ملاحظة", count: "عدد", grade: "درجة", done: "تفتيش" }),
      values: { "ملاحظة": "نص", "عدد": "غير معروف", "درجة": "الاولى", "تفتيش": "نعم" },
    });

    expect(answers).toEqual([
      { fieldId: "note", value: "نص" },
      { fieldId: "grade", value: "الأولى" },
      { fieldId: "done", value: true },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("عدد الطرود");
    expect(warnings[0]).toContain("غير معروف");
  });

  it("reads a constant source and stringifies non-string cells", () => {
    const { answers, warnings } = buildFieldAnswers({
      schema,
      templateFields: {
        ...columns({ count: "عدد", done: "تفتيش" }),
        note: { kind: "constant", value: "دراسة تاريخية" },
      },
      values: { "عدد": 12, "تفتيش": true },
    });

    expect(warnings).toEqual([]);
    expect(answers).toEqual([
      { fieldId: "note", value: "دراسة تاريخية" },
      { fieldId: "count", value: 12 },
      { fieldId: "done", value: true },
    ]);
  });

  it("returns nothing at all for a row that maps no template field", () => {
    expect(buildFieldAnswers({ schema, templateFields: {}, values: {} })).toEqual({
      answers: [],
      warnings: [],
    });
  });
});
