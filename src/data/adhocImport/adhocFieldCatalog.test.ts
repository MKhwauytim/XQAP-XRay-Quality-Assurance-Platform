import { describe, expect, it } from "vitest";

import { ADHOC_FIELD_CATALOG, getAdhocField } from "./adhocFieldCatalog";

describe("ADHOC_FIELD_CATALOG", () => {
  it("keeps field keys unique", () => {
    const keys = ADHOC_FIELD_CATALOG.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("requires xrayImageId and nothing else", () => {
    // L1/L2/stage are required in the Population catalog; a bare image list is
    // a legitimate ad-hoc import and must not fail every row over them.
    expect(
      ADHOC_FIELD_CATALOG.filter((field) => field.required).map((field) => field.key)
    ).toEqual(["xrayImageId"]);
  });

  it("gives every enum field its canonical options and no other field options", () => {
    for (const field of ADHOC_FIELD_CATALOG) {
      if (field.kind === "enum") {
        expect(field.options, field.key).toBeDefined();
        expect(field.options?.length, field.key).toBeGreaterThan(0);
      } else {
        expect(field.options, field.key).toBeUndefined();
      }
    }
  });

  it("classifies the enum, date and month fields", () => {
    const kindOf = (key: string) => getAdhocField(ADHOC_FIELD_CATALOG, key)?.kind;
    expect(kindOf("xrayLevelOneResult")).toBe("enum");
    expect(kindOf("xrayLevelTwoResult")).toBe("enum");
    expect(kindOf("certScanStatus")).toBe("enum");
    expect(kindOf("stage")).toBe("enum");
    expect(kindOf("xrayEntryDate")).toBe("date");
    expect(kindOf("studyMonth")).toBe("month");
    expect(kindOf("portName")).toBe("text");
  });

  it("uses the exact canonical option values the rest of the app stores", () => {
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "xrayLevelOneResult")?.options).toEqual([
      "سليمة",
      "اشتباه",
    ]);
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "xrayLevelTwoResult")?.options).toEqual([
      "سليمة",
      "اشتباه",
    ]);
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "certScanStatus")?.options).toEqual([
      "Certscan",
      "NonCertscan",
    ]);
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "stage")?.options).toEqual([
      "المستوى الأول",
      "المستوى الثاني",
      "المستوى الثالث",
      "المستوى الرابع",
    ]);
  });

  it("carries the two fields the Population catalog does not have", () => {
    const certScan = getAdhocField(ADHOC_FIELD_CATALOG, "certScanStatus");
    const studyMonth = getAdhocField(ADHOC_FIELD_CATALOG, "studyMonth");
    expect(certScan?.labelAr).toBe("حالة CertScan");
    expect(studyMonth?.labelAr).toBe("شهر الفحص");
    expect(studyMonth?.required).toBe(false);
    expect(studyMonth?.seedAliases.length).toBeGreaterThan(1);
  });

  it("seeds every field with at least one alias", () => {
    for (const field of ADHOC_FIELD_CATALOG) {
      expect(field.seedAliases.length, field.key).toBeGreaterThan(0);
      expect(field.labelAr.trim(), field.key).not.toBe("");
    }
  });
});

describe("getAdhocField", () => {
  it("finds a field by key and returns undefined for an unknown one", () => {
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "portName")?.labelAr).toBe("اسم المنفذ");
    expect(getAdhocField(ADHOC_FIELD_CATALOG, "notAField")).toBeUndefined();
  });
});
