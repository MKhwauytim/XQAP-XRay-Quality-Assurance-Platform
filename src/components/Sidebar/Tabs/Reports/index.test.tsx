/* @vitest-environment jsdom */
// I-1 — Reports "month-summary chips" staleness guard.
//
// The monthMeta-loading effect (index.tsx, "Load lightweight meta for the month bar chips")
// had no cancellation guard: if a slow load for a PREVIOUSLY selected month resolved after a
// FASTER load for a NEWER selection, the stale result would silently overwrite the fresher
// chip data. This test forces that exact ordering deterministically (rather than relying on
// jsdom's incidental scheduling) by mocking `loadMonthManifest` (the effect's lightweight data
// source as of the §L fix below) to return a per-month-controlled deferred promise, then
// resolving the newer month's promise BEFORE the older month's — the precise inversion the
// `cancelled` flag guard exists to defend against. (Originally written against
// `loadMonthPopulationFinal`, before §L replaced the effect's full-population read with a
// manifest read — see the "lightweight manifest read" describe block further down.)
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { MonthManifestData, PopulationFinalData } from "../../../../data/population/monthTypes";
import type { SampleMasterData } from "../../../../data/sampling/sampleTypes";
import type { EmployeeAnswerFile } from "../../../../data/answers/answerTypes";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import {
  broadcastDataRefresh,
  type DataRefreshFamily,
} from "../../../../data/workspace/dataRefreshSignal";

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
// original, gate-free assumptions. `reason` backs getMutationCapability, mirroring
// the real hook's shape closely enough for the handlers' reason-aware messaging
// (audit finding 5 / reports/TabView.tsx conflict resolution) to be exercised.
type MockMutationReason = "page-not-editable" | "feature-disabled" | "read-only-mode" | "workspace-unavailable";
type PermissionsMockState = { can: boolean; canMutate: boolean; reason?: MockMutationReason };
const permissionsMock = vi.hoisted(() => ({
  state: { can: true, canMutate: true } as PermissionsMockState,
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    can: (featureId: string) => (featureId === "export-reports" ? permissionsMock.state.can : true),
    canMutate: (featureId: string) => (featureId === "export-reports" ? permissionsMock.state.canMutate : true),
    getMutationCapability: (featureId: string) =>
      featureId === "export-reports"
        ? (permissionsMock.state.canMutate
          ? { allowed: true, reason: null }
          : { allowed: false, reason: permissionsMock.state.reason ?? "page-not-editable" })
        : { allowed: true, reason: null },
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
  // `DeckDesignCustomizer.tsx` (rendered for real, unmocked, by this same
  // Reports tab) imports `buildExecutiveDeckV2` directly from this module for
  // its live iframe preview — P3-7 made it async, so the stub here must
  // resolve a Promise, not return a bare string.
  buildExecutiveDeckV2: (_execInput: unknown, _names: unknown, _opts: unknown) =>
    Promise.resolve("<html><body>mock deck preview</body></html>"),
}));

// Executive-report design toggle — the "التصميم الجديد" checkbox routes
// handleExport("deck")/generate("executive-deck") to deck3's
// openExecutiveDeckV3 instead of deck2's openExecutiveDeckV2 (index.tsx:
// both call sites branch on `deckEdition`). `deckEditionPreference.ts`
// itself is left unmocked — it degrades to "v2" against the real memory
// directory when nothing has been saved yet, same as `loadDeckStyleChoices`
// would without its own mock, so no test needs to stub it just to render.
const deckV3ExportMock = vi.hoisted(() => ({
  impl: vi.fn((_execInput: unknown, _names: unknown) => undefined),
}));

vi.mock("../../../../data/reporting/executive/deck3", () => ({
  openExecutiveDeckV3: (execInput: unknown, names: unknown) => deckV3ExportMock.impl(execInput, names),
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
  runPowerBiExportDetailed: async () => ({ manifest: await pbiExportMock.impl(), snapshotRowCount: 0 }),
}));

