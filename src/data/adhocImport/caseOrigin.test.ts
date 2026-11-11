import { describe, expect, it } from "vitest";
import { namespacedXrayImageId } from "./adhocImportModel";
import { caseOriginLabel, caseOriginOf, exportedXrayImageId, exportedXrayImageIdOrNull } from "./caseOrigin";

const IMPORT_ID = "adh-3f8a1c2e-1111-4222-b335-fb1422722179";

describe("caseOrigin", () => {
  it("exports an exceptional case under the id from the source file", () => {
    expect(exportedXrayImageId(namespacedXrayImageId(IMPORT_ID, "6203202601050015"))).toBe("6203202601050015");
    expect(exportedXrayImageId(namespacedXrayImageId(IMPORT_ID, "6203202601050015", 2))).toBe("6203202601050015");
    expect(exportedXrayImageId(namespacedXrayImageId("adh-1730000000000-k3x9", "66B4-2026"))).toBe("66B4-2026");
  });

  it("leaves an index case id unchanged", () => {
    expect(exportedXrayImageId("6203202601050015")).toBe("6203202601050015");
    expect(exportedXrayImageId("ADHOC-not-an-import-id")).toBe("ADHOC-not-an-import-id");
    expect(exportedXrayImageIdOrNull(null)).toBeNull();
  });

  it("names the origin from the stored id", () => {
    expect(caseOriginOf(namespacedXrayImageId(IMPORT_ID, "A1"))).toBe("exceptional");
    expect(caseOriginOf("A1")).toBe("index");
    expect(caseOriginLabel(namespacedXrayImageId(IMPORT_ID, "A1"))).toBe("حالة استثنائية");
    expect(caseOriginLabel("A1")).toBe("مستهدف المؤشر");
  });
});
