import { describe, expect, it } from "vitest";

import type {
  AdhocField,
  ImportMapping,
  SourceTable,
} from "./adhocImportModel";
import { projectTable, resolveFieldValue } from "./adhocRowProjection";

const CATALOG: AdhocField[] = [
  { key: "xrayImageId", labelAr: "معرّف الأشعة", required: true, kind: "text", seedAliases: [] },
  {
    key: "xrayLevelOneResult",
    labelAr: "نتيجة المستوى الأول",
    required: true,
    kind: "enum",
    options: ["سليمة", "اشتباه"],
    seedAliases: [],
  },
  {
    key: "certScanStatus",
    labelAr: "حالة التفتيش",
    required: false,
    kind: "enum",
    options: ["Certscan", "NonCertscan"],
    seedAliases: [],
  },
  { key: "portName", labelAr: "الميناء", required: false, kind: "text", seedAliases: [] },
  { key: "examDate", labelAr: "تاريخ الفحص", required: false, kind: "date", seedAliases: [] },
  { key: "studyMonth", labelAr: "شهر الفحص", required: false, kind: "month", seedAliases: [] },
];

function mappingOf(overrides: Partial<ImportMapping> = {}): ImportMapping {
  return {
    fields: {
      xrayImageId: { kind: "column", header: "معرف" },
      xrayLevelOneResult: { kind: "column", header: "النتيجة" },
      ...(overrides.fields ?? {}),
    },
    valueMappings: overrides.valueMappings ?? {},
  };
}

function tableOf(
  rows: Array<Record<string, unknown>>,
  sheetName = "الورقة1",
  firstRowNumber = 2
): SourceTable {
  return {
    sheetName,
    headers: [...new Set(rows.flatMap((row) => Object.keys(row)))],
    rows: rows.map((values, index) => ({ sourceRowNumber: firstRowNumber + index, values })),
  };
}

function project(table: SourceTable, mapping: ImportMapping, seenIds?: Set<string>) {
  return projectTable({
    table,
    mapping,
    catalog: CATALOG,
    binding: { kind: "isolated" },
    ...(seenIds ? { seenIds } : {}),
  });
}

describe("resolveFieldValue", () => {
  it("reads and trims a column cell", () => {
    expect(resolveFieldValue({ kind: "column", header: "معرف" }, { معرف: "  A-1 " })).toBe("A-1");
  });

  it("stringifies a numeric cell", () => {
    expect(resolveFieldValue({ kind: "column", header: "معرف" }, { معرف: 4501 })).toBe("4501");
  });

  it("returns null for a blank, whitespace-only, missing or nullish cell", () => {
    const source = { kind: "column", header: "معرف" } as const;

    expect(resolveFieldValue(source, { معرف: "" })).toBeNull();
    expect(resolveFieldValue(source, { معرف: "   " })).toBeNull();
    expect(resolveFieldValue(source, { معرف: null })).toBeNull();
    expect(resolveFieldValue(source, {})).toBeNull();
  });

  it("returns the trimmed constant, and null for an empty one", () => {
    expect(resolveFieldValue({ kind: "constant", value: " سليمة " }, {})).toBe("سليمة");
    expect(resolveFieldValue({ kind: "constant", value: "  " }, {})).toBeNull();
  });

  it("returns null for an unmapped field", () => {
    expect(resolveFieldValue({ kind: "none" }, { معرف: "A-1" })).toBeNull();
  });
});

