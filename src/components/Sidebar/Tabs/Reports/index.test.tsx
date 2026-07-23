/* @vitest-environment jsdom */
// I-1 — Reports "month-summary chips" staleness guard.
//
// The monthMeta-loading effect (index.tsx, "Load lightweight meta for the month bar chips")
// had no cancellation guard: if a slow load for a PREVIOUSLY selected month resolved after a
// FASTER load for a NEWER selection, the stale result would silently overwrite the fresher
// chip data. This test forces that exact ordering deterministically (rather than relying on
// jsdom's incidental scheduling) by mocking `loadMonthPopulationFinal` to return a
// per-month-controlled deferred promise, then resolving the newer month's promise BEFORE the
// older month's — the precise inversion the `cancelled` flag guard exists to defend against.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { PopulationFinalData } from "../../../../data/population/monthTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";

// Mutable module-level state so the test can flip the app-wide month selection mid-flight
// (mirrors the pattern already used in ReferralApproval/useApprovalData.test.tsx).
const globalMonthMock = vi.hoisted(() => {
  type MockSelection =
    | { kind: "existing"; month: number; year: number; folderName: string }
    | { kind: "pending"; month: number; year: number; folderName: string };
  const APRIL: MockSelection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  return { state: { selection: APRIL as MockSelection } };
});

// B5 — export-permission gating. `can` drives render-time disable/hide; `canMutate`
// is the stricter, handler-level gate re-checked at the top of handleExport /
// handlePbiExport / generate (see index.tsx's exportDisabledTitle + the three
// handlers). Both default to "fully permitted" so the pre-existing I-1 test below
// (which never touches this mock) keeps exercising a fully-enabled UI, matching its
// original, gate-free assumptions.
const permissionsMock = vi.hoisted(() => ({
  state: { can: true, canMutate: true },
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) => (featureId === "export-reports" ? permissionsMock.state.can : true),
    canMutate: (featureId: string) => (featureId === "export-reports" ? permissionsMock.state.canMutate : true),
  }),
}));

// Stubs the real (disk-writing) Power BI export so the gating tests below never touch
// the filesystem; also doubles as the source manifest for the digit-format test.
const pbiExportMock = vi.hoisted(() => ({
  impl: vi.fn(async () => ({
    month: "4-april-2026",
    exportedAt: new Date().toISOString(),
    files: [{ fileName: "population.csv", rowCount: 42 }],
  })),
}));

vi.mock("../../../../data/powerbiExport/exportManager", () => ({
  // No test here asserts on the forwarded arguments (only call count/absence),
  // so the mock takes none -- avoids TS2556 (tsc -b's stricter check on
  // spreading a non-tuple `unknown[]` into a zero-arg vi.fn() mock's inferred
  // call signature) without changing any test's observable behavior.
  runPowerBiExport: () => pbiExportMock.impl(),
}));

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [
      { month: 4, year: 2026, folderName: "4-april-2026" },
      { month: 5, year: 2026, folderName: "5-may-2026" },
    ],
    selection: globalMonthMock.state.selection,
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: (globalThis as { __testDir?: DirectoryHandleLike }).__testDir ?? null }),
}));

// Per-month controlled ("deferred") population loads — lets the test resolve the OLDER
// month's promise strictly AFTER the newer one, forcing the exact race order under test.
const deferreds = vi.hoisted(
  () =>
    new Map<
      string,
      { promise: Promise<PopulationFinalData | null>; resolve: (v: PopulationFinalData | null) => void }
    >()
);

function deferredFor(month: string) {
  let entry = deferreds.get(month);
  if (!entry) {
    let resolve!: (v: PopulationFinalData | null) => void;
    const promise = new Promise<PopulationFinalData | null>((res) => {
      resolve = res;
    });
    entry = { promise, resolve };
    deferreds.set(month, entry);
  }
  return entry;
}

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthPopulationFinal: vi.fn((_dir: unknown, month: string) => deferredFor(month).promise),
  };
});

import ReportsTab from "./index";

afterEach(() => {
  cleanup();
  deferreds.clear();
  globalMonthMock.state.selection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  permissionsMock.state = { can: true, canMutate: true };
  pbiExportMock.impl.mockClear();
  delete (globalThis as { __testDir?: DirectoryHandleLike }).__testDir;
});

function mockPop(rowCount: number): PopulationFinalData {
  return {
    sourceMonthFolder: "x",
    processedAt: new Date().toISOString(),
    processedBy: "tester",
    totalRows: rowCount,
    certScanRows: 0,
    nonCertScanRows: rowCount,
    rows: Array.from({ length: rowCount }, (_, i) => ({ xrayImageId: `img-${i}` })),
  };
}

