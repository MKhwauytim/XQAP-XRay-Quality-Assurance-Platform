import { describe, expect, it } from "vitest";
import { HAS_IMAGE_FIELD_LABEL, isNoImageSubmission } from "./noImageAnswer";
import type { ItemAnswer } from "./answerTypes";
import type { TemplateSchema } from "../templates/templateTypes";

function template(): TemplateSchema {
  return {
    templateId: "t1",
    templateName: "test",
    version: 1,
    createdAt: "",
    createdBy: "",
    updatedAt: "",
    updatedBy: "",
    fields: [
      { fieldId: "f-has-image", label: HAS_IMAGE_FIELD_LABEL, type: "dropdown", required: true, options: ["نعم", "لا"] },
      { fieldId: "f-other", label: "حقل آخر", type: "text", required: false, options: [] },
    ],
  };
}

function answer(overrides: Partial<ItemAnswer> = {}): ItemAnswer {
  return {
    xrayImageId: "IMG-1",
    templateId: "t1",
    templateVersion: 1,
    answers: [{ fieldId: "f-has-image", value: "لا" }],
    lastSavedAt: "2026-08-25T00:00:00.000Z",
    submittedAt: "2026-08-25T00:00:00.000Z",
    answeredBy: "emp1",
    status: "submitted",
    ...overrides,
  };
}

describe("isNoImageSubmission", () => {
  it("is true for a submitted answer where the image-gate field is لا", () => {
    expect(isNoImageSubmission(answer(), template())).toBe(true);
  });

  it("is false when the image-gate field is نعم", () => {
    const a = answer({ answers: [{ fieldId: "f-has-image", value: "نعم" }] });
    expect(isNoImageSubmission(a, template())).toBe(false);
  });

  it("is false for a draft (not yet submitted) answer", () => {
    const a = answer({ status: "draft" });
    expect(isNoImageSubmission(a, template())).toBe(false);
  });

  it("is false when there is no answer at all", () => {
    expect(isNoImageSubmission(null, template())).toBe(false);
    expect(isNoImageSubmission(undefined, template())).toBe(false);
  });

  it("is false when the template is missing or doesn't carry the gate field", () => {
    expect(isNoImageSubmission(answer(), null)).toBe(false);
    const noGateTemplate: TemplateSchema = { ...template(), fields: [{ fieldId: "f-other", label: "حقل آخر", type: "text", required: false, options: [] }] };
    expect(isNoImageSubmission(answer(), noGateTemplate)).toBe(false);
  });

  it("matches the gate field by label, not by a fixed field id (ids are generated per workspace)", () => {
    const relabeledTemplate: TemplateSchema = {
      ...template(),
      fields: [
        { fieldId: "some-other-generated-id", label: HAS_IMAGE_FIELD_LABEL, type: "dropdown", required: true, options: ["نعم", "لا"] },
      ],
    };
    const a = answer({ answers: [{ fieldId: "some-other-generated-id", value: "لا" }] });
    expect(isNoImageSubmission(a, relabeledTemplate)).toBe(true);
  });
});
