import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION, SLIDE_16_9, SLIDE_4_3, SLIDE_FHD, getPageSetup, SLIDE_PRESETS } from "./reportTypes";

describe("createEmptyDocument", () => {
  it("creates a print A4 document with one empty page", () => {
    const doc = createEmptyDocument("تقرير تجريبي", "admin");
    expect(doc.reportName).toBe("تقرير تجريبي");
    expect(doc.createdBy).toBe("admin");
    expect(doc.docType).toBe("print");
    expect(doc.pageSetup.size).toBe("A4");
    expect(doc.pageSetup.orientation).toBe("portrait");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].elements).toEqual([]);
    expect(doc.reportId).toMatch(/^rpt-/);
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });
});

describe("slide page-size presets", () => {
  it("SLIDE_16_9 has correct dimensions", () => {
    expect(SLIDE_16_9.width).toBe(1280);
    expect(SLIDE_16_9.height).toBe(720);
    expect(SLIDE_16_9.size).toBe("16:9");
    expect(SLIDE_16_9.orientation).toBe("landscape");
  });

  it("SLIDE_4_3 has correct dimensions", () => {
    expect(SLIDE_4_3.width).toBe(960);
    expect(SLIDE_4_3.height).toBe(720);
    expect(SLIDE_4_3.size).toBe("4:3");
  });

  it("SLIDE_FHD is 1920x1080", () => {
    expect(SLIDE_FHD.width).toBe(1920);
    expect(SLIDE_FHD.height).toBe(1080);
    expect(SLIDE_FHD.size).toBe("16:9-fhd");
  });

  it("getPageSetup returns correct preset", () => {
    expect(getPageSetup("16:9").width).toBe(1280);
    expect(getPageSetup("4:3").width).toBe(960);
    expect(getPageSetup("A4").width).toBe(794);
    expect(getPageSetup("custom").width).toBe(794);
  });

  it("SLIDE_PRESETS has all six named presets", () => {
    expect(Object.keys(SLIDE_PRESETS).sort()).toEqual(["16:9", "16:9-fhd", "4:3", "A4", "Letter", "custom"].sort());
  });
});
