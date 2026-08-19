import { describe, expect, it } from "vitest";
import {
  getVisibleTemplateFields,
  isFieldVisible,
  parseMultiValue,
  serializeMultiValue,
  toggleMultiValue,
} from "./templateRuntime";
import type { TemplateField, TemplateSchema } from "./templateTypes";

function field(partial: Partial<TemplateField> & Pick<TemplateField, "fieldId" | "type">): TemplateField {
  return {
    label: partial.fieldId,
    required: false,
    options: [],
    ...partial,
  };
}

function schemaOf(fields: TemplateField[]): TemplateSchema {
  return {
    templateId: "tmpl-runtime",
    templateName: "قالب",
    version: 1,
    createdAt: "2026-08-18T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-08-18T00:00:00.000Z",
    updatedBy: "admin",
    fields,
  };
}

const visibleIds = (schema: TemplateSchema, answers: Record<string, string | number | boolean>): string[] =>
  getVisibleTemplateFields(schema, answers).map((f) => f.fieldId);

describe("templateRuntime — conditional visibility on an UNANSWERED source", () => {
  // The Template Builder writes a checkbox-sourced condition as a real boolean
  // (`value: false` for "لا / غير مفعلة"), while InspectionPanel renders an
  // untouched checkbox as visibly unticked. The predicate must agree with the
  // control the employee is looking at, on the very first render.
  const checkboxSchema = schemaOf([
    field({ fieldId: "chk", type: "checkbox", order: 1 }),
    field({
      fieldId: "whenUnticked", type: "text", order: 2,
      condition: { sourceFieldId: "chk", operator: "equals", value: false },
    }),
    field({
      fieldId: "whenTicked", type: "text", order: 3,
      condition: { sourceFieldId: "chk", operator: "notEquals", value: false },
    }),
  ]);

  it("reads an untouched checkbox as false, so a fresh form matches the unticked branch", () => {
    expect(visibleIds(checkboxSchema, {})).toEqual(["chk", "whenUnticked"]);
  });

  it("gives an untouched checkbox exactly the same visibility as an explicit false", () => {
    expect(visibleIds(checkboxSchema, {})).toEqual(visibleIds(checkboxSchema, { chk: false }));
  });

  it("still switches to the ticked branch once the box is checked", () => {
    expect(visibleIds(checkboxSchema, { chk: true })).toEqual(["chk", "whenTicked"]);
  });

  // `notEquals` on an unanswered dropdown used to compare against "" and fire,
  // showing a field whose branch the employee had not chosen yet — and, when
  // that field is required, blocking the phase until it was filled with an
  // answer `collect()` then dropped as soon as the source was answered.
  const dropdownSchema = schemaOf([
    field({ fieldId: "quality", type: "dropdown", required: true, options: ["عالي", "منخفض"], order: 1 }),
    field({
      fieldId: "reason", type: "textarea", required: true, order: 2,
      condition: { sourceFieldId: "quality", operator: "notEquals", value: "عالي" },
    }),
  ]);

  it("hides a notEquals-conditioned field until its source dropdown is answered", () => {
    expect(visibleIds(dropdownSchema, {})).toEqual(["quality"]);
  });

  it("shows it once the source takes a non-matching value, and hides it on a match", () => {
    expect(visibleIds(dropdownSchema, { quality: "منخفض" })).toEqual(["quality", "reason"]);
    expect(visibleIds(dropdownSchema, { quality: "عالي" })).toEqual(["quality"]);
  });

  it("leaves an unanswered equals-conditioned field hidden, as before", () => {
    const schema = schemaOf([
      field({ fieldId: "hasImage", type: "dropdown", options: ["نعم", "لا"], order: 1 }),
      field({
        fieldId: "detail", type: "text", order: 2,
        condition: { sourceFieldId: "hasImage", operator: "equals", value: "نعم" },
      }),
    ]);
    expect(visibleIds(schema, {})).toEqual(["hasImage"]);
    expect(visibleIds(schema, { hasImage: "نعم" })).toEqual(["hasImage", "detail"]);
  });

  it("leaves truthy/falsy untouched on an unanswered source", () => {
    const truthyField = field({
      fieldId: "t", type: "text",
      condition: { sourceFieldId: "src", operator: "truthy" },
    });
    const falsyField = field({
      fieldId: "f", type: "text",
      condition: { sourceFieldId: "src", operator: "falsy" },
    });
    const src = field({ fieldId: "src", type: "text" });
    expect(isFieldVisible(truthyField, {}, [src, truthyField])).toBe(false);
    expect(isFieldVisible(falsyField, {}, [src, falsyField])).toBe(true);
  });
});

