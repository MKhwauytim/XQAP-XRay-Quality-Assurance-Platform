// Regression coverage for B12 task 3: normalizeBiRow now builds the header
// lookup Map ONCE per row and threads it into getFirstAvailableValue,
// instead of rebuilding it on every one of the ~29 field lookups. This suite
// is purely behavioral — it must pass identically whether the lookup is
// rebuilt per-field (the old code) or built once per-row (the new code),
// since the fix is plumbing-only and must not change what any field resolves
// to.
import { describe, expect, it } from "vitest";
import { detectDuplicateNormalizedHeaders, normalizeBiRow } from "./biDataNormalizer";
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

  it("captures movementNumber/movementDate/movementHijriDate (بري وارد / بري صادر sheets) which previously had no destination fields at all", () => {
    const sourceRow: BiSourceRow = {
      "قيد الحركة": "MOV-42",
      "تاريخ الحركة": "2026-05-11",
      "تاريخ الحركة هجري": "1447-10-14"
    };

    const result = normalizeBiRow({
      sourceRow,
      source: "بري وارد",
      sourceSheetName: "بري وارد",
      sourceRowNumber: 1
    });

    expect(result.movementNumber).toBe("MOV-42");
    expect(result.movementDate).toBe("2026-05-11");
    expect(result.movementHijriDate).toBe("1447-10-14");
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

  // Owner-reported bug (2026-08-12): the real BI.xlsx parses 246,627 rows and
  // accepts 0 — every row excluded as "مستبعدة (بلا معرف أشعة)" on all four
  // sheets. These headers/values are the exact hard evidence gathered by
  // reading the owner's actual workbook with the vendored xlsx package
  // (fixtures only here — the real file is never read from disk in a test).
  describe("owner-reported BI xrayImageId 0-accepted bug (2026-08-12)", () => {
    const realSheetFixtures: { sheetName: string; header: string; value: string }[] = [
      { sheetName: "بري صادر", header: "معرف الأشعة", value: "202605090023680130" },
      { sheetName: "بحري صادر", header: "XRAY_SCAN_ID", value: "6186202605020023" },
      { sheetName: "بري وارد", header: "معرف الأشعة", value: "66202605010001" },
      { sheetName: "بحري وارد", header: "رقم صورة الأشعة", value: "30B9202605010002" }
    ];

    it("resolves xrayImageId from the DEFAULT alias table for all four real sheet headers (proves the defaults are NOT the gap)", () => {
      for (const { sheetName, header, value } of realSheetFixtures) {
        const result = normalizeBiRow({
          sourceRow: { [header]: value },
          source: sheetName,
          sourceSheetName: sheetName,
          sourceRowNumber: 1
        });

        expect(result.xrayImageId).toBe(value);
      }
    });

    it("reproduces the exact reported symptom (valid, non-empty ID string present, still resolves to null) when the header carries diacritic/zero-width copy-paste noise the pre-fix normalizer did not strip", () => {
      // Same construction as riskDataNormalizer.test.ts's 2026-08-12 case:
      // a fatha (U+064B) after every letter plus a ZWNJ (U+200C) inside the
      // word — the kind of noise a header copy-pasted from a diacritized
      // source document can carry. Built with String.fromCodePoint (not
      // literal invisible characters) so the no-irregular-whitespace lint
      // rule doesn't flag this file.
      const fatha = String.fromCodePoint(0x064b);
      const zwnj = String.fromCodePoint(0x200c);
      const base = "معرف الأشعة";
      const withNoise = base
        .split("")
        .map((ch) => (ch === " " ? ch : ch + fatha))
        .join("")
        .replace("الأشعة", "ال" + zwnj + "أشعة");

      const result = normalizeBiRow({
        sourceRow: { [withNoise]: "202605090023680130" },
        source: "بري صادر",
        sourceSheetName: "بري صادر",
        sourceRowNumber: 1
      });

      // With the DIACRITIC_AND_ZERO_WIDTH_PATTERN stripping now applied to
      // biDataNormalizer.ts's normalizeHeader (mirroring the fix already
      // shipped in riskDataNormalizer.ts on 2026-08-12), this resolves
      // correctly instead of silently returning null.
      expect(result.xrayImageId).toBe("202605090023680130");
    });
  });
});

