// D3 (Batch 3) — import-mapping edge-case tests for `buildColumnHintsFromRows`, the pure
// function that resolves a workbook's actual column headers against `PopulationConfig`'s
// field->alias mappings (`systemFields` + `mappingTemplates[0].columnMappings` /
// `.biColumnMappings`). This is the function whose output (`riskColumnHints` / `biColumnHints`
// in Population/index.tsx) is passed into MappingSettingsModal's `processingContext` prop and
// rendered as the "sheets" tab's per-field detected-column hints (`ColumnHints`, which shows
// "لم يتم العثور على تطابق واضح" for a field with zero matches).
//
// SCOPE: this exercises the pure mapping function directly — it does NOT render
// MappingSettingsModal or the Population wizard. The function was extracted out of index.tsx
// (see columnMappingHints.ts) specifically so that was possible without pulling in xlsx, the
// Excel-parse Web Worker, or React.
//
// GAP NOTED (not fixed here): the function only auto-detects `config.systemFields` —
// `config.customFields` are never included in the result, even though MappingSettingsModal lets
// users configure risk/BI aliases for custom fields too. Pinned below as a characterization test.

import { describe, expect, it } from "vitest";

import { buildColumnHintsFromRows } from "./columnMappingHints";
import type {
  MappingTemplate,
  PopulationConfig,
  SystemField,
} from "../../../../../data/population/populationConfig";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";

function row(rawRow: Record<string, unknown>): { rawRow: Record<string, unknown> } {
  return { rawRow };
}

// A small, deliberately unambiguous field/alias set — distinct enough from each other that no
// two aliases can accidentally substring-match one another. (The real DEFAULT config has closely
// related labels like "اسم المنفذ" / "رمز المنفذ" that DO cross-match — see the dedicated
// real-default-config block at the bottom, which documents that on purpose.)
const SYSTEM_FIELDS: SystemField[] = [
  { key: "xrayImageId", labelAr: "معرف الأشعة", isRequired: true, dataType: "string" },
  { key: "portName", labelAr: "اسم المنفذ", isRequired: false, dataType: "string" },
  { key: "declarationNumber", labelAr: "رقم البيان", isRequired: true, dataType: "string" },
];

const TEMPLATE: MappingTemplate = {
  templateId: "test-template",
  name: "قالب اختبار",
  sheetPatterns: { risk: [], bi: [] },
  columnMappings: {
    xrayImageId: ["XRAY_SCAN_ID"],
    declarationNumber: ["DECL_NO"],
  },
  biColumnMappings: {
    portName: ["PORT_NAME_BI"],
  },
};

function makeConfig(overrides: Partial<PopulationConfig> = {}): PopulationConfig {
  return {
    ...DEFAULT_POPULATION_CONFIG,
    systemFields: SYSTEM_FIELDS,
    mappingTemplates: [TEMPLATE],
    ...overrides,
  };
}

describe("buildColumnHintsFromRows — extra source columns", () => {
  it("ignores a header that matches no field or alias — it never appears in any hint list", () => {
    const config = makeConfig();
    const rows = [
      row({
        XRAY_SCAN_ID: "IMG1",
        "اسم المنفذ": "جدة",
        "عمود123_غير_مرتبط_بأي_حقل": "قيمة زائدة",
      }),
    ];

    const hints = buildColumnHintsFromRows(rows, config);

    const allMatchedHeaders = Object.values(hints).flat();
    expect(allMatchedHeaders).not.toContain("عمود123_غير_مرتبط_بأي_حقل");
    expect(hints.declarationNumber).toEqual([]);
  });

  it("does not invent a new field key for an unmapped header — result key-set is exactly systemFields", () => {
    const config = makeConfig();
    const rows = [row({ "عمود123_غير_مرتبط_بأي_حقل": "قيمة" })];

    const hints = buildColumnHintsFromRows(rows, config);

    expect(Object.keys(hints).sort()).toEqual(
      ["declarationNumber", "portName", "xrayImageId"].sort()
    );
  });
});