describe("multiselect answers", () => {
  it("round-trips a selection through the joined-string storage form", () => {
    const selected = ["سوائل", "مركبات"];
    const stored = serializeMultiValue(selected);
    expect(stored).toBe("سوائل | مركبات");
    expect(parseMultiValue(stored)).toEqual(selected);
  });

  it("treats an empty, blank or non-string value as no selection", () => {
    expect(parseMultiValue("")).toEqual([]);
    expect(parseMultiValue(" | ")).toEqual([]);
    expect(parseMultiValue(undefined)).toEqual([]);
    expect(parseMultiValue(null)).toEqual([]);
    expect(parseMultiValue(true)).toEqual([]);
    expect(serializeMultiValue([])).toBe("");
  });

  it("strips the separator out of option text so an option cannot forge a boundary", () => {
    expect(parseMultiValue(serializeMultiValue(["مواد | مهربة"]))).toEqual(["مواد مهربة"]);
  });

  it("stores in template order, so click order never changes the stored string", () => {
    const options = ["أ", "ب", "ج"];
    const clickedForwards = toggleMultiValue(toggleMultiValue([], "أ", options), "ج", options);
    const clickedBackwards = toggleMultiValue(toggleMultiValue([], "ج", options), "أ", options);
    expect(serializeMultiValue(clickedForwards)).toBe(serializeMultiValue(clickedBackwards));
    expect(clickedForwards).toEqual(["أ", "ج"]);
  });

  it("toggles an already-selected option back off", () => {
    const options = ["أ", "ب"];
    expect(toggleMultiValue(["أ", "ب"], "أ", options)).toEqual(["ب"]);
  });

  it("keeps a selected option the template no longer offers", () => {
    expect(toggleMultiValue(["قديم"], "أ", ["أ", "ب"])).toEqual(["أ", "قديم"]);
  });

  it("reads `equals` on a multiselect source as 'this option is among those picked'", () => {
    const schema = schemaOf([
      field({
        fieldId: "nature", type: "multiselect", options: ["سوائل", "مركبات", "مساحيق"], order: 1,
      }),
      field({
        fieldId: "detail", type: "text", order: 2,
        condition: { sourceFieldId: "nature", operator: "equals", value: "مركبات" },
      }),
    ]);

    // The whole point: a second pick must not hide the dependent field, which
    // is what a plain string comparison against the joined value would do.
    expect(visibleIds(schema, { nature: "مركبات" })).toEqual(["nature", "detail"]);
    expect(visibleIds(schema, { nature: "سوائل | مركبات" })).toEqual(["nature", "detail"]);
    expect(visibleIds(schema, { nature: "سوائل | مساحيق" })).toEqual(["nature"]);
  });

  it("reads `notEquals` on a multiselect source as 'this option was not picked'", () => {
    const schema = schemaOf([
      field({ fieldId: "nature", type: "multiselect", options: ["سوائل", "مركبات"], order: 1 }),
      field({
        fieldId: "detail", type: "text", order: 2,
        condition: { sourceFieldId: "nature", operator: "notEquals", value: "مركبات" },
      }),
    ]);
    expect(visibleIds(schema, { nature: "سوائل" })).toEqual(["nature", "detail"]);
    expect(visibleIds(schema, { nature: "سوائل | مركبات" })).toEqual(["nature"]);
  });

  it("leaves an unanswered multiselect source satisfying neither equality branch", () => {
    const schema = schemaOf([
      field({ fieldId: "nature", type: "multiselect", options: ["سوائل"], order: 1 }),
      field({
        fieldId: "eq", type: "text", order: 2,
        condition: { sourceFieldId: "nature", operator: "equals", value: "سوائل" },
      }),
      field({
        fieldId: "ne", type: "text", order: 3,
        condition: { sourceFieldId: "nature", operator: "notEquals", value: "سوائل" },
      }),
    ]);
    expect(visibleIds(schema, {})).toEqual(["nature"]);
  });
});