describe("empty saved alias list falls back to defaults (owner 2026-08-12: BI 246,627 parsed / 0 accepted)", () => {
  it("resolves xrayImageId from the default aliases when the saved mapping carries an empty list", () => {
    // The regression: `aliases.xrayImageId || BI_COLUMN_ALIASES.xrayImageId`
    // returned `[]` because an empty array is truthy, so the normalizer
    // searched ZERO headers and every row was excluded as missing an ID --
    // matching the empty "الأعمدة التي بحث عنها النظام" list in the report.
    const result = normalizeBiRow({
      sourceRow: { "معرف الأشعة": "202605090023680130", "اسم المنفذ": "البطحاء" },
      source: "بري وارد",
      sourceSheetName: "بري وارد",
      sourceRowNumber: 2,
      columnMappings: { xrayImageId: [] }
    });

    expect(result.xrayImageId).toBe("202605090023680130");
  });

  it("still honours a non-empty saved mapping over the defaults", () => {
    const result = normalizeBiRow({
      sourceRow: { "عمود مخصص": "XYZ-123", "معرف الأشعة": "SHOULD-NOT-WIN" },
      source: "بري وارد",
      sourceSheetName: "بري وارد",
      sourceRowNumber: 2,
      columnMappings: { xrayImageId: ["عمود مخصص"] }
    });

    expect(result.xrayImageId).toBe("XYZ-123");
  });
});

// duplicate-normalized-headers (Batch 4): detection-only diagnostic. Precedence
// in createHeaderLookup (last Map.set wins) is untouched by this — these tests
// cover the pure detector plus a proof that row output is byte-identical
// whether or not colliding headers are present. Mirrors riskDataNormalizer's
// suite.
describe("detectDuplicateNormalizedHeaders", () => {
  it("reports one collision with both originals when two headers differ only in normalization-stripped content", () => {
    const collisions = detectDuplicateNormalizedHeaders(["التاريخ ", "التاريخ"]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].originals).toEqual(["التاريخ ", "التاريخ"]);
    expect(collisions[0].normalized).toBe("التاريخ");
  });

  it("reports no collision for headers that stay distinct after normalization", () => {
    const collisions = detectDuplicateNormalizedHeaders(["معرف الأشعة", "اسم المنفذ", "رقم البيان"]);

    expect(collisions).toEqual([]);
  });

  it("reports no collision for an empty header list", () => {
    expect(detectDuplicateNormalizedHeaders([])).toEqual([]);
  });

  it("groups three-way collisions into a single entry with all originals", () => {
    const fatha = String.fromCodePoint(0x064b);
    const collisions = detectDuplicateNormalizedHeaders(["اسم المنفذ", "اسم" + fatha + " المنفذ", "اسم المنفذ "]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].originals).toEqual(["اسم المنفذ", "اسم" + fatha + " المنفذ", "اسم المنفذ "]);
  });

  it("does not change normalizeBiRow's output: last-set-wins precedence is untouched by the diagnostic (with vs without colliding headers)", () => {
    const fatha = String.fromCodePoint(0x064b);
    const sourceRowWithCollision: BiSourceRow = {
      "اسم المنفذ": "الميناء الأول",
      ["اسم" + fatha + " المنفذ"]: "الميناء الثاني"
    };
    const sourceRowWithoutCollision: BiSourceRow = {
      ["اسم" + fatha + " المنفذ"]: "الميناء الثاني"
    };

    const withCollision = normalizeBiRow({
      sourceRow: sourceRowWithCollision,
      source: "بري وارد",
      sourceSheetName: "بري وارد",
      sourceRowNumber: 1
    });
    const withoutCollision = normalizeBiRow({
      sourceRow: sourceRowWithoutCollision,
      source: "بري وارد",
      sourceSheetName: "بري وارد",
      sourceRowNumber: 1
    });

    expect(withCollision.portName).toBe("الميناء الثاني");
    expect(withCollision.portName).toBe(withoutCollision.portName);
  });
});