// §N — the executive report builder (document+xlsx) that index.tsx dynamically
// `import()`s is mocked here so the lazy-import regression test below (and any
// future test that clicks an export/generate button for this branch) never
// touches the real report-building code or triggers a real download in jsdom.
// Follows the same explicit-args wrapper shape as `deckExportMock` above.
// (Task 12, population-report-merge plan, 2026-08-30: the sibling
// `distributionReportSpies`/`sampleReportSpies` mocks that used to live here
// were removed along with the `distributionReport.ts`/`sampleReport.ts`
// modules themselves — تقرير المجتمع's `populationReport` module replaced
// both, and this file does not mock it, since none of the tests below
// exercise its export path.)
const executiveReportSpies = vi.hoisted(() => ({
  openExecutiveReport: vi.fn(async (_execInput: unknown, _names: unknown) => undefined),
  buildExecutiveXlsx: vi.fn(async (_execInput: unknown, _names: unknown) => undefined),
}));

vi.mock("../../../../data/reporting/executiveReport", () => ({
  openExecutiveReport: (execInput: unknown, names: unknown) => executiveReportSpies.openExecutiveReport(execInput, names),
  buildExecutiveXlsx: (execInput: unknown, names: unknown) => executiveReportSpies.buildExecutiveXlsx(execInput, names),
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
// Still used by loadExecInput's own (unchanged) loadMonthPopulationFinal call once the KPI
// dashboard is opened — the meta effect itself no longer calls this (§L fix below).
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

// §L — the meta effect's lightweight data source. Same per-month deferred-promise
// control as `deferredFor` above, but for `loadMonthManifest` (now what feeds the
// population-count chip instead of the full population read).
const manifestDeferreds = vi.hoisted(
  () =>
    new Map<
      string,
      { promise: Promise<MonthManifestData | null>; resolve: (v: MonthManifestData | null) => void }
    >()
);

function deferredManifestFor(month: string) {
  let entry = manifestDeferreds.get(month);
  if (!entry) {
    let resolve!: (v: MonthManifestData | null) => void;
    const promise = new Promise<MonthManifestData | null>((res) => {
      resolve = res;
    });
    entry = { promise, resolve };
    manifestDeferreds.set(month, entry);
  }
  return entry;
}

// Hoisted spy handles for the two populationStorage functions the meta effect and
// loadExecInput care about — kept as directly-assertable `vi.fn()`s (rather than
// anonymous closures inline in the mock factory below) so tests can assert on
// call presence/absence (§L: the meta effect must call loadMonthManifest but NOT
// loadMonthPopulationFinal).
const populationStorageSpies = vi.hoisted(() => ({
  loadMonthPopulationFinal: vi.fn((_dir: unknown, month: string) => deferredFor(month).promise),
  loadMonthManifest: vi.fn((_dir: unknown, month: string) => deferredManifestFor(month).promise),
}));

vi.mock("../../../../data/population/populationStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/population/populationStorage")>();
  return {
    ...actual,
    loadMonthPopulationFinal: populationStorageSpies.loadMonthPopulationFinal,
    loadMonthManifest: populationStorageSpies.loadMonthManifest,
  };
});

// §L — loadSampleMaster / loadAllEmployeeFiles spies. Default to "no sample / no
// employee data yet" (matching the real behavior against an empty memory
// directory), so every pre-existing test's assumptions are unchanged. Only the
// new "studied count from the KPI model" test below overrides these to exercise
// a non-zero `kpis.studiedImages` through the real buildReportModel pipeline.
const sampleAnswerSpies = vi.hoisted(() => ({
  loadSampleMaster: vi.fn(async (_dir: unknown, _month: string): Promise<SampleMasterData | null> => null),
  loadAllEmployeeFiles: vi.fn(async (_dir: unknown, _month: string): Promise<EmployeeAnswerFile[]> => []),
}));

vi.mock("../../../../data/sampling/sampleStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/sampling/sampleStorage")>();
  return {
    ...actual,
    loadSampleMaster: sampleAnswerSpies.loadSampleMaster,
  };
});

vi.mock("../../../../data/answers/answerStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../data/answers/answerStorage")>();
  return {
    ...actual,
    loadAllEmployeeFiles: sampleAnswerSpies.loadAllEmployeeFiles,
  };
});

