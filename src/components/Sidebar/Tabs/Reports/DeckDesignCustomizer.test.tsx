/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real module inlines two .woff2 files via Vite's `?inline` query
// (see src/branding/fonts.ts); that asset transform hits a pre-existing
// Vite `fs.deny` failure specific to this git-worktree checkout (also seen
// on Reports/index.test.tsx, confirmed to pass fine on the main checkout).
// Stubbed here since this test only cares about the deck-wide style-choice
// wiring, not the actual embedded font payload.
vi.mock("../../../../branding/fonts", () => ({
  ARABIC_FONT_FAMILY: "IBM Plex Sans Arabic",
  ARABIC_FONT_FACE_CSS: "",
}));

import { DEFAULT_EXEC_CONFIG } from "../../../../data/reporting/executiveReportTypes";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
import type { PreparedPopulationRow } from "../../../../data/population/populationTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import { loadDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import DeckDesignCustomizer from "./DeckDesignCustomizer";

afterEach(cleanup);

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
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

function buildInput(): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows: [popRow()],
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

async function renderCustomizer() {
  const directoryHandle = createMemoryDirectory();
  const execInput = buildInput();
  render(
    <DeckDesignCustomizer
      execInput={execInput}
      employeeDisplayNames={{}}
      directoryHandle={directoryHandle}
      canMutate={() => true}
      onClose={() => {}}
    />,
  );
  // Wait for the async loadDeckStyleChoices()-driven `ready` state, which
  // gates both the save button and the deck-wide segment buttons.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "الافتراضي (1/4)" })).not.toBeDisabled();
  });
  return directoryHandle;
}

describe("DeckDesignCustomizer — deck-wide 'apply to every page' control", () => {
  it("renders the 4 deck-wide system buttons", async () => {
    await renderCustomizer();
    expect(screen.getByText("تطبيق على كل الصفحات:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "الافتراضي (1/4)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "السجل (2/4)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "الإحاطة (3/4)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "الشبكة (4/4)" })).toBeTruthy();
  });

  it("clicking a deck-wide button sets the '*' key in the saved payload", async () => {
    const directoryHandle = await renderCustomizer();

    fireEvent.click(screen.getByRole("button", { name: "الإحاطة (3/4)" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(async () => {
      const saved = await loadDeckStyleChoices(directoryHandle);
      expect(saved?.choices).toEqual({ "*": 2 });
    });
  });

  it("marks the matching segment as pressed after a deck-wide choice", async () => {
    await renderCustomizer();
    const ledgerButton = screen.getByRole("button", { name: "السجل (2/4)" });

    fireEvent.click(ledgerButton);

    expect(ledgerButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "الافتراضي (1/4)" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears any per-page overrides accumulated via the iframe bridge when a deck-wide choice is applied", async () => {
    const directoryHandle = await renderCustomizer();

    // Simulate the per-page arrow switcher inside the preview iframe posting
    // a page-specific choice back to this component (the real bridge is
    // DECK_VARIANT_SCRIPT's persist() in deck2/index.ts; postMessage is the
    // only channel it uses, so dispatching the same message shape here is a
    // faithful simulation without needing the iframe's script to execute).
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "deck2-style-choice", slideId: "slide-risk-stages", variantIndex: 1 },
        }),
      );
    });

    // Now apply a deck-wide choice — per this feature's chosen behavior, this
    // must WIPE the per-page override above, not merely add "*" alongside it,
    // so the deck genuinely becomes one consistent system rather than one
    // with a stale per-page exception waiting to resurface.
    fireEvent.click(screen.getByRole("button", { name: "الشبكة (4/4)" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(async () => {
      const saved = await loadDeckStyleChoices(directoryHandle);
      expect(saved?.choices).toEqual({ "*": 3 });
    });
  });
});