describe("projectTable — shape", () => {
  it("keys rows by sheet name and the user's real spreadsheet line", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }], "بيانات", 7), mappingOf());

    expect(rows[0].rowKey).toBe("بيانات:7");
    expect(rows[0].excludedByAdmin).toBe(false);
    expect(rows[0].assignments).toEqual([]);
  });

  it("gives every catalog key an entry, unmapped ones included", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }]), mappingOf());

    expect(Object.keys(rows[0].mapped).sort()).toEqual(CATALOG.map((f) => f.key).sort());
    // Unmapped, not absent — a consumer can never confuse the two.
    expect(rows[0].mapped.portName).toBeNull();
    expect(rows[0].mapped.examDate).toBeNull();
  });

  it("turns a blank cell into null", () => {
    const mapping = mappingOf({
      fields: {
        xrayImageId: { kind: "column", header: "معرف" },
        xrayLevelOneResult: { kind: "column", header: "النتيجة" },
        portName: { kind: "column", header: "الميناء" },
      },
    });
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة", الميناء: "   " }]), mapping);

    expect(rows[0].mapped.portName).toBeNull();
    // A blank cell on an optional field is not a defect.
    expect(rows[0].validation).toEqual({ valid: true });
  });

  it("keeps a date's text exactly as the file wrote it", () => {
    const mapping = mappingOf({
      fields: {
        xrayImageId: { kind: "column", header: "معرف" },
        xrayLevelOneResult: { kind: "column", header: "النتيجة" },
        examDate: { kind: "column", header: "التاريخ" },
      },
    });
    const rows = project(
      tableOf([{ معرف: "A-1", النتيجة: "سليمة", التاريخ: " 17/05/2026 " }]),
      mapping
    );

    // Trimmed, never reformatted — the app stores these as display strings.
    expect(rows[0].mapped.examDate).toBe("17/05/2026");
  });

  it("keeps a month cell raw in `mapped` and resolves the folder name separately", () => {
    const mapping = mappingOf({
      fields: {
        xrayImageId: { kind: "column", header: "معرف" },
        xrayLevelOneResult: { kind: "column", header: "النتيجة" },
        studyMonth: { kind: "column", header: "الشهر" },
      },
    });
    const table = tableOf([
      { معرف: "A-1", النتيجة: "سليمة", الشهر: "مايو 2026" },
      { معرف: "A-2", النتيجة: "سليمة", الشهر: "غير معروف" },
    ]);

    const rows = projectTable({
      table,
      mapping,
      catalog: CATALOG,
      binding: { kind: "column", fieldKey: "studyMonth" },
    });

    expect(rows[0].mapped.studyMonth).toBe("مايو 2026");
    expect(rows[0].linkedMonthFolder).toBe("5-may-2026");
    // An unreadable month falls back to isolated without invalidating the row.
    expect(rows[1].linkedMonthFolder).toBeUndefined();
    expect("linkedMonthFolder" in rows[1]).toBe(false);
    expect(rows[1].validation).toEqual({ valid: true });
  });

  it("omits linkedMonthFolder entirely for an isolated import", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }]), mappingOf());

    expect("linkedMonthFolder" in rows[0]).toBe(false);
  });
});

describe("projectTable — field sources", () => {
  it("lets a constant satisfy a required field for every row", () => {
    const mapping = mappingOf({
      fields: {
        xrayImageId: { kind: "column", header: "معرف" },
        xrayLevelOneResult: { kind: "constant", value: "سليمة" },
      },
    });
    const rows = project(tableOf([{ معرف: "A-1" }, { معرف: "A-2" }]), mapping);

    expect(rows.map((row) => row.mapped.xrayLevelOneResult)).toEqual(["سليمة", "سليمة"]);
    expect(rows.every((row) => row.validation.valid)).toBe(true);
  });

  it("invalidates every row when a required field is mapped to `none`", () => {
    const mapping = mappingOf({
      fields: {
        xrayImageId: { kind: "column", header: "معرف" },
        xrayLevelOneResult: { kind: "none" },
      },
    });
    const rows = project(tableOf([{ معرف: "A-1" }]), mapping);

    expect(rows[0].validation.valid).toBe(false);
    expect(rows[0].validation.valid === false && rows[0].validation.reason).toContain(
      "نتيجة المستوى الأول"
    );
  });
});