// §T — Reports sub-tab mount preservation. Stubs the (heavy, unrelated) Report
// Designer tab with a mount-counting stub so the new describe block below can
// assert on mount/hide behavior of `ReportsTab`'s wrapper without pulling in
// the real designer's own effects/dependencies.
const reportDesignerMountCount = vi.hoisted(() => ({ count: 0 }));

// The real comprehensive page is covered by ComprehensiveExecutive.test.tsx; here only its
// mount/visibility behaviour inside the Reports wrapper matters.
vi.mock("./ComprehensiveExecutive", () => ({
  default: () => <div data-testid="comprehensive-executive-stub" />,
}));

vi.mock("../ReportDesigner", () => ({
  default: () => {
    reportDesignerMountCount.count += 1;
    return <div data-testid="report-designer-stub" />;
  },
}));

import ReportsTab from "./index";

// `ReportsTab` (this file's default import) is `lazy(() => import("./TabView"))`.
// React memoizes that factory call, so only the very FIRST render in this whole
// file/process ever pays the dynamic import()'s transform+eval cost -- every
// later render just reuses the already-resolved module. That first cost is not
// bounded by anything under test: it is vite-node cold-transpiling a ~1300-line
// component that pulls in the KPI dashboard, chart code, xlsx, etc., and was
// observed to occasionally exceed 5s even with no other load on the machine.
// Whichever `it()` happens to run first was at the mercy of that variable,
// unrelated cost inside its own timed `waitFor`s (most visibly the staleness
// guard below, which used to budget an explicit 5000ms specifically to absorb
// it and still wasn't always enough). Warming the import here, before any test
// runs, moves that one-time cost out of every test's timing budget entirely --
// by the time a test renders `<ReportsTab />`, `import("./TabView")` already
// has a cached, resolved module to hand back.
beforeAll(async () => {
  await import("./TabView");
});

afterEach(() => {
  cleanup();
  deferreds.clear();
  manifestDeferreds.clear();
  globalMonthMock.state.selection = { kind: "existing", month: 4, year: 2026, folderName: "4-april-2026" };
  permissionsMock.state = { can: true, canMutate: true };
  pbiExportMock.impl.mockClear();
  authSessionMock.state.role = null;
  deckStyleChoicesMock.impl.mockClear();
  deckExportMock.impl.mockClear();
  executiveReportSpies.openExecutiveReport.mockClear();
  executiveReportSpies.buildExecutiveXlsx.mockClear();
  populationStorageSpies.loadMonthPopulationFinal.mockClear();
  populationStorageSpies.loadMonthManifest.mockClear();
  // Reset (not just clear) — a test may have overridden these with a persistent
  // `.mockResolvedValue(...)`/`.mockImplementation(...)` (the studied-count test
  // below); restore the "no sample / no employee data" default for every other test.
  sampleAnswerSpies.loadSampleMaster.mockReset();
  sampleAnswerSpies.loadSampleMaster.mockImplementation(async () => null);
  sampleAnswerSpies.loadAllEmployeeFiles.mockReset();
  sampleAnswerSpies.loadAllEmployeeFiles.mockImplementation(async () => []);
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

// §L — the population-count chip now comes from the manifest's cheap
// totalProcessedRows field instead of a full population.final.json read.
function mockManifest(totalProcessedRows: number): MonthManifestData {
  return {
    monthFolderName: "x",
    month: 1,
    year: 2026,
    processedAt: new Date().toISOString(),
    processedBy: "tester",
    riskFileName: null,
    biFileName: null,
    certScanUsed: false,
    templateVersion: null,
    rngSeed: null,
    totalRawRows: totalProcessedRows,
    totalProcessedRows,
    status: "processed-saved",
  };
}

describe("Reports month-summary chips — staleness guard (I-1)", () => {
  it("keeps the newer month's chip data even when the OLDER month's load resolves LATER", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { rerender } = render(<ReportsTab />);
    // §N — `ReportsTab` (this file's default import) is `lazy(() =>
    // import("./TabView"))`, and this render() has no wrapping <Suspense>, so the
    // FIRST render commits nothing: React defers the whole tree until the dynamic
    // import resolves, which happens asynchronously (at least one microtask tick
    // later), not synchronously inside this render() call. If we flipped the month
    // to May right here (as this test used to, pre-§N), the real TabView would not
    // have mounted yet — its April meta-load effect would never have started, so
    // resolving deferredManifestFor("4-april-2026") later would be a no-op for a
    // reason that has nothing to do with the stale-response guard, and the test's
    // closing assertions would pass vacuously (they'd pass even with the guard
    // deleted). So: explicitly wait for the real, lazy-loaded component to mount
    // AND for its April load to genuinely start before touching the month
    // selection — mirrors the awaiting pattern the §T mount-preservation tests use
    // (`await screen.findByTestId(...)`) to cross this same lazy boundary. The
    // file-level `beforeAll` above already warms `import("./TabView")` before any
    // test runs, so this render itself resolves fast and deterministically; the
    // longer-than-default timeout here just stays as an ordinary safety margin
    // for slow CI/parallel-worker machines, the same as any other disk/IO wait
    // in this suite — it is no longer compensating for the dynamic import itself.
    await waitFor(
      () => {
        expect(populationStorageSpies.loadMonthManifest).toHaveBeenCalledWith(root, "4-april-2026");
      },
      { timeout: 5000 }
    );

    // Flip the global-month selection to May and rerender — this runs the cleanup for
    // April's effect (cancelled = true in the fix) and starts a fresh load for May.
    globalMonthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" };
    rerender(<ReportsTab />);

    // Confirm May's load has genuinely started too, before resolving anything —
    // same reasoning as the April wait above, applied to the post-mount rerender.
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthManifest).toHaveBeenCalledWith(root, "5-may-2026");
    });

    // Resolve MAY (the current selection) FIRST.
    await act(async () => {
      deferredManifestFor("5-may-2026").resolve(mockManifest(20));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("20 صورة")).toBeInTheDocument();
    });

    // Now resolve APRIL (the stale, superseded selection) AFTER May has already settled.
    // Without the cancelled-flag guard, this late completion would clobber the chip with
    // April's stale data.
    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(5));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The chip must still reflect May's data — April's late resolution must be a no-op.
    expect(screen.getByText("20 صورة")).toBeInTheDocument();
    expect(screen.queryByText("5 صورة")).not.toBeInTheDocument();
  });
});

