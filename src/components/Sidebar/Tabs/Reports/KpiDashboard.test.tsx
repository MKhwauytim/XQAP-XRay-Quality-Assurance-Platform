/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getLabels } from "../../../../data/labels/labelsStore";
import KpiDashboard from "./KpiDashboard";
import { makeReportModel } from "./kpiTestModel";

afterEach(cleanup);

const labels = getLabels();

function renderDashboard(model = makeReportModel()) {
  return render(
    <KpiDashboard
      model={model}
      monthLabel="أبريل 2026"
      resolveName={(username) => (username === "u1" ? "المراجع الأول" : username)}
      exporting={null}
      canExportReports
      isAdmin={false}
      exportDisabledTitle={undefined}
      exportsDisabled={false}
      onExport={vi.fn()}
      onOpenCustomizer={vi.fn()}
    />
  );
}

describe("KpiDashboard — section switcher", () => {
  it("defaults to نظرة عامة and switches sections on click", () => {
    const { container } = renderDashboard();

    // Default section: the overview gauges/agreement card, not the ports list.
    expect(screen.getByRole("tab", { name: labels.kpi_tab_overview })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText(labels.kpi_agreement_title)).toBeInTheDocument();
    expect(container.querySelector(".kpi-port-list")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: labels.kpi_tab_ports }));
    expect(screen.getByRole("tab", { name: labels.kpi_tab_ports })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(container.querySelector(".kpi-port-list")).not.toBeNull();
    expect(screen.queryByText(labels.kpi_agreement_title)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: labels.kpi_tab_reviewers }));
    expect(screen.getByText(labels.kpi_reviewers_title)).toBeInTheDocument();
  });
});

describe("KpiDashboard — port selection", () => {
  it("selects the best port by default and updates the detail panel on row click", () => {
    const { container } = renderDashboard(
      makeReportModel({
        ports: [
          { key: "منفذ متوسط", evaluable: 120, accuracy: 78, band: "limited" },
          { key: "منفذ ممتاز", evaluable: 200, accuracy: 92, band: "sufficient" },
        ],
      })
    );
    fireEvent.click(screen.getByRole("tab", { name: labels.kpi_tab_ports }));

    // Default selection = the FIRST row after the best-first sort, even though
    // the model handed the ports over in a different order.
    const detail = container.querySelector(".kpi-port-detail") as HTMLElement;
    expect(within(detail).getByText("منفذ ممتاز")).toBeInTheDocument();
    const rows = container.querySelectorAll(".kpi-port-row");
    expect(rows[0]).toHaveClass("active");

    fireEvent.click(screen.getByRole("option", { name: /منفذ متوسط/ }));

    expect(within(detail).getByText("منفذ متوسط")).toBeInTheDocument();
    expect(within(detail).queryByText("منفذ ممتاز")).toBeNull();
    expect(container.querySelectorAll(".kpi-port-row")[1]).toHaveClass("active");
  });
});

describe("KpiDashboard — answers-view toggle", () => {
  it("re-renders the grouped answers chart against port data when toggled", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("tab", { name: labels.kpi_tab_reviewers }));

    // Reviewer view: the chart's screen-reader twin lists reviewers. Scope to
    // that table — the reviewer's display name also appears in the KPI table
    // row above it, so an unscoped query would match both.
    const reviewerTable = screen.getByRole("table", { name: labels.kpi_answers_title_reviewer });
    expect(reviewerTable).toBeInTheDocument();
    expect(within(reviewerTable).getByRole("cell", { name: "المراجع الأول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: labels.rk_toggle_port }));

    const portTable = screen.getByRole("table", { name: labels.kpi_answers_title_port });
    expect(portTable).toBeInTheDocument();
    expect(within(portTable).getByRole("cell", { name: "ميناء الأول" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: labels.kpi_answers_title_reviewer })).toBeNull();
  });
});

describe("KpiDashboard — sample-progress tone rule", () => {
  it("uses the sky tone at/above 80% completion and the amber tone below it", () => {
    const { container } = renderDashboard(
      makeReportModel({
        byStage: [
          { stageKey: "L1", stageLabel: "المستوى الأول", sampleSize: 100, studied: 80 },
          { stageKey: "L2", stageLabel: "المستوى الثاني", sampleSize: 100, studied: 79 },
        ],
      })
    );
    const levels = container.querySelectorAll(".kpi-level");

    // Exactly 80% is inside the good band — the boundary is >=, not >.
    expect(levels[0]!.querySelector(".kpi-level-pct")).toHaveClass("kpi-tone-sky");
    expect(levels[0]!.querySelector(".kpi-level-bar-fill")).toHaveClass("kpi-tone-bg-sky");
    expect(levels[1]!.querySelector(".kpi-level-pct")).toHaveClass("kpi-tone-amber");
    expect(levels[1]!.querySelector(".kpi-level-bar-fill")).toHaveClass("kpi-tone-bg-amber");
  });
});

describe("KpiDashboard — honesty discipline", () => {
  it("renders «—» rather than 0% wherever the denominator is empty", () => {
    const { container } = renderDashboard(
      makeReportModel({
        overallAccuracy: null,
        detectionRate: null,
        missedSuspicionRate: null,
        byStage: [
          { stageKey: "L1", stageLabel: "المستوى الأول", sampleSize: 0, studied: 0 },
        ],
      })
    );

    const values = [...container.querySelectorAll(".kpi-card-value")].map((el) => el.textContent);
    expect(values.slice(0, 3)).toEqual(["—", "—", "—"]);
    expect(values.join(" ")).not.toContain("0.0%");

    // A level with nothing drawn shows «—», not a misleading 0%.
    expect(container.querySelector(".kpi-level-pct")?.textContent).toBe("—");
    expect(container.querySelector(".kpi-mini-ring strong")?.textContent).toBe("—");

    // The port with a null accuracy also renders «—» in its detail panel.
    fireEvent.click(screen.getByRole("tab", { name: labels.kpi_tab_ports }));
    const detail = container.querySelector(".kpi-port-detail") as HTMLElement;
    expect(detail.textContent).not.toContain("0.0%");
  });
});
