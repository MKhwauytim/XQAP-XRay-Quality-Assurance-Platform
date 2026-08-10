import { describe, expect, it } from "vitest";
import type {
  PopulationConfig,
  ProcessingWorkflowStep,
} from "../../../../../data/population/populationConfig";
import { DEFAULT_POPULATION_CONFIG } from "../../../../../data/population/populationConfig";
import {
  buildAliasFieldGroups,
  findAliasOverlaps,
  mergeMappingAliases,
  normalizeWorkflowOrders,
  parseMappingAliases,
} from "./mappingSettingsConfig";

describe("mapping settings config helpers", () => {
  it("normalizes comma-separated aliases and removes empty entries", () => {
    expect(parseMappingAliases(" رقم الأشعة, ,Xray ID,رقم الأشعة ")).toEqual([
      "رقم الأشعة",
      "Xray ID",
      "رقم الأشعة",
    ]);
  });

  it("merges detected aliases without discarding configured aliases", () => {
    expect(
      mergeMappingAliases(
        { imageId: ["المعرف", "ID"] },
        { imageId: ["ID", "Image ID"], port: ["المنفذ"] },
      ),
    ).toEqual({
      imageId: ["المعرف", "ID", "Image ID"],
      port: ["المنفذ"],
    });
  });

  it("returns new workflow steps with stable ten-point ordering", () => {
    const steps = [
      { stepId: "second", order: 99 },
      { stepId: "first", order: 1 },
    ] as ProcessingWorkflowStep[];

    const normalized = normalizeWorkflowOrders(steps);

    expect(normalized.map(({ stepId, order }) => ({ stepId, order }))).toEqual([
      { stepId: "second", order: 10 },
      { stepId: "first", order: 20 },
    ]);
    expect(normalized[0]).not.toBe(steps[0]);
  });
});

describe("findAliasOverlaps", () => {
  it("flags a column alias claimed by two different column fields", () => {
    // Two COLUMN fields both claiming the header "المستوى الأول" is a genuine conflict: a single
    // column header cannot map to two target fields, so one of them will silently lose.
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      systemFields: [
        { key: "xrayLevelOneResult", labelAr: "نتيجة المستوى الأول", isRequired: true, dataType: "string" },
        { key: "xrayLevelTwoResult", labelAr: "نتيجة المستوى الثاني", isRequired: true, dataType: "string" },
      ],
      customFields: [],
      mappingTemplates: [
        {
          templateId: "t",
          name: "t",
          sheetPatterns: { risk: [], bi: [] },
          columnMappings: {
            xrayLevelOneResult: ["سليم", "المستوى الأول"],
            xrayLevelTwoResult: ["المستوى الأول"],
          },
        },
      ],
      stageMappings: { first: [], second: [], third: [], fourth: [] },
    };

    const warnings = findAliasOverlaps(buildAliasFieldGroups(config));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.alias).toBe("المستوى الأول");
    expect(warnings[0]!.fields.map((field) => field.key).sort()).toEqual(
      ["xrayLevelOneResult", "xrayLevelTwoResult"].sort(),
    );
  });

  it("reports NO overlap for the shipped defaults — a warning that always fires would train users to ignore every warning", () => {
    // "المستوى الاول" appears twice in the shipped defaults, but in two different namespaces:
    // as a COLUMN-HEADER alias for `xrayLevelOneResult` (a column titled "المستوى الاول" holds
    // the level-one result) and as a STAGE-VALUE alias for `first` (a cell containing
    // "المستوى الاول" denotes the first stage). Column names and cell values are matched against
    // entirely different things, so they never compete. Flagging this would mean the validation
    // fires on an untouched install — the same failure mode as the `نوع الحركة` "no match" hint
    // that was just removed for reporting a structurally impossible problem.
    expect(findAliasOverlaps(buildAliasFieldGroups(DEFAULT_POPULATION_CONFIG))).toEqual([]);
  });

  it("does not flag the same string used as both a column alias and a stage-value alias", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      mappingTemplates: [
        {
          ...DEFAULT_POPULATION_CONFIG.mappingTemplates[0],
          columnMappings: {
            ...DEFAULT_POPULATION_CONFIG.mappingTemplates[0].columnMappings,
            xrayLevelOneResult: ["SHARED_TOKEN"],
          },
        },
      ],
      stageMappings: {
        ...DEFAULT_POPULATION_CONFIG.stageMappings,
        first: ["SHARED_TOKEN"],
      },
    };

    expect(findAliasOverlaps(buildAliasFieldGroups(config))).toEqual([]);
  });

  it("DOES flag the same string repeated across two stage-value lists", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      stageMappings: {
        ...DEFAULT_POPULATION_CONFIG.stageMappings,
        first: ["COLLIDING"],
        second: ["COLLIDING"],
      },
    };

    const warnings = findAliasOverlaps(buildAliasFieldGroups(config));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].alias).toBe("COLLIDING");
    expect(warnings[0].fields.map((field) => field.key).sort()).toEqual([
      "stage:first",
      "stage:second",
    ]);
  });

  it("does not flag the same alias configured twice under the same field (Risk + BI pooled)", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      systemFields: [
        { key: "xrayImageId", labelAr: "معرف الأشعة", isRequired: true, dataType: "string" },
      ],
      customFields: [],
      mappingTemplates: [
        {
          templateId: "t",
          name: "t",
          sheetPatterns: { risk: [], bi: [] },
          columnMappings: { xrayImageId: ["ID"] },
          biColumnMappings: { xrayImageId: ["ID"] },
        },
      ],
      stageMappings: { first: [], second: [], third: [], fourth: [] },
    };

    expect(findAliasOverlaps(buildAliasFieldGroups(config))).toEqual([]);
  });

  it("ignores blank/whitespace-only aliases", () => {
    const config: PopulationConfig = {
      ...DEFAULT_POPULATION_CONFIG,
      systemFields: [
        { key: "a", labelAr: "حقل أ", isRequired: false, dataType: "string" },
        { key: "b", labelAr: "حقل ب", isRequired: false, dataType: "string" },
      ],
      customFields: [],
      mappingTemplates: [
        {
          templateId: "t",
          name: "t",
          sheetPatterns: { risk: [], bi: [] },
          columnMappings: { a: [""], b: [""] },
        },
      ],
      stageMappings: { first: [], second: [], third: [], fourth: [] },
    };

    expect(findAliasOverlaps(buildAliasFieldGroups(config))).toEqual([]);
  });
});