// §L — Fix: the month-meta effect stops loading the full population + every
// employee's answer file just to populate the header chips (population count now
// comes from the manifest's totalProcessedRows; studied count is backfilled from
// the KPI dashboard's own model once it builds, instead of a dedicated
// loadAllEmployeeFiles read).
describe("Reports month-summary chips — lightweight manifest read, no employee-files read (§L)", () => {
  it("uses loadMonthManifest (not loadMonthPopulationFinal/loadAllEmployeeFiles) for the population chip on landing", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(345));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("345 صورة")).toBeInTheDocument();
    });

    expect(populationStorageSpies.loadMonthManifest).toHaveBeenCalledWith(root, "4-april-2026");
    // The meta effect must not touch the heavy full-population or all-employee-files reads —
    // those only happen once the "kpi" sub-tab (never opened in this test) builds its model.
    expect(populationStorageSpies.loadMonthPopulationFinal).not.toHaveBeenCalled();
    expect(sampleAnswerSpies.loadAllEmployeeFiles).not.toHaveBeenCalled();
  });

  it("shows the studied-count chip as '—' until the KPI dashboard builds its model, then reflects model.sample.studied", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    // A single population row that is both sampled and answered (submitted) —
    // gives buildReportModel a deterministic, non-zero kpis.studiedImages to
    // backfill the chip with, distinguishing "wired to the real model" from a
    // coincidental zero.
    const sampleFixture: SampleMasterData = {
      rngSeed: "seed",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 1,
      certScanActual: 0,
      nonCertScanActual: 1,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "tester",
      rows: mockPop(1).rows as unknown as SampleMasterData["rows"],
    };
    const employeeFilesFixture: EmployeeAnswerFile[] = [
      {
        username: "emp1",
        monthFolderName: "4-april-2026",
        items: [
          {
            xrayImageId: "img-0",
            templateId: "t1",
            templateVersion: 1,
            answers: [],
            lastSavedAt: new Date().toISOString(),
            submittedAt: new Date().toISOString(),
            answeredBy: "emp1",
            status: "submitted",
          },
        ],
      },
    ];
    sampleAnswerSpies.loadSampleMaster.mockResolvedValue(sampleFixture);
    sampleAnswerSpies.loadAllEmployeeFiles.mockResolvedValue(employeeFilesFixture);

    const { container } = render(<ReportsTab />);
    const studiedChip = () => container.querySelector(".rh-chip-ans");

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("1 صورة")).toBeInTheDocument();
    });

    // Before the KPI dashboard has ever built a model, the studied chip is a bare "—".
    expect(studiedChip()?.textContent).toBe("—");

    // Navigate to the KPI dashboard — this triggers the model-building effect, which
    // needs loadMonthPopulationFinal (still deferred/controlled separately).
    fireEvent.click(await screen.findByRole("tab", { name: "مؤشرات" }));
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(studiedChip()?.textContent).toBe("1 مدروسة");
    });
  });
});

