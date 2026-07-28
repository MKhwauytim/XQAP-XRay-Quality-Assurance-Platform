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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // TabGuard (wraps the "kpi" sub-tab's dashboard) calls canAccessTab — none of the
    // pre-existing tests ever navigate to that sub-tab, but the admin-customizer-gate
    // tests below do, so this must exist and stay permissive (that gate isn't what
    // those tests are checking).
    canAccessTab: () => true,
  }),
}));

// D1 — admin-only "تخصيص تصميم العرض" gate (index.tsx: `isAdmin = readSession()?.role
// === "admin"`). Mutable so individual tests can flip the mocked session's role;
// defaults to a non-admin/no-session state to match real readSession() behavior in a
// jsdom test with no sessionStorage populated (i.e. the pre-existing tests' implicit
// assumption that this button is absent unless a test opts into "admin").
const authSessionMock = vi.hoisted(() => ({ state: { role: null as string | null } }));

vi.mock("../../../../auth/authSession", () => ({
  readSession: () => (authSessionMock.state.role ? { role: authSessionMock.state.role } : null),
}));

// D1 — the executive-deck export flow now loads saved admin style choices before
// calling openExecutiveDeckV2 (both call sites in index.tsx: handleExport("deck") and
// generate("executive-deck")). Mocked so no test touches the real templates-root disk
// path, and so the choices object identity can be asserted on directly.
const deckStyleChoicesMock = vi.hoisted(() => ({
  impl: vi.fn(async (_directoryHandle: unknown) => ({
    choices: { "exec-cover": 2 },
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    revision: 1,
  })),
}));

vi.mock("../../../../data/reporting/executive/deck2/styleChoices", () => ({
  loadDeckStyleChoices: (dir: unknown) => deckStyleChoicesMock.impl(dir),
}));

const deckExportMock = vi.hoisted(() => ({
  impl: vi.fn((_execInput: unknown, _names: unknown, _styleChoices: unknown) => undefined),
}));

vi.mock("../../../../data/reporting/executive/deck2", () => ({
  openExecutiveDeckV2: (execInput: unknown, names: unknown, styleChoices: unknown) =>
    deckExportMock.impl(execInput, names, styleChoices),
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
  authSessionMock.state.role = null;
  deckStyleChoicesMock.impl.mockClear();
  deckExportMock.impl.mockClear();
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

// D1 — admin-only design-customizer button (index.tsx: `isAdmin = readSession()?.role
// === "admin"`, gating a `{isAdmin ? (<button>...تخصيص تصميم العرض</button>) : null}`
// in the KPI dashboard toolbar). A prior review found this task's plan added ZERO
// tests for either the render gate or the export flow below, on the false claim that
// no test file existed to extend — these two describe blocks close that gap.
//
// The button ALSO exists on the default "reports" section's featured executive
// card (added 2026-07-25 after the owner reported the KPI-toolbar-only button
// was undiscoverable — most users land on "reports", not "kpi", and never saw
// it). This describe block tests the original KPI-toolbar location, which only
// renders once the analytics model has been built from a real (non-null)
// population — so each test here must switch to that sub-tab and resolve the
// mocked population load before the toolbar (and therefore the button)
// appears at all. See the separate describe block below for the reports-card
// location, which needs no sub-tab navigation.
describe("Reports KPI dashboard — admin-only design-customizer gate (D1)", () => {
  it("renders the design-customizer button when the session role is admin", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "admin";

    render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));

    // A genuinely discriminating check: if `isAdmin` were hardcoded `true` this would
    // still pass, but the paired "non-admin" test below would then fail to observe
    // the button's absence — the two tests together are what pin the real gate.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /تخصيص تصميم العرض/ })).toBeInTheDocument();
    });
  });

  it("does NOT render the design-customizer button for a non-admin role (supervisor)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "supervisor";

    render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));

    // Confirm the dashboard itself actually mounted (a control that is NOT
    // admin-gated) before trusting the customizer button's absence — otherwise an
    // absent button could just mean the dashboard never rendered at all.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /فتح العرض التنفيذي/ })).toBeInTheDocument();
    });

    // Hard gate, not a `disabled` attribute — the button must not be in the DOM at all.
    expect(screen.queryByRole("button", { name: /تخصيص تصميم العرض/ })).not.toBeInTheDocument();
  });

  it("does NOT render the design-customizer button for a non-admin role (manager)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "manager";

    render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /فتح العرض التنفيذي/ })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /تخصيص تصميم العرض/ })).not.toBeInTheDocument();
  });

  // Whole-branch review finding: handleOpenCustomizer had no handler-time canMutate
  // re-check (unlike handleExport/handlePbiExport/generate's documented defense-in-depth
  // pattern), so a control incorrectly left enabled could still open the customizer.
  it("blocks opening the design customizer at the handler when canMutate is false, even though can=true leaves the button enabled", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "admin";
    permissionsMock.state = { can: true, canMutate: false };

    render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("tab", { name: "مؤشرات" }));

    const customizerButton = await screen.findByRole("button", { name: /تخصيص تصميم العرض/ });
    // can=true keeps the render-time gate open (the control is usable-looking)...
    expect(customizerButton).not.toBeDisabled();

    // ...but the handler's own canMutate() re-check must still reject the action.
    fireEvent.click(customizerButton);

    await waitFor(() => {
      expect(screen.getByText("لا تملك صلاحية تصدير التقارير.")).toBeInTheDocument();
    });

    // The customizer dialog must never have opened.
    expect(screen.queryByRole("dialog", { name: "تخصيص تصميم العرض التنفيذي" })).not.toBeInTheDocument();
  });
});

