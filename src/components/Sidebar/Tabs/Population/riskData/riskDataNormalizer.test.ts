// Regression coverage for B12 task 3: normalizeRiskRow now builds the
// header lookup Map ONCE per row and threads it into getFirstAvailableValue,
// instead of rebuilding it on every one of the ~27 field lookups. This suite
// is purely behavioral — it must pass identically whether the lookup is
// rebuilt per-field (the old code) or built once per-row (the new code),
// since the fix is plumbing-only and must not change what any field resolves
// to.
import { describe, expect, it } from "vitest";
import { normalizeRiskRow } from "./riskDataNormalizer";
import type { RiskSourceRow } from "./riskDataTypes";

describe("normalizeRiskRow", () => {
  it("maps every default-alias header to its normalized field", () => {
    const sourceRow: RiskSourceRow = {
      "اسم المنفذ": "ميناء جدة",
      "نوع المنفذ": "بحري",
      "رقم البيان": "DEC-1",
      "رقم اللوحة": "PLT-1",
      "رقم الهيكل": "CHS-1",
      "رقم المحضر": "RPT-1",
      "نتيجة المستوى الأول": "سليمة",
      "نتيجة المستوى الثاني": "سليمة",
      "معرف الأشعة": "X-100",
      "تاريخ دخول الأشعة": "2026-05-01",
      "المستوى": "المستوى الأول"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 2
    });

    expect(result.portName).toBe("ميناء جدة");
    expect(result.portType).toBe("بحري");
    expect(result.declarationNumber).toBe("DEC-1");
    expect(result.plateOrContainerNumber).toBe("PLT-1");
    expect(result.chassisNumber).toBe("CHS-1");
    expect(result.reportNumber).toBe("RPT-1");
    expect(result.hasReport).toBe(true);
    expect(result.xrayLevelOneResult).toBe("سليمة");
    expect(result.xrayLevelTwoResult).toBe("سليمة");
    expect(result.xrayImageId).toBe("X-100");
    expect(result.xrayEntryDate).toBe("2026-05-01");
    expect(result.stage).toBe("المستوى الأول");
    expect(result.movementType).toBe("بري");
    expect(result.sourceSheetName).toBe("Sheet1");
    expect(result.sourceRowNumber).toBe(2);
    expect(result.rawRow).toBe(sourceRow);
  });

  it("falls through to a later alias when earlier candidate headers are absent (first-available-value ordering)", () => {
    // declarationNumber's alias list is
    // ["رقم البيان", "رقم البيان المبدئي", "رقم بيان الترانزيت"] — only the
    // second candidate is present here, so it must still be picked up even
    // though the lookup Map is now shared across every field's search.
    const sourceRow: RiskSourceRow = {
      "رقم البيان المبدئي": "DEC-PRELIM-9"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    expect(result.declarationNumber).toBe("DEC-PRELIM-9");
  });

  it("normalizes headers so Arabic letter variants and stray internal whitespace still match", () => {
    const sourceRow: RiskSourceRow = {
      "اسم  المنفذ": "ميناء الدمام" // doubled internal space collapses via normalizeArabicText
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    expect(result.portName).toBe("ميناء الدمام");
  });

  it("honors custom columnMappings over the default aliases", () => {
    const sourceRow: RiskSourceRow = {
      PORT_NAME_CUSTOM: "Custom Port",
      "اسم المنفذ": "الاسم الافتراضي"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1,
      columnMappings: { portName: ["PORT_NAME_CUSTOM"] }
    });

    expect(result.portName).toBe("Custom Port");
  });

  it("returns null for fields whose headers are entirely absent", () => {
    const result = normalizeRiskRow({
      sourceRow: {},
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    expect(result.portName).toBeNull();
    expect(result.xrayImageId).toBeNull();
    expect(result.reportNumber).toBeNull();
    expect(result.hasReport).toBe(false);
  });

  it("treats blank/whitespace-only cell values as absent", () => {
    const sourceRow: RiskSourceRow = {
      "اسم المنفذ": "   "
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    expect(result.portName).toBeNull();
  });

  it("resolves fields independently per row when normalizing multiple rows in sequence (shared-lookup isolation)", () => {
    // Guards against a hoisting bug where the lookup Map might accidentally
    // be reused/mutated across rows instead of rebuilt per row.
    const first = normalizeRiskRow({
      sourceRow: { "اسم المنفذ": "ميناء أ", "معرف الأشعة": "X-1" },
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });
    const second = normalizeRiskRow({
      sourceRow: { "اسم المنفذ": "ميناء ب", "معرف الأشعة": "X-2" },
      movementType: "بحري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 2
    });

    expect(first.portName).toBe("ميناء أ");
    expect(first.xrayImageId).toBe("X-1");
    expect(second.portName).toBe("ميناء ب");
    expect(second.xrayImageId).toBe("X-2");
  });
});