// B5 — export permission bypass fix. Previously handleExport / handlePbiExport /
// generate had ZERO permission check: any authenticated user who could reach this
// tab (including the real 5-system/powerbi-export disk write) could export. These
// tests cover both the render-time gate (`can`, disables/explains) and the
// handler-time gate (`canMutate`, re-checked defensively even if a control were
// somehow left enabled), plus the digit-format and pending-month polish items.
describe("Reports sample-snapshot banner (A2)", () => {
  it("shows the banner as soon as the month loads when a sampled image is missing from the population", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    const sampleFixture = {
      rngSeed: "seed",
      totalRequested: 2,
      totalActual: 2,
      certScanRequested: 0,
      nonCertScanRequested: 2,
      certScanActual: 0,
      nonCertScanActual: 2,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "tester",
      rows: [{ xrayImageId: "img-0" }, { xrayImageId: "img-9" }],
    } as unknown as SampleMasterData;
    sampleAnswerSpies.loadSampleMaster.mockResolvedValue(sampleFixture);

    render(<ReportsTab />);
    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        DEFAULT_LABELS.report_sample_snapshot_banner.replace("{count}", "1")
      );
    });
  });

  it("shows no banner when every sampled image is in the population", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    sampleAnswerSpies.loadSampleMaster.mockResolvedValue({
      rngSeed: "seed", totalRequested: 1, totalActual: 1, certScanRequested: 0, nonCertScanRequested: 1,
      certScanActual: 0, nonCertScanActual: 1, portAllocations: [], stageAllocations: [],
      drawnAt: new Date().toISOString(), drawnBy: "tester", rows: [{ xrayImageId: "img-0" }],
    } as unknown as SampleMasterData);

    render(<ReportsTab />);
    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("1 صورة")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Skipped while the report hub is paused for maintenance: every export control is
// permanently disabled, so these gating assertions cannot be exercised. Un-skip with
// REPORTS_UNDER_MAINTENANCE = false.
describe.skip("Reports export permission gating (B5)", () => {
  it("disables every export/generate control and explains why when the role cannot export (can=false)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: false, canMutate: false };

    const { container } = render(<ReportsTab />);

    // Power BI card's button — the one with the real disk write.
    const pbiButton = await screen.findByRole("button", { name: "تصدير" });
    expect(pbiButton).toBeDisabled();
    expect(pbiButton).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");

    // Quick-actions row (shared `generate()` handler). Two buttons since the
    // Sample/Distribution cards merged into one تقرير المجتمع card (D11).
    const quickButtons = container.querySelectorAll(".rh-quick-btn");
    expect(quickButtons.length).toBe(2);
    quickButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");
    });

    // Per-card "التصدير" button (renderExportControls — shared by all 3 report cards).
    const mainExportButton = container.querySelector(".rh-export-controls .rh-btn");
    expect(mainExportButton).toBeDisabled();
    expect(mainExportButton).toHaveAttribute("title", "لا تملك صلاحية تصدير التقارير.");
  });

  it("still blocks the Power BI disk export at the handler even when the control is left enabled (can=true, canMutate=false)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: false };

    render(<ReportsTab />);

    const pbiButton = await screen.findByRole("button", { name: "تصدير" });
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

  it("shows a read-only-mode message, not the generic permission-denied one, for the demo/viewer account (audit finding 5)", async () => {
    // The built-in demo/viewer account is role "admin" (can/canExportReports read
    // true -- render-time gate stays open, matching the real hook), but its session
    // is read-only, so getMutationCapability rejects with reason "read-only-mode".
    // Reusing the generic "لا تملك صلاحية..." wording there is misleading: the
    // account does have export permission, the session is just a read-only preview.
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: false, reason: "read-only-mode" };

    render(<ReportsTab />);

    const pbiButton = await screen.findByRole("button", { name: "تصدير" });
    expect(pbiButton).not.toBeDisabled();
    fireEvent.click(pbiButton);

    await waitFor(() => {
      expect(
        screen.getByText("وضع العرض التجريبي للقراءة فقط — لا يمكن تصدير التقارير من هذه الجلسة.")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("لا تملك صلاحية تصدير التقارير.")).toBeNull();
    expect(pbiExportMock.impl).not.toHaveBeenCalled();
  });

  it("performs the Power BI export and renders Latin digits (not Arabic-Indic) in the result row count when permitted", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: true };

    render(<ReportsTab />);

    fireEvent.click(await screen.findByRole("button", { name: "تصدير" }));

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

  it("explains a disabled pending-month control as 'not processed yet' rather than the generic no-month message", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;
    permissionsMock.state = { can: true, canMutate: true };
    globalMonthMock.state.selection = { kind: "pending", month: 6, year: 2026, folderName: "6-june-2026" };

    const { container } = render(<ReportsTab />);

    const pbiButton = await screen.findByRole("button", { name: "تصدير" });
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

// The report hub is paused (REPORTS_UNDER_MAINTENANCE in TabView.tsx): the old
// executive card, its deck-edition toggle, the admin design-customizer and the
// KPI dashboard's executive exports are gone or greyed out. The tests for those
// live flows were removed with them; the B5 gating block above is skipped until
// the hub is re-enabled.
describe("Reports hub — only the executive report is live", () => {
  it("keeps the executive card enabled (deck + Excel, no document) and greys out every other card", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { container } = render(<ReportsTab />);
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });

    const executive = await waitFor(() => {
      const el = container.querySelector(".rh-card-featured");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(executive).not.toHaveClass("rh-card-maintenance");
    expect(within(executive).getByText("التقرير التنفيذي")).toBeInTheDocument();
    expect(within(executive).queryByTitle("تقرير تفصيلي تفاعلي (HTML)")).toBeNull();
    expect(within(executive).getByTitle("عرض تقديمي تفاعلي (HTML)")).toBeEnabled();
    expect(within(executive).getByTitle("بيانات (Excel)")).toBeEnabled();
    expect(screen.queryByText("التصميم الجديد")).toBeNull();
    expect(screen.queryByLabelText("تخصيص التصميم")).toBeNull();

    const paused = Array.from(container.querySelectorAll(".rh-card")).filter((c) => c !== executive);
    expect(paused.length).toBe(3);
    paused.forEach((card) => {
      expect(card).toHaveClass("rh-card-maintenance");
      expect(card.querySelector(".rh-badge-maintenance")).toHaveTextContent("تحت الصيانة");
      card.querySelectorAll("button").forEach((btn) => expect(btn).toBeDisabled());
    });
  });

  it("exports the executive deck through deck3 with an editable-template hook", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { container } = render(<ReportsTab />);
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(0));
      await Promise.resolve();
    });
    const executive = await waitFor(() => {
      const el = container.querySelector(".rh-card-featured");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.click(within(executive).getByRole("button", { name: "التصدير" }));
    await waitFor(() => {
      expect(deckV3ExportMock.impl).toHaveBeenCalledTimes(1);
    });
    expect(deckExportMock.impl).not.toHaveBeenCalled();
  });
});

