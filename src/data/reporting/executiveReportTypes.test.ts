import { describe, expect, it } from "vitest";
import { isRowStudied } from "./executiveReportTypes";

describe("isRowStudied", () => {
  it("is true for a submitted answer with an available image", () => {
    expect(isRowStudied({ answerStatus: "submitted", imageAvailable: true })).toBe(true);
  });

  it("is false for a submitted لا يوجد صورة answer — a valid submission, not a completed study", () => {
    expect(isRowStudied({ answerStatus: "submitted", imageAvailable: false })).toBe(false);
  });

  it("is false for a draft (not yet submitted) answer, regardless of imageAvailable", () => {
    expect(isRowStudied({ answerStatus: "draft", imageAvailable: true })).toBe(false);
    expect(isRowStudied({ answerStatus: null, imageAvailable: null })).toBe(false);
  });

  it("treats an unknown imageAvailable (null) as studied — only an explicit لا excludes a row", () => {
    expect(isRowStudied({ answerStatus: "submitted", imageAvailable: null })).toBe(true);
  });
});
