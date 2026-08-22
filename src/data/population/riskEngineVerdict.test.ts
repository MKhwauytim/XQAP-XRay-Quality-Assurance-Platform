// Focused coverage for the shared risk-engine vocabulary.
//
// `riskEngineAgreement.test.ts` already exercises `engineVerdictOf` as part of
// the executive deck page that used to own it. These tests exist so the module
// keeps its own guarantees when read on its own terms — the case-queue filter
// («مستهدف المؤشر») now depends on exactly the same recognized set, and the
// blank → null rule is the load-bearing one for BOTH consumers: a blank means
// "we do not know what the engine said", never "the engine cleared it".

import { describe, expect, it } from "vitest";
import { engineVerdictOf } from "./riskEngineVerdict";

describe("engineVerdictOf", () => {
  it("maps every recognized affirmative value to اشتباه", () => {
    for (const value of ["نعم", "مستهدف", "y", "yes", "true", "1"]) {
      expect(engineVerdictOf(value)).toBe("اشتباه");
    }
  });

  it("maps every recognized negative value to سليمة", () => {
    for (const value of ["لا", "غير مستهدف", "n", "no", "false", "0"]) {
      expect(engineVerdictOf(value)).toBe("سليمة");
    }
  });

  it("maps a blank to null — 'unknown', never 'the engine cleared it'", () => {
    expect(engineVerdictOf(null)).toBeNull();
    expect(engineVerdictOf(undefined)).toBeNull();
    expect(engineVerdictOf("")).toBeNull();
    expect(engineVerdictOf("   ")).toBeNull();
    expect(engineVerdictOf("\t\n ")).toBeNull();
  });

  it("maps an unrecognized value to null rather than guessing a verdict", () => {
    for (const value of ["ربما", "xyz", "2", "غير محدد", "no data", "مستهدف جزئياً"]) {
      expect(engineVerdictOf(value)).toBeNull();
    }
  });

  it("normalizes surrounding whitespace and letter case before matching", () => {
    expect(engineVerdictOf("  yes  ")).toBe("اشتباه");
    expect(engineVerdictOf("YES")).toBe("اشتباه");
    expect(engineVerdictOf("  TRUE ")).toBe("اشتباه");
    expect(engineVerdictOf(" نعم ")).toBe("اشتباه");
    expect(engineVerdictOf("\tNo\n")).toBe("سليمة");
    expect(engineVerdictOf(" غير مستهدف ")).toBe("سليمة");
  });

  it("does not normalize INTERNAL whitespace — a two-word value must match exactly", () => {
    // Documents a real limit of the vocabulary rather than asserting a wish:
    // only the exact recognized spellings match, so a risk file writing
    // «غير  مستهدف» with a double space lands in "unknown", not in سليمة.
    expect(engineVerdictOf("غير  مستهدف")).toBeNull();
  });
});
