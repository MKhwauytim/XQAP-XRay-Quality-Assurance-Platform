// Golden-snapshot coverage for the management deck (P3-7). No dedicated test
// file existed before this one — `managementWorkbook.test.ts` only covers the
// Excel edition. Byte-identical proof that adding `await yieldToMain()` breaks
// inside `managementDeckSlides`/`buildManagementDeck` (main-thread chunking,
// P3-7) changed ONLY timing, never output. If this snapshot ever needs
// updating for a real content change, that change must be deliberate and
// reviewed on its own — never used to paper over an unintended regression
// introduced by a chunking edit.

import { describe, expect, it } from "vitest";

import { buildManagementDeck } from "./managementDeck";
import { makeRow } from "../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";

function input(): ExecutiveReportInput {
  return {
    monthFolderName: "6-June-2026",
    populationRows: [
      makeRow("IMG-1", "منفذ أ", { certScanStatus: "Certscan" }),
      makeRow("IMG-2", "منفذ ب", { xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" }),
    ],
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildManagementDeck", () => {
  it("renders a self-contained deck with the month label and headline KPIs", async () => {
    const html = await buildManagementDeck(input());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("عرض الإدارة");
    expect(html).toContain("class=\"slide");
  });
});

describe("management deck — golden snapshot (P3-7 chunking safety)", () => {
  it("output is byte-identical", async () => {
    expect(await buildManagementDeck(input())).toMatchSnapshot();
  });
});
