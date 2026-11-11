import { describe, expect, it } from "vitest";
import type { BrowseRow } from "../../../../data/population/populationStorage";
import { getBrowseDisplayValue } from "./browseDisplayValue";

const browseRow = (xrayImageId: string): BrowseRow => ({ xrayImageId, _monthFolder: "1-January-2026", _month: 1, _year: 2026 });

describe("getBrowseDisplayValue — xrayImageId", () => {
  it("shows the operator's id for an exceptional case merged into a month", () => {
    const row = browseRow("ADHOC-adh-3f8a1b2c-1111-4222-8333-944455556666-66B4202601060043");
    expect(getBrowseDisplayValue(row, "xrayImageId")).toBe("66B4202601060043");
  });

  it("leaves a real month id as it is", () => {
    expect(getBrowseDisplayValue(browseRow("202601120020080070"), "xrayImageId")).toBe("202601120020080070");
  });
});
