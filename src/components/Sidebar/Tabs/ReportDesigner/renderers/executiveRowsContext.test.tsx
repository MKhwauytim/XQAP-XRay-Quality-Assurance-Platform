/* @vitest-environment jsdom */
// Task 2 coverage: N KpiRenderer/consumer instances under one
// ExecutiveRowsProvider must share ONE load + ONE buildExecutiveReportRows
// call (previously each KPI tile ran the whole read+build independently),
// and the resolved template must be passed through so label-based fields
// resolve identically to the executive report (previously hardcoded to
// `template: null`, so KPI tiles could silently disagree with the
// executive report for the same field/month).
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecutiveRowsProvider } from "./ExecutiveRowsProvider";
import { useExecutiveRows } from "./executiveRowsContext";

const FAKE_DIRECTORY_HANDLE = vi.hoisted(() => ({}));
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: FAKE_DIRECTORY_HANDLE }),
}));
vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: { kind: "existing", folderName: "5-may-2026" } }),
}));

const loadMonthPopulationFinal = vi.fn().mockResolvedValue({ rows: [{ xrayImageId: "img-1" }] });
const loadSampleMaster = vi.fn().mockResolvedValue(null);
const loadOrDeriveDistributionCurrentForRead = vi.fn().mockResolvedValue(null);
const loadAllEmployeeFiles = vi.fn().mockResolvedValue([]);
const loadInspectionTemplateSelection = vi.fn().mockResolvedValue({ templateId: "tmpl-1" });
const loadTemplate = vi.fn().mockResolvedValue({ templateId: "tmpl-1", fields: [] });
const FAKE_ROWS = [{ xrayImageId: "img-1", imageQuality: "good" }];
const buildExecutiveReportRows = vi.fn((_input: unknown) => FAKE_ROWS);

vi.mock("../../../../../data/population/populationStorage", () => ({
  loadMonthPopulationFinal: (dir: unknown, month: unknown) => loadMonthPopulationFinal(dir, month),
}));
vi.mock("../../../../../data/sampling/sampleStorage", () => ({
  loadSampleMaster: (dir: unknown, month: unknown) => loadSampleMaster(dir, month),
}));
vi.mock("../../../../../data/distribution/distributionStorage", () => ({
  loadOrDeriveDistributionCurrentForRead: (dir: unknown, month: unknown, sampleRows: unknown) =>
    loadOrDeriveDistributionCurrentForRead(dir, month, sampleRows),
}));
vi.mock("../../../../../data/answers/answerStorage", () => ({
  loadAllEmployeeFiles: (dir: unknown, month: unknown) => loadAllEmployeeFiles(dir, month),
}));
vi.mock("../../../../../data/templates/templateSelectionStorage", () => ({
  loadInspectionTemplateSelection: (dir: unknown) => loadInspectionTemplateSelection(dir),
}));
vi.mock("../../../../../data/templates/templateStorage", () => ({
  loadTemplate: (dir: unknown, templateId: unknown) => loadTemplate(dir, templateId),
}));
vi.mock("../../../../../data/reporting/executiveReportData", () => ({
  buildExecutiveReportRows: (input: unknown) => buildExecutiveReportRows(input),
}));

const logError = vi.fn();
vi.mock("../../../../../data/storage/errorLogger", () => ({
  logError: (context: string, error: unknown) => logError(context, error),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// T-19: the context is a three-state union now (loading / loaded-empty / loaded),
// so this consumer reports each state distinctly instead of collapsing
// "not loaded yet" and "loaded with nothing in it" into one falsy value.
function Consumer({ label }: { label: string }) {
  const rows = useExecutiveRows();
  const text =
    rows.status === "loaded"
      ? `loaded:${rows.rows.length}`
      : rows.status === "loaded-empty"
        ? "loaded-empty"
        : "loading";
  return <span data-testid={label}>{text}</span>;
}

describe("ExecutiveRowsProvider", () => {
  it("shares one load across multiple KPI-tile consumers", async () => {
    render(
      <ExecutiveRowsProvider>
        <Consumer label="tile-1" />
        <Consumer label="tile-2" />
        <Consumer label="tile-3" />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tile-1")).toHaveTextContent("loaded:1");
    });
    expect(screen.getByTestId("tile-2")).toHaveTextContent("loaded:1");
    expect(screen.getByTestId("tile-3")).toHaveTextContent("loaded:1");

    // One load, not three, regardless of how many tiles consumed it.
    expect(loadMonthPopulationFinal).toHaveBeenCalledTimes(1);
    expect(loadSampleMaster).toHaveBeenCalledTimes(1);
    expect(loadOrDeriveDistributionCurrentForRead).toHaveBeenCalledTimes(1);
    expect(loadAllEmployeeFiles).toHaveBeenCalledTimes(1);
    expect(buildExecutiveReportRows).toHaveBeenCalledTimes(1);
  });

  it("resolves and passes the template through to buildExecutiveReportRows, not a hardcoded null", async () => {
    render(
      <ExecutiveRowsProvider>
        <Consumer label="tile" />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tile")).toHaveTextContent("loaded:1");
    });

    expect(loadInspectionTemplateSelection).toHaveBeenCalledTimes(1);
    expect(loadTemplate).toHaveBeenCalledWith(expect.anything(), "tmpl-1");
    expect(buildExecutiveReportRows).toHaveBeenCalledWith(
      expect.objectContaining({ template: { templateId: "tmpl-1", fields: [] } })
    );
  });

  // Regression for the bare `void (async () => {...})()` with no `.catch`: a rejection used to
  // become an unhandled promise rejection and every consumer sat at `rows === null` ("loading")
  // forever. Proven against the pre-fix code: this test hangs waiting for the alert/"loading" exit
  // and vitest reports an unhandled rejection instead of passing.
  it("surfaces a load failure instead of spinning forever", async () => {
    loadMonthPopulationFinal.mockRejectedValueOnce(new Error("boom"));

    render(
      <ExecutiveRowsProvider>
        <Consumer label="tile" />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // No longer stuck at "loading" — the provider settles to the explicit "loaded-empty"
    // state (T-19), so consumers stop waiting and render the neutral «—» marker.
    expect(screen.getByTestId("tile")).not.toHaveTextContent("loading");
    expect(logError).toHaveBeenCalledWith("reportDesigner:executiveRowsProvider", expect.any(Error));
  });
});

// T-19 — "loading" and "loaded, and there is nothing" are separate states now. They used
// to be the same falsy value, so a consumer could not tell a month whose data had not
// arrived from a month that genuinely has no fact rows.
describe("ExecutiveRowsProvider — loading vs loaded-empty are distinguishable (T-19)", () => {
  it("reports loading first, then loaded-empty for a month that builds zero rows", async () => {
    buildExecutiveReportRows.mockReturnValueOnce([]);

    render(
      <ExecutiveRowsProvider>
        <Consumer label="tile" />
      </ExecutiveRowsProvider>
    );

    // Synchronously after mount the load is still in flight.
    expect(screen.getByTestId("tile")).toHaveTextContent("loading");

    await waitFor(() => {
      expect(screen.getByTestId("tile")).toHaveTextContent("loaded-empty");
    });
  });

  it("reports loaded-empty (not loading) after a failed load, so tiles stop spinning", async () => {
    loadMonthPopulationFinal.mockRejectedValueOnce(new Error("boom"));

    render(
      <ExecutiveRowsProvider>
        <Consumer label="tile" />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("tile")).toHaveTextContent("loaded-empty");
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
