// Wave 3 (audit C-07) — XSS regression tests for the NEW report builders that
// produce HTML: sample (document + deck), distribution (document + deck), and the
// management deck. (The management DOCUMENT is covered in
// executiveBuilders.xss.test.ts; the workbooks produce no HTML.)
//
// Each builder is fed the shared XSS corpus through every user-controlled vector
// it interpolates (port names, ids, results, seed/drawnBy, employee names, month
// label). Every block asserts nothing renders as live markup (`findLiveInjection`
// null) while the injected marker + an escaped `<script>` are present — guarding
// against a false pass where the malicious field is simply dropped.

import { describe, expect, it } from "vitest";

import { buildSampleDocument, buildSampleDeck, type SampleReportInput } from "./sampleReport";
import { buildDistributionDocument, buildDistributionDeck } from "./distributionReport";
import { buildManagementDeck } from "./management/managementDeck";
import { makeRow, makeManifest, makeSampleMaster, makeDistribution } from "./reportTestFixtures";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import type { PortAllocation } from "./../sampling/sampleTypes";
import { XSS_COMBINED, XSS_MARKER, XSS_PAYLOADS, findLiveInjection } from "./xssPayloads";

function assertSafe(html: string): void {
  expect(findLiveInjection(html)).toBeNull();
  expect(html).toContain(XSS_MARKER);
  expect(html).toContain("&lt;script&gt;");
}

// ── Sample ───────────────────────────────────────────────────────────────────

function maliciousSampleInput(): SampleReportInput {
  const row1 = makeRow(XSS_PAYLOADS.attrBreak, XSS_COMBINED, {
    biEnrichmentStatus: "BI Matched", certScanStatus: "Certscan",
    xrayLevelOneResult: "اشتباه", xrayLevelTwoResult: "اشتباه",
  });
  const row2 = makeRow("IMG-2", XSS_PAYLOADS.imgOnerror, { certScanStatus: "NonCertscan" });
  const alloc: PortAllocation = {
    portName: XSS_COMBINED, populationSize: 1, certScanCount: 1, nonCertScanCount: 0,
    allocatedQuota: 1, certScanQuota: 1, nonCertScanQuota: 0,
    actualCertScanDrawn: 1, actualNonCertScanDrawn: 0, actualTotalDrawn: 1,
  };
  const sample = makeSampleMaster([row1], {
    // scriptTag in the seed renders unconditionally in the title slide + doc subtitle.
    rngSeed: XSS_PAYLOADS.scriptTag,
    drawnBy: XSS_PAYLOADS.svgOnload,
    totalActual: 1, totalRequested: 2, certScanActual: 1, nonCertScanActual: 0,
    portAllocations: [alloc],
  });
  return { monthFolderName: "6-June-2026", manifest: makeManifest(), populationRows: [row1, row2], sample };
}

describe("sample builders — XSS escaping", () => {
  it("document escapes injected port names, ids, seed and drawnBy", () => {
    assertSafe(buildSampleDocument(maliciousSampleInput()));
  });
  it("deck escapes injected port names and the raw-HTML title slide (seed)", () => {
    assertSafe(buildSampleDeck(maliciousSampleInput()));
  });
});

// ── Distribution ──────────────────────────────────────────────────────────────

const EVIL_USER = "evil-user";

function maliciousDistribution() {
  return makeDistribution([
    { id: XSS_PAYLOADS.attrBreak, assignedTo: EVIL_USER, status: "replacement-requested", row: makeRow(XSS_PAYLOADS.attrBreak, XSS_COMBINED) },
    { id: "IMG-2", assignedTo: EVIL_USER, status: "replaced", row: makeRow("IMG-2", XSS_PAYLOADS.imgOnerror), replacedById: XSS_PAYLOADS.svgOnload },
  ], { totalAssigned: 2, totalReplaced: 1 });
}

describe("distribution builders — XSS escaping", () => {
  it("document escapes injected ids, port names and display names", () => {
    // monthFolderName carries scriptTag → month label renders it verbatim (escaped).
    const html = buildDistributionDocument(maliciousDistribution(), XSS_PAYLOADS.scriptTag, { [EVIL_USER]: XSS_COMBINED });
    assertSafe(html);
  });
  it("deck escapes injected data and the raw-HTML title slide (month label)", () => {
    const html = buildDistributionDeck(maliciousDistribution(), XSS_PAYLOADS.scriptTag, { [EVIL_USER]: XSS_COMBINED });
    assertSafe(html);
  });
});

// ── Management deck ────────────────────────────────────────────────────────────

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
  it("escapes injected port names, reviewer names and the month label", () => {
    const { input, names } = maliciousExecInput();
    assertSafe(buildManagementDeck(input, names));
  });
});
