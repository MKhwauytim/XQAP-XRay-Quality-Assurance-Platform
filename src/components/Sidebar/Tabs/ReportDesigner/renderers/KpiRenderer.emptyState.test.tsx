/* @vitest-environment jsdom */
// T-19 — the fabricated-zero invariant, applied to the Report Designer's KPI tile.
//
// "A null denominator renders «—», never 0" is enforced in kpiSelectors / aggregates /
// reviewerKpis, but this satellite broke it: a month with zero executive fact rows (not
// yet processed, empty, or a failed load — the provider settles all three to "nothing")
// made every tile render a confident `0`, indistinguishable on screen from a real
// measured zero. Same for a groupBy tile whose grouping field is empty on every row, and
// for an aggregation with no denominator (avg/min/max over no numeric values).
//
// Deliberately driven through the real `ExecutiveRowsProvider` (rather than by handing
// the context a value directly) so these tests exercise the exact path the canvas uses.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import KpiRenderer from "./KpiRenderer";
import { ExecutiveRowsProvider } from "./ExecutiveRowsProvider";
import type { Element, KpiConfig } from "../../../../../data/reportDesigner/reportTypes";

const builtRows = vi.hoisted(() => ({ value: [] as Array<Record<string, unknown>> }));

const FAKE_DIRECTORY_HANDLE = vi.hoisted(() => ({}));
vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: FAKE_DIRECTORY_HANDLE }),
}));
vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({ selection: { kind: "existing", folderName: "5-may-2026" } }),
}));
vi.mock("../../../../../data/population/populationStorage", () => ({
  loadMonthPopulationFinal: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../../../data/sampling/sampleStorage", () => ({
  loadSampleMaster: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../../../data/distribution/distributionStorage", () => ({
  loadOrDeriveDistributionCurrentForRead: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../../../data/answers/answerStorage", () => ({
  loadAllEmployeeFiles: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../../../data/templates/templateSelectionStorage", () => ({
  loadInspectionTemplateSelection: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../../../data/templates/templateStorage", () => ({
  loadTemplate: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../../../data/reporting/executiveReportData", () => ({
  buildExecutiveReportRows: vi.fn(() => builtRows.value),
}));

afterEach(() => {
  cleanup();
  builtRows.value = [];
});

function kpiElement(config: KpiConfig): Element {
  return {
    elementId: "el-kpi",
    type: "kpi",
    name: "عدد الصور",
    x: 0, y: 0, w: 160, h: 100, z: 0,
    style: {},
    config,
  };
}

function renderTile(config: KpiConfig) {
  return render(
    <ExecutiveRowsProvider>
      <KpiRenderer element={kpiElement(config)} />
    </ExecutiveRowsProvider>
  );
}

/** The load has settled when the aggregation badge is on screen and nothing is pending. */
async function settle() {
  await waitFor(() => {
    expect(screen.getByText("عدد الصور")).toBeInTheDocument();
  });
  // One extra flush so a late setRows commit cannot be mistaken for "still loading".
  await waitFor(() => {
    expect(screen.getByText("—")).toBeInTheDocument();
  });
}

describe("KpiRenderer — empty aggregates render «—», never a fabricated 0 (T-19)", () => {
  it("renders «—» for a count over a month with zero fact rows", async () => {
    builtRows.value = [];
    renderTile({ kind: "kpi", dataSourceId: "population", valueField: "xrayImageId", agg: "count" });

    await settle();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders «—» for a groupBy breakdown whose grouping field is empty on every row", async () => {
    builtRows.value = [{ xrayImageId: "img-1", portName: null }, { xrayImageId: "img-2", portName: null }];
    renderTile({
      kind: "kpi",
      dataSourceId: "population",
      valueField: "xrayImageId",
      agg: "count",
      groupByField: "portName",
      groupByLabel: "المنفذ",
    });

    await settle();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders «—» for a distinctCount whose field is null on every row", async () => {
    builtRows.value = [{ portName: null }, { portName: null }];
    renderTile({ kind: "kpi", dataSourceId: "population", valueField: "portName", agg: "distinctCount" });

    await settle();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders «—» for an average with no numeric values behind it", async () => {
    builtRows.value = [{ score: null }, { score: "غير متاح" }];
    renderTile({ kind: "kpi", dataSourceId: "population", valueField: "score", agg: "avg" });

    await settle();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("still renders a real measured value — the marker is for missing data only", async () => {
    builtRows.value = [{ score: 4 }, { score: 6 }];
    renderTile({ kind: "kpi", dataSourceId: "population", valueField: "score", agg: "avg" });

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("still renders a genuine zero measurement — a real 0 is not suppressed", async () => {
    builtRows.value = [{ score: 0 }, { score: 0 }];
    renderTile({ kind: "kpi", dataSourceId: "population", valueField: "score", agg: "sum" });

    await waitFor(() => {
      expect(screen.getByText("0")).toBeInTheDocument();
    });
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
