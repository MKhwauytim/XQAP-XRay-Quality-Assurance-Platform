import { describe, it, expect } from "vitest";
import { classifyImageResult } from "./imageResult";

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
