import { describe, expect, it } from "vitest";

import { ADHOC_FIELD_CATALOG } from "./adhocFieldCatalog";
import {
  autoDetectMapping,
  collectDistinctValues,
  detectHeaderCandidates,
  findMappingIssues,
  seedValueMapping,
  setFieldSource,
} from "./adhocMappingModel";
import type { AdhocField, ImportMapping, SourceRow } from "./adhocImportModel";

function field(key: string, labelAr: string, seedAliases: string[] = []): AdhocField {
  return { key, labelAr, required: false, kind: "text", seedAliases };
}

function sourceRow(sourceRowNumber: number, values: Record<string, unknown>): SourceRow {
  return { sourceRowNumber, values };
}

function columnOf(mapping: ImportMapping, key: string): string | null {
  const source = mapping.fields[key];
  return source && source.kind === "column" ? source.header : null;
}

describe("detectHeaderCandidates", () => {
  it("matches an alias verbatim", () => {
    const target = field("t", "معرف الأشعة", ["XRAY_SCAN_ID"]);
    expect(detectHeaderCandidates(["اسم المنفذ", "معرف الأشعة"], target)).toEqual([
      "معرف الأشعة",
    ]);
  });

  it("matches across every folding class the operator's file may carry", () => {
    const target = field("t", "معرف الأشعة");
    const variants = [
      "معرف الاشعة", // أ → ا
      "معرف الأشعه", // ة → ه
      "معــرف الأشعة", // tatweel
      "مُعَرف الأشعة", // diacritics
      "﻿معرف الأشعة", // BOM from a copy-paste
      "معرف  الأشعة", // collapsed interior whitespace
    ];
    for (const variant of variants) {
      expect(detectHeaderCandidates([variant], target), variant).toEqual([variant]);
    }
  });

  it("folds ya / alef-maqsura", () => {
    const target = field("t", "المستوى");
    expect(detectHeaderCandidates(["المستوي"], target)).toEqual(["المستوي"]);
  });

  it("matches Latin headers case-insensitively", () => {
    const target = field("t", "معرف الأشعة", ["XRAY_SCAN_ID"]);
    expect(detectHeaderCandidates(["xray_scan_id"], target)).toEqual(["xray_scan_id"]);
  });

  it("matches by containment in both directions", () => {
    const target = field("t", "نتيجة المستوى الأول");
    // header ⊃ alias
    expect(detectHeaderCandidates(["نتيجة المستوى الأول للأشعة"], target)).toEqual([
      "نتيجة المستوى الأول للأشعة",
    ]);
    // alias ⊃ header (the operator abbreviated)
    expect(detectHeaderCandidates(["المستوى الأول"], target)).toEqual(["المستوى الأول"]);
  });

  it("ranks exact above folded above containment", () => {
    const target = field("t", "رقم البيان", ["رقم البيان المبدئي"]);
    const headers = ["رقم البيان المبدئي للشحنة", "رقم البيان المبدئي", "رقم البيان"];
    expect(detectHeaderCandidates(headers, target)).toEqual([
      // Both verbatim aliases, in the order the headers arrived …
      "رقم البيان المبدئي",
      "رقم البيان",
      // … and the containment match after them.
      "رقم البيان المبدئي للشحنة",
    ]);
  });

  it("returns nothing when no header is plausible", () => {
    expect(detectHeaderCandidates(["عمود لا علاقة له"], field("t", "معرف الأشعة"))).toEqual(
      []
    );
  });

  it("still lists a header another field would claim — contention is not its job", () => {
    const headers = ["المستوى"];
    const stage = field("stage", "المستوى");
    const levelOne = field("xrayLevelOneResult", "نتيجة المستوى الأول");
    expect(detectHeaderCandidates(headers, stage)).toEqual(["المستوى"]);
    expect(detectHeaderCandidates(headers, levelOne)).toEqual(["المستوى"]);
  });
});