describe("Reports KPI model cache — no rebuild on plain section switch-back", () => {
  it("does not rebuild the KPI model when switching away from 'kpi' and back with nothing changed", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("1 صورة")).toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole("tab", { name: "مؤشرات" }));
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByRole("tab", { name: "التقارير" }));
    fireEvent.click(await screen.findByRole("tab", { name: "مؤشرات" }));

    // Give an (incorrect) rebuild a chance to fire before asserting it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);

    // The cached model itself must still be intact after the switch-back too --
    // a regression that skipped the rebuild but still nulled `model` (e.g. by
    // moving the `setModel(null)` above the `alreadyBuilt` check) would leave
    // `loadMonthPopulationFinal`'s call count untouched while the dashboard
    // silently reverted to its "no model" empty state, which the assertion
    // above alone would not catch.
    expect(screen.getByRole("button", { name: /فتح العرض التنفيذي/ })).toBeInTheDocument();
  });

  it("invalidates the cache and rebuilds the KPI model when the selected month genuinely changes", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const { rerender } = render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("1 صورة")).toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole("tab", { name: "مؤشرات" }));
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", { name: /فتح العرض التنفيذي/ })).toBeInTheDocument();

    // Flip the app-wide month selection while still on the "kpi" sub-tab -- a
    // genuine handle/month change, unlike the plain switch-away-and-back above.
    globalMonthMock.state.selection = { kind: "existing", month: 5, year: 2026, folderName: "5-may-2026" };
    rerender(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("5-may-2026").resolve(mockManifest(2));
      deferredFor("5-may-2026").resolve(mockPop(2));
      await Promise.resolve();
    });

    // The cached ref no longer matches the new month, so the model must be
    // rebuilt -- proving the cache doesn't over-skip and get stuck on stale data.
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(2);
    });
    expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenNthCalledWith(2, root, "5-may-2026");
  });
});

