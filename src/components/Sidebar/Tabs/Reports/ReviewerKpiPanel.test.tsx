/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getLabels } from "../../../../data/labels/labelsStore";
import type { ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import type { AnswerGroup, ReviewerControlStatus } from "./kpiSelectors";
import ReviewerKpiPanel from "./ReviewerKpiPanel";

afterEach(cleanup);

const labels = getLabels();

function makeModel(): ReviewerKpiModel {
  return {
    rows: [
      {
        reviewerId: "reviewer-1",
        assigned: 10,
        completed: 8,
        completionRate: 80,
        quota: null,
        throughputVsQuota: null,
        turnaroundMedianHours: 2,
        turnaroundP90Hours: 4,
        reviewedWithVerdict: 8,
        suspiciousOrReferral: 2,
        suspicionOrReferralRate: 25,
        referralCount: 1,
        referralRate: 12.5,
      },
    ],
    reviewerPChart: { center: 0.25, minN: 5, groups: [] },
    portPChart: { center: 0.4, minN: 5, groups: [] },
  };
}

function makeAnswers(): { reviewer: AnswerGroup[]; port: AnswerGroup[] } {
  return {
    reviewer: [
      { key: "reviewer-1", label: "المراجع الأول", suspicion: 2, clean: 6, incomplete: 2, total: 10 },
    ],
    port: [
      { key: "ميناء الاختبار", label: "ميناء الاختبار", suspicion: 3, clean: 5, incomplete: 1, total: 9 },
    ],
  };
}

describe("ReviewerKpiPanel", () => {
  it("renders the reviewer table with the الحالة pill sourced from the p-chart status map", () => {
    const statuses = new Map<string, ReviewerControlStatus>([["reviewer-1", "in-control"]]);
    render(
      <ReviewerKpiPanel
        model={makeModel()}
        resolveName={() => "اسم المراجع"}
        answers={makeAnswers()}
        statuses={statuses}
      />
    );

    expect(screen.getByText(labels.kpi_reviewers_title)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "اسم المراجع" })).toBeInTheDocument();
    expect(screen.getByText(labels.rk_status_in_control)).toBeInTheDocument();
  });

  it("falls back to the low-n pill when a reviewer has no p-chart status entry", () => {
    render(
      <ReviewerKpiPanel
        model={makeModel()}
        resolveName={() => "اسم المراجع"}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );
    expect(screen.getByText(labels.rk_legend_low_n)).toBeInTheDocument();
  });

  it("renders an aria-hidden grouped bar chart, an accessible table, and switches to port data", () => {
    const { container } = render(
      <ReviewerKpiPanel
        model={makeModel()}
        resolveName={() => "اسم المراجع"}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );

    expect(container.querySelector(".rk-chart")).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("table", { name: labels.kpi_answers_title_reviewer })
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "المراجع الأول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: labels.rk_toggle_port }));

    expect(
      screen.getByRole("table", { name: labels.kpi_answers_title_port })
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "ميناء الاختبار" })).toBeInTheDocument();
  });

  it("shows the empty state when the model has no reviewer rows", () => {
    render(
      <ReviewerKpiPanel
        model={{ rows: [], reviewerPChart: { center: null, minN: 5, groups: [] }, portPChart: { center: null, minN: 5, groups: [] } }}
        resolveName={(u) => u}
        answers={{ reviewer: [], port: [] }}
        statuses={new Map()}
      />
    );
    expect(screen.getByText(labels.rk_empty_title)).toBeInTheDocument();
  });
});
