/* @vitest-environment jsdom */
// B6 — digit locale: the headline KPI number and the groupBy-breakdown counts must render
// with Latin digits ("ar-SA-u-nu-latn"), matching the rest of the app, instead of the
// Arabic-Indic digits plain "ar-SA" yields.
//
// KpiRenderer no longer loads its own data (Task 2 perf fix) -- it reads the
// shared executive rows from `ExecutiveRowsProvider` via `useExecutiveRows()`,
// so every render here needs that provider as an ancestor. See
// `executiveRowsContext.test.tsx` for the shared-load-happens-once and
// template-passthrough coverage.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import KpiRenderer from "./KpiRenderer";
import { ExecutiveRowsProvider } from "./ExecutiveRowsProvider";
import type { Element, KpiConfig } from "../../../../../data/reportDesigner/reportTypes";

// A row count large enough that Arabic-Indic ("١٢٬٣٤٥") and Latin ("12,345") renderings
// are unmistakably different (thousands separator present).
// `imageAvailable` is true on exactly one row in five (2,469 of 12,345 = 20%), which
// gives the percentOfTotal case below an unambiguous expected share.
const rows = vi.hoisted(() =>
  Array.from({ length: 12345 }, (_, i) => ({
    xrayImageId: `img-${i}`,
    portName: "A",
    imageAvailable: i % 5 === 0,
  }))
);

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
// buildExecutiveReportRows normally derives rows from population/sample/distribution —
// mocked here to hand KpiRenderer a fixed-size row set regardless of its (irrelevant, all
// null/empty) inputs, so the rendered count is deterministic.
vi.mock("../../../../../data/reporting/executiveReportData", () => ({
  buildExecutiveReportRows: vi.fn(() => rows),
}));

afterEach(cleanup);

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

describe("KpiRenderer — B6 digit locale", () => {
  it("renders the headline number with Latin digits, not Arabic-Indic", async () => {
    const element = kpiElement({ kind: "kpi", dataSourceId: "population", valueField: "xrayImageId", agg: "count" });
    render(
      <ExecutiveRowsProvider>
        <KpiRenderer element={element} />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("12,345")).toBeInTheDocument();
    });
    // The Arabic-Indic rendering of the same count must not appear anywhere.
    expect(screen.queryByText("١٢٬٣٤٥")).not.toBeInTheDocument();
  });

  it("renders «نسبة من الإجمالي» as a real share, not a fabricated 0", async () => {
    // percentOfTotal needs a denominator; without one the aggregator short-circuits to
    // 0 and the tile shows a zero indistinguishable from a genuine one.
    const element = kpiElement({
      kind: "kpi",
      dataSourceId: "population",
      valueField: "imageAvailable",
      agg: "percentOfTotal",
    });
    render(
      <ExecutiveRowsProvider>
        <KpiRenderer element={element} />
      </ExecutiveRowsProvider>
    );

    // 2,469 of 12,345 rows carry a true value → 20%.
    await waitFor(() => {
      expect(screen.getByText("20")).toBeInTheDocument();
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders groupBy-breakdown counts with Latin digits, not Arabic-Indic", async () => {
    const element = kpiElement({
      kind: "kpi",
      dataSourceId: "population",
      valueField: "xrayImageId",
      agg: "count",
      groupByField: "portName",
      groupByLabel: "المنفذ",
    });
    render(
      <ExecutiveRowsProvider>
        <KpiRenderer element={element} />
      </ExecutiveRowsProvider>
    );

    await waitFor(() => {
      // Single group ("A") holds all of `rows` → its breakdown-row count.
      expect(screen.getByText("12,345")).toBeInTheDocument();
    });
    expect(screen.queryByText("١٢٬٣٤٥")).not.toBeInTheDocument();
  });
});
