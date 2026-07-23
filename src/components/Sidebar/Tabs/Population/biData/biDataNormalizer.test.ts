// Regression coverage for B12 task 3: normalizeBiRow now builds the header
// lookup Map ONCE per row and threads it into getFirstAvailableValue,
// instead of rebuilding it on every one of the ~29 field lookups. This suite
// is purely behavioral — it must pass identically whether the lookup is
// rebuilt per-field (the old code) or built once per-row (the new code),
// since the fix is plumbing-only and must not change what any field resolves
// to.
import { describe, expect, it } from "vitest";
import { normalizeBiRow } from "./biDataNormalizer";
import type { BiSourceRow } from "./biDataTypes";

describe("normalizeBiRow", () => {
  it("maps every default-alias header to its normalized field", () => {
    const sourceRow: BiSourceRow = {
      "معرف الأشعة": "X-200",
      "تاريخ دخول الأشعة": "2026-05-02",
      "نوع المنفذ": "بري",
      "رمز المنفذ": "JED",
      "اسم المنفذ": "ميناء جدة",
      "رقم البيان": "DEC-2",
      "رقم اللوحة/الحاوية": "PLT-2",
      "رقم الشاص": "CHS-2",
      "الحوكمة": "حوكمة أ",
      "موظف المستوى الأول": "أحمد",
      "نتيجة المستوى الأول": "سليمة",
      "نتيجة المستوى الثاني": "اشتباه",
      "نتيجة التفتيش اليدوي": "سليمة",
      "موظف التفتيش المعاكس": "خالد",
      "نتيجة التفتيش المعاكس": "اشتباه",
      "موظف الوسائل الحية": "سعيد",
      "نتيجة الوسائل الحية": "سليمة",
      "ملاحظة المستويات": "ملاحظة"
    };

    const result = normalizeBiRow({
      sourceRow,
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 5
    });

    expect(result.xrayImageId).toBe("X-200");
    expect(result.xrayEntryDate).toBe("2026-05-02");
    expect(result.portType).toBe("بري");
    expect(result.portCode).toBe("JED");
    expect(result.portName).toBe("ميناء جدة");
    expect(result.declarationNumber).toBe("DEC-2");
    expect(result.plateOrContainerNumber).toBe("PLT-2");
    expect(result.chassisNumber).toBe("CHS-2");
    expect(result.governance).toBe("حوكمة أ");
    expect(result.levelOneEmployee).toBe("أحمد");
    expect(result.levelOneResult).toBe("سليمة");
    expect(result.levelTwoResult).toBe("اشتباه");
    expect(result.manualInspectionResult).toBe("سليمة");
    expect(result.oppositeInspectionEmployee).toBe("خالد");
    expect(result.oppositeInspectionResult).toBe("اشتباه");
    expect(result.liveMeansEmployee).toBe("سعيد");
    expect(result.liveMeansResult).toBe("سليمة");
    expect(result.notes).toBe("ملاحظة");
    expect(result.source).toBe("bi-workbook");
    expect(result.sourceSheetName).toBe("SheetA");
    expect(result.sourceRowNumber).toBe(5);
    expect(result.rawRow).toBe(sourceRow);
  });

  it("falls through to a later alias when earlier candidate headers are absent (first-available-value ordering)", () => {
    // levelOneResult's alias list is
    // ["نتيجة المستوى الأول", "نتيجة المستوى الاول", "المستوى الأول", ...] —
    // only the third candidate is present here.
    const sourceRow: BiSourceRow = {
      "المستوى الأول": "سليمة"
    };

    const result = normalizeBiRow({
      sourceRow,
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 1
    });

    expect(result.levelOneResult).toBe("سليمة");
  });

  it("falls through every earlier plateOrContainerNumber alias to reach the last candidate", () => {
    // plateOrContainerNumber's alias list is
    // ["رقم الحاوية", "CNTNR_MRK", "PLATE_NO", "رقم اللوحة", "رقم اللوحة\\الحاوية", "رقم اللوحة/الحاوية"].
    // Only the LAST (6th) candidate is present — a lookup keyed on the exact
    // normalized header (not a substring match) must still find it despite
    // "رقم اللوحة" appearing as a textual prefix of the present header.
    const sourceRow: BiSourceRow = {
      "رقم اللوحة/الحاوية": "PLT-9"
    };

    const result = normalizeBiRow({
      sourceRow,
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 1
    });

    expect(result.plateOrContainerNumber).toBe("PLT-9");
  });

  it("honors custom columnMappings over the default aliases", () => {
    const sourceRow: BiSourceRow = {
      CUSTOM_PORT: "Custom BI Port",
      "اسم المنفذ": "الاسم الافتراضي"
    };

    const result = normalizeBiRow({
      sourceRow,
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 1,
      columnMappings: { portName: ["CUSTOM_PORT"] }
    });

    expect(result.portName).toBe("Custom BI Port");
  });

  it("returns null for fields whose headers are entirely absent, and treats blank cells as absent", () => {
    const result = normalizeBiRow({
      sourceRow: { "اسم المنفذ": "   " },
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 1
    });

    expect(result.portName).toBeNull();
    expect(result.xrayImageId).toBeNull();
  });

  it("resolves fields independently per row when normalizing multiple rows in sequence (shared-lookup isolation)", () => {
    const first = normalizeBiRow({
      sourceRow: { "اسم المنفذ": "ميناء أ", "معرف الأشعة": "X-1" },
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 1
    });
    const second = normalizeBiRow({
      sourceRow: { "اسم المنفذ": "ميناء ب", "معرف الأشعة": "X-2" },
      source: "bi-workbook",
      sourceSheetName: "SheetA",
      sourceRowNumber: 2
    });

    expect(first.portName).toBe("ميناء أ");
    expect(first.xrayImageId).toBe("X-1");
    expect(second.portName).toBe("ميناء ب");
    expect(second.xrayImageId).toBe("X-2");
  });
});
