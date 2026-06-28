import { describe, it, expect } from "vitest";
import { createEmptyDocument, REPORT_SCHEMA_VERSION } from "./reportTypes";

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