describe("Reports month-summary chips — staleness guard (I-1)", () => {
  it("keeps the newer month's chip data even when the OLDER month's load resolves LATER", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { rerender } = render(<ReportsTab />);
    // Mount starts a load for April; it is now suspended on deferredFor("4-april-2026").

    // Flip the global-month selection to May and rerender — this runs the cleanup for
    // April's effect (cancelled = true in the fix) and starts a fresh load for May.
    globalMonthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" };
    rerender(<ReportsTab />);

    // Resolve MAY (the current selection) FIRST.
    await act(async () => {
      deferredFor("5-may-2026").resolve(mockPop(20));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("20 صورة")).toBeInTheDocument();
    });

    // Now resolve APRIL (the stale, superseded selection) AFTER May has already settled.
    // Without the cancelled-flag guard, this late completion would clobber the chip with
    // April's stale data.
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(5));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The chip must still reflect May's data — April's late resolution must be a no-op.
    expect(screen.getByText("20 صورة")).toBeInTheDocument();
    expect(screen.queryByText("5 صورة")).not.toBeInTheDocument();
  });
});

// B5 — export permission bypass fix. Previously handleExport / handlePbiExport /
// generate had ZERO permission check: any authenticated user who could reach this
// tab (including the real 5-system/powerbi-export disk write) could export. These
// tests cover both the render-time gate (`can`, disables/explains) and the
// handler-time gate (`canMutate`, re-checked defensively even if a control were
// somehow left enabled), plus the digit-format and pending-month polish items.
describe("Reports export permission gating (B5)", () => {
  it("disables every export/generate control and explains why when the role cannot export (can=false)", () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: false, canMutate: false };

    const { container } = render(<ReportsTab />);

    // Power BI card's button — the one with the real disk write.
    const pbiButton = screen.getByRole("button", { name: "تصدير" });
    expect(pbiButton).toBeDisabled();
    expect(pbiButton).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");

    // Quick-actions row (shared `generate()` handler).
    const quickButtons = container.querySelectorAll(".rh-quick-btn");
    expect(quickButtons.length).toBe(3);
    quickButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");
    });

    // Per-card "التصدير" button (renderExportControls — shared by all 4 report cards).
    const mainExportButton = container.querySelector(".rh-export-controls .rh-btn");
    expect(mainExportButton).toBeDisabled();
    expect(mainExportButton).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");
  });

  it("still blocks the Power BI disk export at the handler even when the control is left enabled (can=true, canMutate=false)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: false };

    render(<ReportsTab />);

    const pbiButton = screen.getByRole("button", { name: "تصدير" });
    // can=true keeps the render-time gate open (the control is usable-looking)...
    expect(pbiButton).not.toBeDisabled();

    // ...but the handler's own canMutate() re-check must still reject the action —
    // the defense-in-depth half of the fix, distinct from the render-time gate above.
    fireEvent.click(pbiButton);

    await waitFor(() => {
      expect(screen.getByText("لا تملك صلاحية تصدير التقارير.")).toBeInTheDocument();
    });
    expect(pbiExportMock.impl).not.toHaveBeenCalled();
  });

  it("performs the Power BI export and renders Latin digits (not Arabic-Indic) in the result row count when permitted", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: true };

    render(<ReportsTab />);

    fireEvent.click(screen.getByRole("button", { name: "تصدير" }));

    await waitFor(() => {
      expect(pbiExportMock.impl).toHaveBeenCalledTimes(1);
    });

    // Row count is 42 (mocked) — must render as Latin "42", never Arabic-Indic "٤٢"
    // (fmtCount's own standard elsewhere in this file — audit C-10 / B5 follow-up).
    await waitFor(() => {
      expect(screen.getByText(/population\.csv/)).toBeInTheDocument();
    });
    const fileListItem = screen.getByText(/population\.csv/).closest("li");
    expect(fileListItem?.textContent).toContain("42");
    expect(fileListItem?.textContent ?? "").not.toMatch(/[٠-٩]/); // Arabic-Indic digit range
  });

  it("explains a disabled pending-month control as 'not processed yet' rather than the generic no-month message", () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: true };
    globalMonthMock.state.selection = { kind: "pending", month: 6, year: 2026, folderName: "6-june-2026" };

    const { container } = render(<ReportsTab />);

    const pbiButton = screen.getByRole("button", { name: "تصدير" });
    expect(pbiButton).toBeDisabled();
    expect(pbiButton).toHaveAttribute(
      "title",
      "لم تتم معالجة مجتمع هذا الشهر بعد — لا توجد بيانات جاهزة للتصدير."
    );

    // The dedicated inline note near the month bar (extends the "لا توجد أشهر" treatment;
    // regex targets the note's unique tail so it can't match the shorter PBI-card hint,
    // which shares the same opening clause).
    expect(screen.getByText(/عناصر التقارير والتصدير تبقى معطّلة/)).toBeInTheDocument();

    // Confirms this is NOT the generic "no months at all" empty state.
    expect(container.querySelector(".rh-month-current")?.textContent).not.toBe("لا توجد أشهر");
  });
});