describe("autoDetectMapping", () => {
  it("maps a realistic risk-sheet header row onto the shipped catalog", () => {
    const headers = [
      "معرف الأشعة",
      "اسم المنفذ",
      "المستوى",
      "نتيجة المستوى الأول",
      "نتيجة المستوى الثاني",
      "شهر الفحص",
    ];
    const mapping = autoDetectMapping(headers, ADHOC_FIELD_CATALOG);

    expect(columnOf(mapping, "xrayImageId")).toBe("معرف الأشعة");
    expect(columnOf(mapping, "portName")).toBe("اسم المنفذ");
    expect(columnOf(mapping, "xrayLevelOneResult")).toBe("نتيجة المستوى الأول");
    expect(columnOf(mapping, "xrayLevelTwoResult")).toBe("نتيجة المستوى الثاني");
    expect(columnOf(mapping, "stage")).toBe("المستوى");
    expect(columnOf(mapping, "studyMonth")).toBe("شهر الفحص");
    expect(mapping.valueMappings).toEqual({});
  });

  it("never hands one header to two fields", () => {
    const headers = ["الرقم", "الرقم التسلسلي"];
    const catalog = [field("a", "الرقم"), field("b", "الرقم")];
    const mapping = autoDetectMapping(headers, catalog);

    expect(columnOf(mapping, "a")).toBe("الرقم");
    expect(columnOf(mapping, "b")).toBe("الرقم التسلسلي");
  });

  it("gives a header to the field that matched it more strongly, not the earlier one", () => {
    // The real case: portCode precedes portName and its "المنفذ" alias is a
    // substring of "اسم المنفذ", which portName matches verbatim.
    const mapping = autoDetectMapping(["اسم المنفذ"], ADHOC_FIELD_CATALOG);
    expect(columnOf(mapping, "portName")).toBe("اسم المنفذ");
    expect(mapping.fields.portCode).toEqual({ kind: "none" });
  });

  it("leaves the loser of a one-header contention unmapped rather than sharing", () => {
    const catalog = [field("a", "الرقم"), field("b", "الرقم")];
    const mapping = autoDetectMapping(["الرقم"], catalog);

    expect(columnOf(mapping, "a")).toBe("الرقم");
    expect(mapping.fields.b).toEqual({ kind: "none" });
  });

  it("marks a field with no candidate as none", () => {
    const mapping = autoDetectMapping(["عمود لا علاقة له"], ADHOC_FIELD_CATALOG);
    expect(mapping.fields.xrayImageId).toEqual({ kind: "none" });
    for (const catalogField of ADHOC_FIELD_CATALOG) {
      expect(mapping.fields[catalogField.key], catalogField.key).toBeDefined();
    }
  });

  it("keeps a header exactly as the table reported it, BOM and all", () => {
    // The header string is the key the application side reads out of
    // `SourceRow.values`; trimming it here would produce a key that misses.
    const mapping = autoDetectMapping(["\ufeffمعرف الأشعة"], ADHOC_FIELD_CATALOG);
    expect(columnOf(mapping, "xrayImageId")).toBe("\ufeffمعرف الأشعة");
  });

  it("ignores blank headers", () => {
    const mapping = autoDetectMapping(["   ", "معرف الأشعة"], ADHOC_FIELD_CATALOG);
    expect(columnOf(mapping, "xrayImageId")).toBe("معرف الأشعة");
  });
});

describe("collectDistinctValues", () => {
  const rows = [
    sourceRow(2, { result: " سليمة " }),
    sourceRow(3, { result: "اشتباه" }),
    sourceRow(4, { result: "سليمة" }),
    sourceRow(5, { result: "" }),
    sourceRow(6, { result: null }),
    sourceRow(7, {}),
    sourceRow(8, { result: "غير محدد" }),
  ];

  it("returns trimmed, non-empty, distinct values in first-seen order", () => {
    expect(collectDistinctValues(rows, "result")).toEqual([
      "سليمة",
      "اشتباه",
      "غير محدد",
    ]);
  });

  it("stops at the cap so a mis-mapped free-text column cannot build a huge list", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      sourceRow(index + 2, { note: `ملاحظة ${index}` })
    );
    expect(collectDistinctValues(many, "note", 3)).toEqual([
      "ملاحظة 0",
      "ملاحظة 1",
      "ملاحظة 2",
    ]);
    expect(collectDistinctValues(many, "note")).toHaveLength(200);
  });

  it("returns an empty list for a header the rows do not carry", () => {
    expect(collectDistinctValues(rows, "missing")).toEqual([]);
  });
});

