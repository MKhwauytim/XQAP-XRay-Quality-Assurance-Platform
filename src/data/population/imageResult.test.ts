import { describe, it, expect } from "vitest";
import { classifyImageResult, classifyImageResultOrOther, classifyRecordedImageResult, hasRecordedResults, isBlankResult } from "./imageResult";

describe("classifyImageResult", () => {
  it("returns اشتباه when either level is اشتباه", () => {
    expect(classifyImageResult("اشتباه", "سليمة")).toBe("اشتباه");
    expect(classifyImageResult("سليمة", "اشتباه")).toBe("اشتباه");
    expect(classifyImageResult("اشتباه", "اشتباه")).toBe("اشتباه");
  });

  it("returns سليمة when both levels are سليمة", () => {
    expect(classifyImageResult("سليمة", "سليمة")).toBe("سليمة");
  });

  it("treats null/undefined as سليمة (not اشتباه) for that level", () => {
    expect(classifyImageResult(null, "سليمة")).toBe("سليمة");
    expect(classifyImageResult(undefined, undefined)).toBe("سليمة");
  });
});

describe("blank results (v159.3 Excel cases)", () => {
  it("a case without recorded results has no verdict, never «سليمة»", () => {
    expect(classifyRecordedImageResult("", "")).toBeNull();
    expect(classifyRecordedImageResult("سليمة", "")).toBeNull();
    expect(classifyRecordedImageResult(null, "اشتباه")).toBeNull();
    expect(classifyRecordedImageResult("سليمة", "اشتباه")).toBe("اشتباه");
    expect(hasRecordedResults("سليمة", "سليمة")).toBe(true);
    expect(isBlankResult("  ")).toBe(true);
  });
});

it("classifyImageResultOrOther gives a blank case its own «نتائج أخرى» category", () => {
  expect(classifyImageResultOrOther("", "")).toBe("other");
  expect(classifyImageResultOrOther("سليمة", "")).toBe("other");
  expect(classifyImageResultOrOther("سليمة", "سليمة")).toBe("سليمة");
});
