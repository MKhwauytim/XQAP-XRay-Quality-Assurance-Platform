// Wave 3 (audit C-07) — XSS regression tests for the NEW report builders that
// produce HTML: the population report (document + deck) and the management
// deck. (The management DOCUMENT is covered in executiveBuilders.xss.test.ts;
// the workbooks produce no HTML.)
//
// Each builder is fed the shared XSS corpus through every user-controlled vector
// it interpolates (port names, ids, results, employee names, month label).
// Every block asserts nothing renders as live markup (`findLiveInjection`
// null) while the injected marker + an escaped `<script>` are present — guarding
// against a false pass where the malicious field is simply dropped.

import { describe, expect, it } from "vitest";

import { buildPopulationDocument, buildPopulationDeck } from "./populationReport";
import type { PopulationReportInput } from "./populationReport/model";
import { buildManagementDeck } from "./management/managementDeck";
import { buildManagementReport } from "./management/managementReport";
import { makeRow, makeDistribution } from "./reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import { XSS_COMBINED, XSS_MARKER, XSS_PAYLOADS, findLiveInjection } from "./xssPayloads";

function assertSafe(html: string): void {
  expect(findLiveInjection(html)).toBeNull();
  expect(html).toContain(XSS_MARKER);
  expect(html).toContain("&lt;script&gt;");
}

// ── Population report ────────────────────────────────────────────────────────

function maliciousPopulationInput(): PopulationReportInput {
  const row1 = makeRow("IMG-1", XSS_COMBINED, {
    biEnrichmentStatus: "BI Matched", certScanStatus: "Certscan",
    xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه",
  });
  const row2 = makeRow("IMG-2", XSS_PAYLOADS.imgOnerror, { certScanStatus: "NonCertscan" });
  const distribution = makeDistribution([
    { id: "IMG-1", assignedTo: "evil-user", status: "completed", row: row1 },
  ]);
  return {
    // monthFolderName doesn't match the "N-month-YYYY" pattern, so
    // formatMonthLabel falls back to the raw string — it renders verbatim
    // (escaped) in both the cover/closing chrome and the document's own
    // <title>/sidebar sub-brand.
    monthFolderName: XSS_PAYLOADS.attrBreak,
    manifest: null,
    processingSummary: null,
    riskRawRowCount: 1,
    biRawRowCount: null,
    populationRows: [row1, row2],
    sampleRows: [row1],
    distributionEntries: distribution.entries,
    employeeDisplayNames: { "evil-user": XSS_PAYLOADS.svgOnload },
  };
}

describe("population report builders — XSS escaping", () => {
  it("document escapes injected port names, employee names and the month label", async () => {
    assertSafe(await buildPopulationDocument(maliciousPopulationInput()));
  });
  it("deck escapes injected port names, employee names and the raw-HTML title slide (month label)", async () => {
    assertSafe(await buildPopulationDeck(maliciousPopulationInput()));
  });
});

// ── Management deck ────────────────────────────────────────────────────────────

const EVIL_USER = "evil-user";

function maliciousExecInput(): { input: ExecutiveReportInput; names: Record<string, string> } {
  const row1 = makeRow("IMG-1", XSS_COMBINED, { notes: XSS_PAYLOADS.svgOnload });
  const row2 = makeRow("IMG-2", XSS_PAYLOADS.imgOnerror, { xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "سليمة" });
  const distribution = makeDistribution([
    { id: "IMG-1", assignedTo: EVIL_USER, status: "completed", row: row1 },
  ], { totalAssigned: 1, totalCompleted: 1 });
  const input: ExecutiveReportInput = {
    // scriptTag → month label renders it verbatim (escaped) in the title slide.
    monthFolderName: XSS_PAYLOADS.scriptTag,
    populationRows: [row1, row2],
    sample: null,
    distribution,
    employeeFiles: [
      {
        username: EVIL_USER,
        monthFolderName: "6-June-2026",
        items: [
          {
            xrayImageId: "IMG-1", templateId: "t", templateVersion: 1,
            answers: [{ fieldId: "qualityImageResult", value: "سليمة" }],
            lastSavedAt: "2026-07-11T00:00:00.000Z", submittedAt: "2026-07-11T00:00:00.000Z",
            answeredBy: EVIL_USER, status: "submitted",
          },
        ],
      },
    ],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
  return { input, names: { [EVIL_USER]: XSS_PAYLOADS.imgOnerror } };
}

describe("management deck — XSS escaping", () => {
  it("escapes injected port names, reviewer names and the month label", async () => {
    const { input, names } = maliciousExecInput();
    assertSafe(await buildManagementDeck(input, names));
  });
});

describe("management document — XSS escaping", () => {
  it("escapes injected port names, reviewer names and the month label", async () => {
    const { input, names } = maliciousExecInput();
    assertSafe(await buildManagementReport(input, names));
  });
});