describe("seedValueMapping", () => {
  it("maps confident values and omits the rest", () => {
    const mapping = seedValueMapping(
      ["سليم", "اشتباه", "قيمة غريبة"],
      ["سليمة", "اشتباه"]
    );

    expect(mapping["سليم"]).toBe("سليمة");
    expect(mapping["اشتباه"]).toBe("اشتباه");
    // Absent, NOT guessed: an unmapped value is visible in the UI, a wrongly
    // mapped one is not.
    expect(Object.prototype.hasOwnProperty.call(mapping, "قيمة غريبة")).toBe(false);
  });

  it("matches through folding and Latin case", () => {
    expect(seedValueMapping(["سليمه", "certscan"], ["سليمة", "Certscan"])).toEqual({
      "سليمه": "سليمة",
      certscan: "Certscan",
    });
  });

  it("omits a value that could resolve to more than one option", () => {
    expect(seedValueMapping(["المستوى"], ["المستوى الأول", "المستوى الثاني"])).toEqual({});
  });
});

describe("findMappingIssues", () => {
  it("flags a required field with no source and leaves optional ones alone", () => {
    const mapping = autoDetectMapping(["اسم المنفذ"], ADHOC_FIELD_CATALOG);
    const issues = findMappingIssues(mapping, ADHOC_FIELD_CATALOG);

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("required-unmapped");
    expect(issues[0].fieldKey).toBe("xrayImageId");
    expect(issues[0].message).toContain("معرف الأشعة");
  });

  it("treats a blank constant on a required field as unmapped", () => {
    const mapping = setFieldSource(
      autoDetectMapping(["اسم المنفذ"], ADHOC_FIELD_CATALOG),
      "xrayImageId",
      { kind: "constant", value: "  " }
    );
    expect(
      findMappingIssues(mapping, ADHOC_FIELD_CATALOG).map((issue) => issue.kind)
    ).toEqual(["required-unmapped"]);
  });

  it("accepts a declared constant on a required field", () => {
    const mapping = setFieldSource(
      autoDetectMapping(["اسم المنفذ"], ADHOC_FIELD_CATALOG),
      "xrayImageId",
      { kind: "constant", value: "IMG-1" }
    );
    expect(findMappingIssues(mapping, ADHOC_FIELD_CATALOG)).toEqual([]);
  });

  it("flags both sides of a duplicated header, and an unknown field key", () => {
    const mapping: ImportMapping = {
      fields: {
        xrayImageId: { kind: "column", header: "الرقم" },
        portName: { kind: "column", header: "الرقم" },
        someRemovedField: { kind: "column", header: "أخرى" },
      },
      valueMappings: {},
    };
    const issues = findMappingIssues(mapping, ADHOC_FIELD_CATALOG);

    expect(
      issues.filter((issue) => issue.kind === "duplicate-header").map((issue) => issue.fieldKey)
    ).toEqual(["xrayImageId", "portName"]);
    expect(issues.filter((issue) => issue.kind === "unknown-field")).toEqual([
      {
        kind: "unknown-field",
        fieldKey: "someRemovedField",
        message: 'الحقل "someRemovedField" غير موجود في قائمة حقول هذا الاستيراد.',
      },
    ]);
  });
});

describe("setFieldSource", () => {
  it("returns a new mapping and does not mutate its input", () => {
    const original: ImportMapping = {
      fields: { xrayImageId: { kind: "column", header: "الرقم" } },
      valueMappings: { stage: { "1": "المستوى الأول" } },
    };
    const originalSnapshot = JSON.stringify(original);

    const next = setFieldSource(original, "portName", { kind: "constant", value: "جسر" });

    expect(JSON.stringify(original)).toBe(originalSnapshot);
    expect(original.fields.portName).toBeUndefined();
    expect(next.fields.portName).toEqual({ kind: "constant", value: "جسر" });
    expect(next.fields.xrayImageId).toEqual({ kind: "column", header: "الرقم" });
    expect(next.valueMappings).toEqual({ stage: { "1": "المستوى الأول" } });
    expect(next.valueMappings).not.toBe(original.valueMappings);
  });

  it("replaces an existing source in place of the old one", () => {
    const original = autoDetectMapping(["معرف الأشعة"], ADHOC_FIELD_CATALOG);
    const next = setFieldSource(original, "xrayImageId", { kind: "none" });

    expect(columnOf(original, "xrayImageId")).toBe("معرف الأشعة");
    expect(next.fields.xrayImageId).toEqual({ kind: "none" });
  });
});