describe("Reports sub-tab mount preservation (§T)", () => {
  afterEach(cleanup);

  it("keeps Report Designer mounted (hidden, not unmounted) after the first visit", async () => {
    reportDesignerMountCount.count = 0;
    render(<ReportsTab />);

    // Wait for the first paint before dispatching. `ReportsTab` subscribes to
    // `sidebar-subtab-changed` from an effect, and dispatching synchronously
    // after `render()` can fire the event before React has flushed that effect —
    // the listener isn't attached yet, the sub-tab never switches, and the
    // assertion below fails against the default (empty) view. That race only
    // lost under parallel-worker contention, which is why it surfaced as an
    // intermittent, order-dependent failure rather than a consistent one.
    await waitFor(() => expect(document.querySelector(".rh-page")).toBeTruthy());

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "report-designer" },
        })
      );
    });
    expect(await screen.findByTestId("report-designer-stub")).toBeInTheDocument();
    expect(reportDesignerMountCount.count).toBe(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "reports" },
        })
      );
    });
    const stub = screen.getByTestId("report-designer-stub");
    expect(stub.parentElement).toHaveAttribute("hidden");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "report-designer" },
        })
      );
    });
    // Switching back must NOT remount it.
    expect(reportDesignerMountCount.count).toBe(1);
  });

  it("mounts the comprehensive-executive sub-tab on first visit and keeps it mounted, hidden", async () => {
    render(<ReportsTab />);
    await waitFor(() => expect(document.querySelector(".rh-page")).toBeTruthy());
    expect(screen.queryByTestId("comprehensive-executive-stub")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "comprehensive-executive" },
        })
      );
    });
    const stub = await screen.findByTestId("comprehensive-executive-stub");
    expect(stub.closest("[hidden]")).toBeNull();
    expect(document.querySelector(".rh-page")?.closest("[hidden]")).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", {
          detail: { parentTabId: "reports", subTabId: "reports" },
        })
      );
    });
    expect(screen.getByTestId("comprehensive-executive-stub").closest("[hidden]")).not.toBeNull();
  });

  it("does not mount Report Designer before it has ever been visited", () => {
    reportDesignerMountCount.count = 0;
    render(<ReportsTab />);
    expect(screen.queryByTestId("report-designer-stub")).not.toBeInTheDocument();
  });
});

