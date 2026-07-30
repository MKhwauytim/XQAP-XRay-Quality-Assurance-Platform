import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import { buildExecutiveReport } from "./executiveReport";
import { DEFAULT_EXEC_CONFIG } from "./executiveReportTypes";

function row(
  xrayImageId: string,
  overrides: Partial<PreparedPopulationRow> = {}
): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId,
    xrayEntryDate: null,
    portCode: null,
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: null,
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null }
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

describe("executive report html", () => {
  it("renders the A4 executive document in Arabic with SVG icons, not emoji", async () => {
    const html = await buildExecutiveReport({
      monthFolderName: "6-June-2026",
      populationRows: [
        row("XR-1", { portType: "منفذ بري", portName: "جديدة عرعر" }),
        row("XR-2", {
          portType: "منفذ بحري",
          portName: "ميناء جدة الإسلامي",
          xrayLevelOneResult: "اشتباه",
          xrayLevelTwoResult: "اشتباه",
        }),
      ],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });

    // A4-portrait print sizing + theme tokens present
    expect(html).toContain("size:A4 portrait");
    expect(html).toContain("--navy:#062846");
    expect(html).toContain("--gold:#f4b400");
    // Cover page
    expect(html).toContain("التقرير التنفيذي لضمان جودة الأشعة");
    // Level definitions (glossary page)
    expect(html).toContain("المستوى الأول");
    expect(html).toContain("المستوى الثاني");
    expect(html).toContain("المستوى الثالث");
    expect(html).toContain("المستوى الرابع");
    // Part 2 — inspection-quality accuracy section
    expect(html).toContain("الدقة حسب المنفذ");
    // Uses inline SVG icons, never emoji (design spec §4.2)
    expect(html).toContain("<svg");
    expect(html).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u
    );
    // No English debug strings
    expect(html).not.toContain("Xray IDs");
    expect(html).not.toContain("Inspection Workspace");
    expect(html).not.toContain("Page 1");
  });

  it("does not crash on legacy population rows missing otherResults/notes (v28.0 back-compat)", async () => {
    // population.final.json written before the five-source pipeline has no
    // otherResults/notes; the report must default them, not throw/reject.
    const legacy = row("XR-LEGACY");
    delete (legacy as Partial<PreparedPopulationRow>).otherResults;
    delete (legacy as Partial<PreparedPopulationRow>).notes;
    const html = await buildExecutiveReport({
      monthFolderName: "6-June-2026",
      populationRows: [legacy],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });
    expect(html.length).toBeGreaterThan(0);
  });
});

// ─── Golden snapshot (P3-7) ────────────────────────────────────────────────────
// Byte-identical proof that adding `await yieldToMain()` breaks inside the
// document orchestrator (`executive/document/index.ts`'s `buildDocumentSlides`,
// including its `buildPerPortPages` per-port pagination loop) and the
// `buildExecutiveReport` entry point (main-thread chunking, P3-7) changed ONLY
// timing, never output. If this snapshot ever needs updating for a real content
// change, that change must be deliberate and reviewed on its own — never used
// to paper over an unintended regression introduced by a chunking edit.
describe("executive report html — golden snapshot (P3-7 chunking safety)", () => {
  // formatIssueDate() defaults to `new Date()` (today's real date), so this
  // byte-identity pin is only reproducible if the clock is frozen to the
  // instant the snapshot was actually captured — otherwise it silently
  // breaks on every day rollover. Frozen at UTC noon so local-timezone date
  // rollover doesn't shift the captured calendar day either.
  beforeEach(() => {
    // toFake: ["Date"] only — these builders themselves `await yieldToMain()`
    // (a real `setTimeout`) as part of P3-7's chunking; faking `setTimeout`
    // too would hang those awaits forever without an explicit timer advance.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("output is byte-identical", async () => {
    const html = await buildExecutiveReport({
      monthFolderName: "6-June-2026",
      populationRows: [
        row("XR-1", { portType: "منفذ بري", portName: "جديدة عرعر" }),
        row("XR-2", {
          portType: "منفذ بحري",
          portName: "ميناء جدة الإسلامي",
          xrayLevelOneResult: "اشتباه",
          xrayLevelTwoResult: "اشتباه",
        }),
      ],
      sample: null,
      distribution: null,
      employeeFiles: [],
      template: null,
      config: DEFAULT_EXEC_CONFIG,
    });
    expect(html).toMatchSnapshot();
  });
});
