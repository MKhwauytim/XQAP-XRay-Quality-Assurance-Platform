// Regression coverage for B12 task 3: normalizeRiskRow now builds the
// header lookup Map ONCE per row and threads it into getFirstAvailableValue,
// instead of rebuilding it on every one of the ~27 field lookups. This suite
// is purely behavioral — it must pass identically whether the lookup is
// rebuilt per-field (the old code) or built once per-row (the new code),
// since the fix is plumbing-only and must not change what any field resolves
// to.
import { describe, expect, it } from "vitest";
import { detectDuplicateNormalizedHeaders, normalizeRiskRow } from "./riskDataNormalizer";
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
    // ["رقم البيان", "رقم البيان المبدئي"] — only the second candidate is
    // present here, so it must still be picked up even though the lookup Map
    // is now shared across every field's search.
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

  it("stores the transit declaration number separately from declarationNumber instead of colliding (العبور sheet)", () => {
    // The transit sheet ("العبور") carries both رقم البيان المبدئي and
    // رقم بيان الترانزيت on the same row — two distinct real values that used
    // to collide onto the single declarationNumber field (whichever alias
    // ranked first silently won, the other was lost). They must now land in
    // two separate fields.
    const sourceRow: RiskSourceRow = {
      "رقم البيان المبدئي": "DEC-PRELIM-9",
      "رقم بيان الترانزيت": "TRANSIT-77"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "عبور",
      sourceSheetName: "العبور",
      sourceRowNumber: 1
    });

    expect(result.declarationNumber).toBe("DEC-PRELIM-9");
    expect(result.transitDeclarationNumber).toBe("TRANSIT-77");
  });

  it("captures manifestDate (بحري sheet) which previously had no destination field at all", () => {
    const sourceRow: RiskSourceRow = {
      "تاريخ المانفيست": "2026-05-10"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بحري",
      sourceSheetName: "بحري",
      sourceRowNumber: 1
    });

    expect(result.manifestDate).toBe("2026-05-10");
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

  it("normalizes headers carrying diacritics and zero-width marks so a copy-pasted alias header still matches (2026-08-12 diagnostic hardening)", () => {
    // Built with String.fromCodePoint instead of embedding the literal
    // combining marks in source (the no-irregular-whitespace lint rule flags
    // literal zero-width characters in a source file). Inserts a fatha
    // (U+064B) after every letter of "نتيجة المستوى الأول" plus a ZWNJ
    // (U+200C) in the middle of "المستوى" — the kind of noise a header
    // copy-pasted from a diacritized Word document can carry, which an
    // exact-match alias lookup would otherwise silently fail on.
    const fatha = String.fromCodePoint(0x064b);
    const zwnj = String.fromCodePoint(0x200c);
    const base = "نتيجة المستوى الأول";
    const withNoise = base
      .split("")
      .map((ch) => (ch === " " ? ch : ch + fatha))
      .join("")
      .replace("المستوى", "الم" + zwnj + "ستوى");

    const sourceRow: RiskSourceRow = {
      [withNoise]: "اشتباه"
    };

    const result = normalizeRiskRow({
      sourceRow,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    expect(result.xrayLevelOneResult).toBe("اشتباه");
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

// duplicate-normalized-headers (Batch 4): detection-only diagnostic. Precedence
// in createHeaderLookup (last Map.set wins) is untouched by this — these tests
// cover the pure detector plus a proof that row output is byte-identical
// whether or not colliding headers are present.
describe("detectDuplicateNormalizedHeaders", () => {
  it("reports one collision with both originals when two headers differ only in normalization-stripped content", () => {
    const collisions = detectDuplicateNormalizedHeaders(["التاريخ ", "التاريخ"]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].originals).toEqual(["التاريخ ", "التاريخ"]);
    expect(collisions[0].normalized).toBe("التاريخ");
  });

  it("reports no collision for headers that stay distinct after normalization", () => {
    const collisions = detectDuplicateNormalizedHeaders(["اسم المنفذ", "رقم البيان", "معرف الأشعة"]);

    expect(collisions).toEqual([]);
  });

  it("reports no collision for an empty header list", () => {
    expect(detectDuplicateNormalizedHeaders([])).toEqual([]);
  });

  it("groups three-way collisions into a single entry with all originals", () => {
    const fatha = String.fromCodePoint(0x064b);
    const collisions = detectDuplicateNormalizedHeaders(["التاريخ", "التاريخ" + fatha, "التاريخ "]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].originals).toEqual(["التاريخ", "التاريخ" + fatha, "التاريخ "]);
  });

  it("does not change normalizeRiskRow's output: last-set-wins precedence is untouched by the diagnostic (with vs without colliding headers)", () => {
    // Two headers ("اسم المنفذ" and its diacritic-noised twin) both alias to
    // portName and both normalize to the same key, so createHeaderLookup's
    // Map.set makes the LAST one (object key insertion order) win — exactly as
    // before this diagnostic existed.
    const fatha = String.fromCodePoint(0x064b);
    const sourceRowWithCollision: RiskSourceRow = {
      "اسم المنفذ": "الميناء الأول",
      ["اسم" + fatha + " المنفذ"]: "الميناء الثاني"
    };
    const sourceRowWithoutCollision: RiskSourceRow = {
      ["اسم" + fatha + " المنفذ"]: "الميناء الثاني"
    };

    const withCollision = normalizeRiskRow({
      sourceRow: sourceRowWithCollision,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });
    const withoutCollision = normalizeRiskRow({
      sourceRow: sourceRowWithoutCollision,
      movementType: "بري",
      sourceSheetName: "Sheet1",
      sourceRowNumber: 1
    });

    // Same last-set-wins result as the non-colliding-input row: the diagnostic
    // is purely additive and never changes which value is picked.
    expect(withCollision.portName).toBe("الميناء الثاني");
    expect(withCollision.portName).toBe(withoutCollision.portName);
  });
});
