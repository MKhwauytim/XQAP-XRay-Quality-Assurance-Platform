// D2 (Batch 3) — XSS regression tests for the four report builders that share the
// `ExecutiveReportInput` model:
//   - buildExecutiveReport   (executive document path)
//   - buildExecutiveDeck     (v1 presentation deck — the edition wired to the live button)
//   - buildExecutiveDeckV2   (deck2 presentation)
//   - buildManagementReport  (C2 management report)
//
// They take the identical input type, so one shared `makeMaliciousExecInput()` avoids
// quadruplicating ~70 lines of scaffolding. The corpus is injected through the three vectors
// named in the plan — port names, employee display names, and answer/label fields — and every
// block asserts nothing renders as live markup (`findLiveInjection` null) while the injected
// data is present in escaped form.
//
// The v1-deck block is the regression for the v42.39 fix: a malicious `monthFolderName` drives
// `periodId` into the raw-HTML `titleSlide`, which now routes through `esc()`.

import { describe, expect, it } from "vitest";

import { buildExecutiveReport } from "./executiveReport";
import { buildExecutiveDeck } from "./executive/deck";
import { buildExecutiveDeckV2 } from "./executive/deck2";
import { buildManagementReport } from "./management/managementReport";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";
import type { ExecutiveReportInput } from "./executiveReportTypes";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionCurrentData } from "../distribution/distributionTypes";
import type { EmployeeAnswerFile } from "../answers/answerTypes";
import {
  XSS_COMBINED,
  XSS_MARKER,
  XSS_PAYLOADS,
  findLiveInjection,
} from "./xssPayloads";

const EVIL_REVIEWER = "evil-reviewer";

function makeRow(
  id: string,
  portName: string,
  portType: string,
  overrides: Partial<PreparedPopulationRow> = {},
): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: id,
    xrayEntryDate: null,
    portCode: null,
    portType,
    portName,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "اشتباه",
    xrayLevelTwoResult: "اشتباه",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

/**
 * A fully-wired malicious input:
 *   - port names carry the corpus (row 1 the full combined string incl. the <script> payload),
 *   - `monthFolderName` carries a payload (→ periodId → v1-deck titleSlide),
 *   - `notes` carries a payload (answer/label-style field), and
 *   - a submitted answer + distribution entry make reviewer "evil-reviewer" render, whose display
 *     name is a payload (employee-display-name vector via `employeeDisplayNames`).
 */
function makeMaliciousExecInput(): {
  input: ExecutiveReportInput;
  employeeDisplayNames: Record<string, string>;
} {
  const row1 = makeRow("IMG-1", XSS_COMBINED, "منفذ بري", {
    notes: XSS_PAYLOADS.svgOnload,
  });
  const row2 = makeRow("IMG-2", XSS_PAYLOADS.imgOnerror, "منفذ بحري", {
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
  });
  const populationRows = [row1, row2];

  const distribution: DistributionCurrentData = {
    monthFolderName: "6-June-2026",
    derivedAt: "2026-07-11T00:00:00.000Z",
    totalAssigned: 1,
    totalCompleted: 1,
    totalReplaced: 0,
    totalPending: 0,
    entries: [
      {
        xrayImageId: "IMG-1",
        assignedTo: EVIL_REVIEWER,
        status: "completed",
        replacedById: null,
        lastEventAt: "2026-07-11T00:00:00.000Z",
        row: row1,
      },
    ],
  };

  const employeeFiles: EmployeeAnswerFile[] = [
    {
      username: EVIL_REVIEWER,
      monthFolderName: "6-June-2026",
      items: [
        {
          xrayImageId: "IMG-1",
          templateId: "t",
          templateVersion: 1,
          // config.expertResultFieldId ("qualityImageResult") is the fallback field id when
          // no template is supplied — this makes expertResult resolve, so the row is "studied"
          // and the reviewer profile renders.
          answers: [{ fieldId: "qualityImageResult", value: "سليمة" }],
          lastSavedAt: "2026-07-11T00:00:00.000Z",
          submittedAt: "2026-07-11T00:00:00.000Z",
          answeredBy: EVIL_REVIEWER,
          status: "submitted",
        },
      ],
    },
  ];

  const input: ExecutiveReportInput = {
    // Not a valid N-Month-YYYY folder → periodIdFromFolder returns it verbatim → periodId payload.
    // Uses the <script> payload so the escaped `&lt;script&gt;` proof holds in EVERY builder
    // (periodId / month label renders unconditionally in each — including the v1-deck titleSlide,
    // whose top-N port slides may collapse to an insufficient-data empty state).
    monthFolderName: XSS_PAYLOADS.scriptTag,
    populationRows,
    sample: null,
    distribution,
    employeeFiles,
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };

  return { input, employeeDisplayNames: { [EVIL_REVIEWER]: XSS_PAYLOADS.imgOnerror } };
}

describe("buildExecutiveReport (executive document) — XSS escaping", () => {
  it("never renders injected markup as live HTML", () => {
    const { input, employeeDisplayNames } = makeMaliciousExecInput();
    const html = buildExecutiveReport(input, employeeDisplayNames);
    expect(findLiveInjection(html)).toBeNull();
  });

  it("renders the injected port name escaped (marker + escaped <script> present)", () => {
    const { input, employeeDisplayNames } = makeMaliciousExecInput();
    const html = buildExecutiveReport(input, employeeDisplayNames);
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});

describe("buildExecutiveDeck (v1 deck) — XSS escaping (periodId regression, v42.39)", () => {
  it("escapes periodId in the raw-HTML title slide and all port names", () => {
    const { input, employeeDisplayNames } = makeMaliciousExecInput();
    const html = buildExecutiveDeck(input, employeeDisplayNames);
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildExecutiveDeckV2 (deck2) — XSS escaping", () => {
  it("escapes injected data but keeps its own legitimate <script> nav chrome", () => {
    const { input, employeeDisplayNames } = makeMaliciousExecInput();
    const html = buildExecutiveDeckV2(input, employeeDisplayNames);
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
    // The deck legitimately emits its OWN nav <script> — the detector must not treat that as
    // an injection (it keys on `<script>alert`, not a bare `<script>`).
    expect(html).toContain("<script>");
  });
});

describe("buildManagementReport (C2 management report) — XSS escaping", () => {
  it("escapes injected port names and reviewer display names", () => {
    const { input, employeeDisplayNames } = makeMaliciousExecInput();
    const html = buildManagementReport(input, employeeDisplayNames);
    expect(findLiveInjection(html)).toBeNull();
    expect(html).toContain(XSS_MARKER);
    expect(html).toContain("&lt;script&gt;");
  });
});