describe("buildColumnHintsFromRows — missing required columns", () => {
  it("keeps a required field's key in the result (mapped to []) instead of dropping it, when no header matches", () => {
    const config = makeConfig();
    // Only a portName header is present — xrayImageId and declarationNumber (both required)
    // have no matching header anywhere in this row.
    const rows = [row({ "اسم المنفذ": "جدة" })];

    const hints = buildColumnHintsFromRows(rows, config);

    // The field is not silently dropped from the result: the key is present, empty.
    expect(hints).toHaveProperty("xrayImageId");
    expect(hints.xrayImageId).toEqual([]);
    expect(hints).toHaveProperty("declarationNumber");
    expect(hints.declarationNumber).toEqual([]);
  });

  it("lets a caller derive which required fields are unresolved via isRequired + an empty hint list", () => {
    const config = makeConfig();
    const rows = [row({ "اسم المنفذ": "جدة" })];

    const hints = buildColumnHintsFromRows(rows, config);
    const unresolvedRequired = config.systemFields
      .filter((field) => field.isRequired && (hints[field.key]?.length ?? 0) === 0)
      .map((field) => field.key);

    // This is exactly the signal a "missing required column" error/warning would be built on —
    // MappingSettingsModal's ColumnHints already renders the empty-array case as a warning;
    // isRequired is what would let a caller distinguish "warn" from "info" for that same signal.
    expect(unresolvedRequired.sort()).toEqual(["declarationNumber", "xrayImageId"]);
    expect(unresolvedRequired).not.toContain("portName");
  });

  it("resolves once a matching header is supplied (required field is no longer flagged)", () => {
    const config = makeConfig();
    const rows = [row({ "معرف الأشعة": "IMG1" })]; // xrayImageId's own canonical label, used as the header

    const hints = buildColumnHintsFromRows(rows, config);

    expect(hints.xrayImageId).toEqual(["معرف الأشعة"]);
  });
});

describe("buildColumnHintsFromRows — renamed / aliased columns", () => {
  it("maps a header that matches only a configured alias, not the canonical Arabic label", () => {
    const config = makeConfig();
    const rows = [row({ DECL_NO: "12345" })]; // declarationNumber's alias; textually unrelated to "رقم البيان"

    const hints = buildColumnHintsFromRows(rows, config);

    expect(hints.declarationNumber).toEqual(["DECL_NO"]);
  });

  it("matches a biColumnMappings-only alias too — the alias pool is pooled, not filtered by data source", () => {
    const config = makeConfig();
    const rows = [row({ PORT_NAME_BI: "الرياض" })];

    const hints = buildColumnHintsFromRows(rows, config);

    expect(hints.portName).toEqual(["PORT_NAME_BI"]);
  });

  it("is hamza/taa-marbuta insensitive when matching against the canonical label (Arabic header normalization)", () => {
    const config = makeConfig();
    // "الأشعة" spelled without the hamza and with ه instead of ة: still normalizes to the same
    // token as xrayImageId's labelAr "معرف الأشعة" via normalizeHeaderToken's text folding.
    const rows = [row({ "معرف الاشعه": "IMG1" })];

    const hints = buildColumnHintsFromRows(rows, config);

    expect(hints.xrayImageId).toEqual(["معرف الاشعه"]);
  });

  it("leaves a header matching no alias unmapped on an optional field — that is not an error", () => {
    const config = makeConfig();
    const rows = [row({ "اسم غير معروف تماما": "x" })];

    const hints = buildColumnHintsFromRows(rows, config);

    // portName is optional: an empty hint list here carries no warning semantics — the shape is
    // identical to the required-field-miss case above, and only field.isRequired tells them apart.
    expect(hints.portName).toEqual([]);
  });
});

describe("buildColumnHintsFromRows — field coverage & scope", () => {
  it("[characterization] only auto-detects config.systemFields; config.customFields are never included", () => {
    const config = makeConfig({
      customFields: [{ key: "customPort", labelAr: "ميناء مخصص", dataType: "string" }],
    });
    const rows = [row({ "ميناء مخصص": "جدة" })];

    const hints = buildColumnHintsFromRows(rows, config);

    expect(hints).not.toHaveProperty("customPort");
  });
});

describe("buildColumnHintsFromRows — against the real DEFAULT_POPULATION_CONFIG", () => {
  it("resolves a default alias and still ignores an unrelated extra column", () => {
    const rows = [row({ "معرف الأشعة": "IMG1", "عمود123_غير_موجود_في_القالب": "زائد" })];

    const hints = buildColumnHintsFromRows(rows, DEFAULT_POPULATION_CONFIG);

    expect(hints.xrayImageId).toContain("معرف الأشعة");
    expect(Object.values(hints).flat()).not.toContain("عمود123_غير_موجود_في_القالب");
  });

  it("[characterization] a single header can satisfy more than one field's alias pool via substring fuzzy-matching", () => {
    // Real DEFAULT_MAPPING_TEMPLATE: portCode's aliases include the bare word "المنفذ" ("the
    // port"), which is a substring of portName's own label "اسم المنفذ" ("port name"). The
    // matcher accepts normalized.includes(alias) in either direction, so one "اسم المنفذ" header
    // is attributed to BOTH fields' hint lists. Documented here as existing behavior — resolving
    // the ambiguity (if desired) is a judgment call left to a future change, not this test batch.
    const rows = [row({ "اسم المنفذ": "جدة" })];

    const hints = buildColumnHintsFromRows(rows, DEFAULT_POPULATION_CONFIG);

    expect(hints.portName).toContain("اسم المنفذ");
    expect(hints.portCode).toContain("اسم المنفذ");
  });
});