describe("projectTable — enum resolution", () => {
  it("resolves a value through the admin's value mapping", () => {
    const mapping = mappingOf({ valueMappings: { xrayLevelOneResult: { سليم: "سليمة" } } });
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليم" }]), mapping);

    expect(rows[0].mapped.xrayLevelOneResult).toBe("سليمة");
    expect(rows[0].validation).toEqual({ valid: true });
  });

  it("matches a value mapping key that differs only by folding", () => {
    const mapping = mappingOf({ valueMappings: { xrayLevelOneResult: { سليم: "سليمة" } } });
    // Tatweel + a diacritic, as a copy-paste out of a formatted document produces.
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سـليم" }]), mapping);

    expect(rows[0].mapped.xrayLevelOneResult).toBe("سليمة");
  });

  it("keeps an already-canonical value untouched", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "اشتباه" }]), mappingOf());

    expect(rows[0].mapped.xrayLevelOneResult).toBe("اشتباه");
    expect(rows[0].validation).toEqual({ valid: true });
  });

  it("stores the canonical spelling when the raw value matches only after folding", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمه" }]), mappingOf());

    // Not "سليمه": strictly-typed consumers read this value.
    expect(rows[0].mapped.xrayLevelOneResult).toBe("سليمة");
  });

  it("names the offending value and the accepted options when a value cannot be resolved", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "مشبوه جدا" }]), mappingOf());

    expect(rows[0].validation.valid).toBe(false);
    const reason = rows[0].validation.valid === false ? rows[0].validation.reason : "";
    expect(reason).toContain("مشبوه جدا");
    expect(reason).toContain("نتيجة المستوى الأول");
    expect(reason).toContain("سليمة");
    expect(reason).toContain("اشتباه");
    // The unresolved text never becomes a stored value.
    expect(rows[0].mapped.xrayLevelOneResult).toBeNull();
  });

  it("leaves an unmapped optional enum null and valid", () => {
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }]), mappingOf());

    expect(rows[0].mapped.certScanStatus).toBeNull();
    expect(rows[0].validation).toEqual({ valid: true });
  });

  it("reports a bad enum value ahead of the emptiness it also causes", () => {
    const mapping = mappingOf({ valueMappings: {} });
    const rows = project(tableOf([{ معرف: "A-1", النتيجة: "؟؟" }]), mapping);

    const reason = rows[0].validation.valid === false ? rows[0].validation.reason : "";
    expect(reason).toContain("؟؟");
    expect(reason).not.toContain("فارغ أو غير مربوط");
  });
});

describe("projectTable — duplicate identities", () => {
  it("keeps the first occurrence valid and invalidates the later one", () => {
    const rows = project(
      tableOf([
        { معرف: "A-1", النتيجة: "سليمة" },
        { معرف: "A-1", النتيجة: "سليمة" },
      ]),
      mappingOf()
    );

    expect(rows[0].validation).toEqual({ valid: true });
    expect(rows[1].validation.valid).toBe(false);
    expect(rows[1].validation.valid === false && rows[1].validation.reason).toContain("A-1");
  });

  it("catches a duplicate that spans two sheets through a shared seenIds set", () => {
    const seenIds = new Set<string>();
    const first = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }], "ورقة1"), mappingOf(), seenIds);
    const second = project(
      tableOf([{ معرف: "A-1", النتيجة: "سليمة" }], "ورقة2"),
      mappingOf(),
      seenIds
    );

    expect(first[0].validation).toEqual({ valid: true });
    expect(second[0].validation.valid).toBe(false);
  });

  it("checks each table on its own when no set is shared", () => {
    const first = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }], "ورقة1"), mappingOf());
    const second = project(tableOf([{ معرف: "A-1", النتيجة: "سليمة" }], "ورقة2"), mappingOf());

    expect(first[0].validation).toEqual({ valid: true });
    expect(second[0].validation).toEqual({ valid: true });
  });

  it("does not let an already-invalid row claim an id its usable twin needs", () => {
    const rows = project(
      tableOf([
        { معرف: "A-1", النتيجة: "قيمة غريبة" },
        { معرف: "A-1", النتيجة: "سليمة" },
      ]),
      mappingOf()
    );

    expect(rows[0].validation.valid).toBe(false);
    expect(rows[1].validation).toEqual({ valid: true });
  });
});