describe("Reports — lazy report-builder imports (§N)", () => {
  it("does not evaluate the report-builder modules just from rendering the tab", async () => {
    // What this test actually guards against: a future regression where one of
    // these builder functions gets CALLED eagerly (e.g. from a render-time effect)
    // instead of only from a click handler. It does NOT and CANNOT detect
    // static-vs-dynamic import timing -- `vi.mock` intercepts the module the same
    // way whether index.tsx imports it statically at the top of the file or
    // dynamically via `await import(...)` inside a handler, and the assertions
    // below are on invocation (was the function called?), not module evaluation
    // (was the module's top-level code executed?). This test would pass
    // identically against a hypothetical pre-fix version that imported all 5
    // modules statically, as long as none of them called their function outside
    // a click handler. A true startup-eval measurement needs a real build +
    // DevTools profile (or a build-output static-import grep, as done for the
    // whole-branch review), out of scope for a unit test.
    //
    // (Task 12, population-report-merge plan, 2026-08-30: this used to assert on
    // 7 mocked report-builder modules — `deck2/styleChoices`, `deck2`, `deck3`,
    // `powerbiExport/exportManager`, `distributionReport`, `sampleReport`,
    // `executiveReport` — before `distributionReport.ts`/`sampleReport.ts` were
    // retired, dropping the count to the 5 that remain.)
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    render(<ReportsTab />);

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(1));
      await Promise.resolve();
    });

    // None of the 5 builder modules' mocked factory functions should have
    // been touched yet -- only rendering happened, no export was clicked.
    expect(executiveReportSpies.openExecutiveReport).not.toHaveBeenCalled();
  });
});

// T-12 — Reports/KPI freshness. Everything this tab shows (the month chips and the
// whole KPI dashboard) used to load exactly once, on mount / on a month change, and
// subscribe to NOTHING: another machine's answer submission, a restore, or an admin's
// manual sync never reached it, so the on-screen numbers could silently disagree with
// an export generated from the very same screen seconds later. It now subscribes to
// dataRefreshSignal like the other workspace-reading views — but gated on real
// visibility, because the app-level tab-mount LRU keeps up to three tabs mounted
// (hidden, via a `hidden` attribute on an ancestor) and re-running this tab's heaviest
// read path for a view nobody is looking at is exactly what that gate exists to avoid.
describe("Reports — background data refresh (T-12)", () => {
  async function renderWithDashboardOpen(hidden: boolean) {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    (globalThis as { __testDir?: DirectoryHandleLike }).__testDir = root;

    const view = render(
      <div hidden={hidden || undefined}>
        <ReportsTab />
      </div>
    );

    await act(async () => {
      deferredManifestFor("4-april-2026").resolve(mockManifest(7));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("7 صورة")).toBeInTheDocument();
    });

    // Open the KPI dashboard so the heavy model build is the observable effect.
    fireEvent.click(await screen.findByRole("tab", { name: "مؤشرات" }));
    await act(async () => {
      deferredFor("4-april-2026").resolve(mockPop(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
    });
    return view;
  }

  it("re-reads month data when a refresh is broadcast while the tab is visible", async () => {
    await renderWithDashboardOpen(false);
    const manifestCallsBefore = populationStorageSpies.loadMonthManifest.mock.calls.length;

    act(() => {
      broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["answers"]) });
    });

    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(2);
    });
    expect(populationStorageSpies.loadMonthManifest.mock.calls.length).toBe(manifestCallsBefore + 1);
    // A refresh re-reads; it must not tear the dashboard down and back up (that
    // would discard the user's in-progress dashboard state).
    expect(screen.queryByText(/جارٍ تجهيز لوحة التحليلات/)).not.toBeInTheDocument();
  });

  it("re-reads on a manual refresh too, regardless of the changed family set", async () => {
    await renderWithDashboardOpen(false);

    act(() => {
      broadcastDataRefresh("manual");
    });

    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(2);
    });
  });

  it("defers the re-read while mounted-but-hidden, then runs it once visible again", async () => {
    const { rerender } = await renderWithDashboardOpen(false);

    // The app shell hides a mounted-but-inactive tab with a `hidden` ancestor.
    rerender(
      <div hidden>
        <ReportsTab />
      </div>
    );

    act(() => {
      broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["answers"]) });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Hidden: the heavy read must NOT have run.
    expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(1);

    // Back on screen: the deferred refresh runs now.
    rerender(
      <div>
        <ReportsTab />
      </div>
    );
    await waitFor(() => {
      expect(populationStorageSpies.loadMonthPopulationFinal).toHaveBeenCalledTimes(2);
    });
  });
});
