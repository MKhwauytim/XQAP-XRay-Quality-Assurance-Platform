// R3 restructure: management deck now renders the progress/accountability
// `ManagementModel` (section 1 per stage, section 2 per port, replacement
// reasons, reassignment count) instead of the accuracy-shaped executive
// `ReportModel`. Byte-identical golden snapshot removed on purpose — the
// model itself changed, so there is no meaningful "unintended diff" to pin;
// content-level assertions below cover the new sections instead.

import { describe, expect, it } from "vitest";

import { buildManagementDeck } from "./managementDeck";
import { makeRow, makeDistribution } from "../reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "../executiveReportTypes";
import type { ExecutiveReportInput } from "../executiveReportTypes";

function input(): ExecutiveReportInput {
  return {
    monthFolderName: "6-June-2026",
    populationRows: [],
    sample: null,
    distribution: makeDistribution([
      { id: "IMG-1", assignedTo: "u1", status: "completed", row: makeRow("IMG-1", "منفذ أ", { stage: "المستوى الأول" }) },
      { id: "IMG-2", assignedTo: "u2", status: "replaced", row: makeRow("IMG-2", "منفذ ب", { stage: "المستوى الثاني" }), replacedById: "IMG-9" },
    ], { totalAssigned: 2, totalCompleted: 1, totalPending: 0, totalReplaced: 1 }),
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    replacementReasons: { "IMG-2": "جودة صورة منخفضة" },
  };
}

describe("buildManagementDeck", () => {
  it("renders a self-contained deck with the month label and headline KPIs", async () => {
    const html = await buildManagementDeck(input(), { u1: "أحمد", u2: "سارة" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("عرض الإدارة");
    expect(html).toContain("class=\"slide");
  });

  it("renders section 1 (per stage) and section 2 (per port)", async () => {
    const html = await buildManagementDeck(input(), { u1: "أحمد", u2: "سارة" });
    expect(html).toContain("القسم 1 — حسب المستوى");
    expect(html).toContain("القسم 2 — حسب المنفذ");
    expect(html).toContain("المستوى الأول");
    expect(html).toContain("منفذ أ");
  });

  it("renders the replacement reason", async () => {
    const html = await buildManagementDeck(input(), { u1: "أحمد", u2: "سارة" });
    expect(html).toContain("جودة صورة منخفضة");
  });

  it("handles a null distribution without throwing", async () => {
    const html = await buildManagementDeck({ ...input(), distribution: null });
    expect(html).toContain("لا توجد بيانات");
  });
});