// 2026-07-25: the owner reported not seeing the design-customizer button at all —
// it only existed on the "kpi" sub-tab's dashboard toolbar (tested above), but most
// users land on the default "reports" section and never navigate there. A second
// button, same handler, was added to the featured executive card's footer on that
// default section, needing no sub-tab navigation.
describe("Reports card — admin-only design-customizer button on the default 'reports' section (discoverability fix)", () => {
  it("renders the design-customizer button on the featured executive card without navigating away from the default 'reports' section", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "admin";

    const { container } = render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    // No tab click — this is the default render, exactly what the owner saw.
    const featuredCard = container.querySelector(".rh-card-featured") as HTMLElement;
    expect(within(featuredCard).getByRole("button", { name: /تخصيص التصميم/ })).toBeInTheDocument();
  });

  it("does NOT render the reports-card design-customizer button for a non-admin role", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "supervisor";

    const { container } = render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    const featuredCard = container.querySelector(".rh-card-featured") as HTMLElement;
    // Confirm the card itself rendered (a non-gated control) before trusting the
    // customizer button's absence.
    expect(within(featuredCard).getByRole("button", { name: "التصدير" })).toBeInTheDocument();
    expect(within(featuredCard).queryByRole("button", { name: /تخصيص التصميم/ })).not.toBeInTheDocument();
  });

  it("clicking the reports-card button opens the same customizer dialog as the KPI-toolbar button", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    authSessionMock.state.role = "admin";

    const { container } = render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    const featuredCard = container.querySelector(".rh-card-featured") as HTMLElement;
    fireEvent.click(within(featuredCard).getByRole("button", { name: /تخصيص التصميم/ }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "تخصيص تصميم العرض التنفيذي" })).toBeInTheDocument();
    });
  });
});

// D1 — executive-deck export must load the admin's saved style choices BEFORE
// opening the deck, and forward them through as openExecutiveDeckV2's third
// argument (index.tsx generate(): `const saved = directoryHandle ? await
// loadDeckStyleChoices(directoryHandle) : null; openExecutiveDeckV2(execInput, names,
// saved?.choices);`). Exercised via the executive card's "reports"-section export
// control (format switched to "deck") rather than the KPI dashboard toolbar's twin
// call site — same code path, far less setup (no model-building required).
describe("Reports executive-deck export — style choices loaded before export (D1)", () => {
  it("calls loadDeckStyleChoices before openExecutiveDeckV2 and forwards the loaded choices as the third argument", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { container } = render(<ReportsTab />);

    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    // Executive is the featured card; switch its format toggle to "deck" (defaults
    // to "document"), then trigger its "التصدير" button — this is generate("executive-deck").
    const featuredCard = container.querySelector(".rh-card-featured") as HTMLElement;
    fireEvent.click(within(featuredCard).getByTitle("عرض تقديمي تفاعلي (HTML)"));
    fireEvent.click(within(featuredCard).getByRole("button", { name: "التصدير" }));

    await waitFor(() => {
      expect(deckExportMock.impl).toHaveBeenCalledTimes(1);
    });

    // 1) loadDeckStyleChoices was actually invoked — reverting the `await
    //    loadDeckStyleChoices(...)` call in index.tsx would leave this at 0.
    expect(deckStyleChoicesMock.impl).toHaveBeenCalledTimes(1);

    // 2) it ran BEFORE openExecutiveDeckV2 (index.tsx awaits it first).
    const loadOrder = deckStyleChoicesMock.impl.mock.invocationCallOrder[0];
    const exportOrder = deckExportMock.impl.mock.invocationCallOrder[0];
    expect(loadOrder).toBeLessThan(exportOrder);

    // 3) the loaded choices (not undefined, not some other object) were forwarded as
    //    the third argument — reverting to `openExecutiveDeckV2(execInput, names)`
    //    (no third arg) would make this `undefined` instead.
    const [, , forwardedChoices] = deckExportMock.impl.mock.calls[0];
    expect(forwardedChoices).toEqual({ "exec-cover": 2 });
  });
});
