import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { createWorkspaceStructure } from "../storage/fileSystemAccess";
import { savePopulationConfig } from "../population/populationConfig";
import { DEFAULT_POPULATION_CONFIG } from "../population/populationConfig";
import { loadActiveColumnMappings, parseAdhocImportFile } from "./adhocImportMapping";

const HEADERS = [
  "اسم المنفذ",
  "نوع المنفذ",
  "المستوى",
  "نتيجة المستوى الأول",
  "نتيجة المستوى الثاني",
  "معرف الأشعة",
];

function buildWorkbookFile(sheets: Record<string, string[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, dataRows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "adhoc.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("adhocImportMapping", () => {
  it("reuses the active population mapping template (config.mappingTemplates[0]) — not a duplicate mapping UI", async () => {
    const root = createMemoryDirectory();
    await createWorkspaceStructure(root, "admin");
    await savePopulationConfig(root, {
      ...DEFAULT_POPULATION_CONFIG,
      mappingTemplates: [
        {
          ...DEFAULT_POPULATION_CONFIG.mappingTemplates[0],
          columnMappings: {
            ...DEFAULT_POPULATION_CONFIG.mappingTemplates[0].columnMappings,
            xrayImageId: ["CUSTOM_ID_COLUMN"],
          },
        },
      ],
    });

    const mappings = await loadActiveColumnMappings(root);
    expect(mappings.xrayImageId).toEqual(["CUSTOM_ID_COLUMN"]);
  });

  it("falls back to the built-in default mapping template when no workspace/config is available", async () => {
    const mappings = await loadActiveColumnMappings(null);
    expect(mappings.xrayImageId).toContain("معرف الأشعة");
  });

  it("parses every worksheet and maps rows via normalizeRiskRow", async () => {
    const file = buildWorkbookFile({
      "ورقة 1": [
        ["ميناء جدة", "بحري", "المستوى الأول", "سليمة", "سليمة", "XR-001"],
        ["ميناء جدة", "بحري", "المستوى الأول", "اشتباه", "سليمة", "XR-002"],
      ],
      "ورقة 2": [
        ["منفذ البطحاء", "بري", "المستوى الثاني", "سليمة", "سليمة", "XR-003"],
      ],
    });

    const mappings = await loadActiveColumnMappings(null);
    const rows = await parseAdhocImportFile(file, mappings);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.mapped.xrayImageId).sort()).toEqual(["XR-001", "XR-002", "XR-003"]);
    expect(rows.every((r) => r.validation.valid)).toBe(true);
    expect(rows.every((r) => r.excludedByAdmin === false && r.assigned === false)).toBe(true);
    // rawRow must be dropped before it leaves the mapping step (mirrors stripRawRow).
    expect(rows.every((r) => r.mapped.rawRow === undefined)).toBe(true);
  });

  it("marks a row invalid when xrayImageId is missing", async () => {
    const file = buildWorkbookFile({
      s1: [["ميناء جدة", "بحري", "المستوى الأول", "سليمة", "سليمة", ""]],
    });
    const mappings = await loadActiveColumnMappings(null);
    const rows = await parseAdhocImportFile(file, mappings);

    expect(rows).toHaveLength(1);
    expect(rows[0].validation.valid).toBe(false);
  });

  it("marks a row invalid when the L1/L2 result is not exactly 'سليمة' or 'اشتباه'", async () => {
    const file = buildWorkbookFile({
      s1: [["ميناء جدة", "بحري", "المستوى الأول", "Pass", "سليمة", "XR-100"]],
    });
    const mappings = await loadActiveColumnMappings(null);
    const rows = await parseAdhocImportFile(file, mappings);

    expect(rows).toHaveLength(1);
    expect(rows[0].validation.valid).toBe(false);
  });

  it("excludes a duplicate xrayImageId (keeps the first occurrence valid)", async () => {
    const file = buildWorkbookFile({
      s1: [
        ["ميناء جدة", "بحري", "المستوى الأول", "سليمة", "سليمة", "XR-DUP"],
        ["ميناء جدة", "بحري", "المستوى الأول", "سليمة", "سليمة", "XR-DUP"],
      ],
    });
    const mappings = await loadActiveColumnMappings(null);
    const rows = await parseAdhocImportFile(file, mappings);

    expect(rows).toHaveLength(2);
    const validCount = rows.filter((r) => r.validation.valid).length;
    expect(validCount).toBe(1);
  });
});
