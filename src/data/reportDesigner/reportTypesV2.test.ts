import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "./reportTypes";
import { DEFAULT_LAYOUT, createEmptyDocumentV2, isV2 } from "./reportTypesV2";

describe("reportTypesV2", () => {
  it("recognises a v2 document", () => {
    expect(isV2(createEmptyDocumentV2("ت", "admin"))).toBe(true);
  });
  it("does not treat a v1 document as v2", () => {
    expect(isV2(createEmptyDocument("ت", "admin"))).toBe(false);
    expect(isV2(null)).toBe(false);
  });
  it("builds an empty v2 doc with layout, 16:9 setup and no theme", () => {
    const doc = createEmptyDocumentV2("ت", "admin");
    expect(doc.layout).toEqual(DEFAULT_LAYOUT);
    expect(doc.pageSetup.width).toBe(1280);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toHaveLength(0);
    expect("theme" in doc).toBe(false);
  });
});
