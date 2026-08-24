/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLabels } from "../../../../data/labels/labelsStore";
import type { ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import type { AnswerGroup, ReviewerControlStatus } from "./kpiSelectors";
import ReviewerKpiPanel from "./ReviewerKpiPanel";

// jsdom has no ResizeObserver; the reviewer table now renders through the
// shared DataTable (Task 4 of the 2026-08-24 datatable-sort-filter-consistency
// plan), which observes its scroll container for row virtualization — same
// stub DataTable's own tests use.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

// Three distinguishable, deliberately out-of-order rows for the DataTable
// migration's sort/filter tests below — `makeModel()` above stays a single
// row (with a resolveName that returns the SAME string for every row) so the
// four pre-existing tests are untouched; giving it three rows too would make
// their constant-name `resolveName` produce three identically-named cells,
// which `getByRole("cell", { name: ... })` can no longer resolve unambiguously.
function makeMultiReviewerModel(): ReviewerKpiModel {
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
      {
        reviewerId: "reviewer-2",
        assigned: 6,
        completed: 3,
        completionRate: 50,
        quota: null,
        throughputVsQuota: null,
        turnaroundMedianHours: 9,
        turnaroundP90Hours: 12,
        reviewedWithVerdict: 3,
        suspiciousOrReferral: 1,
        suspicionOrReferralRate: 33.3,
        referralCount: 0,
        referralRate: 0,
      },
      {
        reviewerId: "reviewer-3",
        assigned: 15,
        completed: 12,
        completionRate: 80,
        quota: null,
        throughputVsQuota: null,
        turnaroundMedianHours: 5,
        turnaroundP90Hours: 7,
        reviewedWithVerdict: 12,
        suspiciousOrReferral: 3,
        suspicionOrReferralRate: 25,
        referralCount: 1,
        referralRate: 8.3,
      },
    ],
    reviewerPChart: { center: 0.25, minN: 5, groups: [] },
    portPChart: { center: 0.4, minN: 5, groups: [] },
  };
}

function nameOf(id: string): string {
  if (id === "reviewer-1") return "المراجع الأول";
  if (id === "reviewer-2") return "المراجع الثاني";
  return "المراجع الثالث";
}

/** The reviewer name column's rendered values, in visual (DataTable body) row order. */
function reviewerNamesInOrder(): string[] {
  return Array.from(document.querySelectorAll(".dt-table tbody tr")).map(
    (tr) => tr.querySelector("td")?.textContent ?? ""
  );
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

describe("ReviewerKpiPanel — reviewer table on the shared DataTable", () => {
  it("renders the reviewer rows through DataTable, with its toolbar", () => {
    render(
      <ReviewerKpiPanel
        model={makeMultiReviewerModel()}
        resolveName={nameOf}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );
    // The shared toolbar's global search box is DataTable's signature — a
    // hand-rolled <table> has none.
    expect(screen.getByLabelText(labels.dt_search_placeholder)).toBeInTheDocument();
  });

  it("sorts by a numeric column numerically", () => {
    render(
      <ReviewerKpiPanel
        model={makeMultiReviewerModel()}
        resolveName={nameOf}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${labels.dt_sort_button_prefix}: ${labels.rk_col_completed}` })
    );
    expect(reviewerNamesInOrder()).toEqual(["المراجع الثاني", "المراجع الأول", "المراجع الثالث"]);
  });

  it("filters via the shared global search", async () => {
    render(
      <ReviewerKpiPanel
        model={makeMultiReviewerModel()}
        resolveName={nameOf}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );
    fireEvent.change(screen.getByLabelText(labels.dt_search_placeholder), {
      target: { value: "الثالث" },
    });
    await waitFor(() => expect(reviewerNamesInOrder()).toEqual(["المراجع الثالث"]));
  });

  it("keeps the completion progress bar and the الحالة pill as custom cells", () => {
    const statuses = new Map<string, ReviewerControlStatus>([["reviewer-1", "in-control"]]);
    const { container } = render(
      <ReviewerKpiPanel
        model={makeMultiReviewerModel()}
        resolveName={nameOf}
        answers={makeAnswers()}
        statuses={statuses}
      />
    );
    // These are the two cells that are NOT plain text; migrating must not
    // flatten them into their accessor strings.
    expect(container.querySelector(".rk-progress-fill")).toBeTruthy();
    expect(screen.getByText(labels.rk_status_in_control)).toBeInTheDocument();
  });

  it("still renders the sr-only chart table as a plain semantic table (NOT migrated)", () => {
    const { container } = render(
      <ReviewerKpiPanel
        model={makeMultiReviewerModel()}
        resolveName={nameOf}
        answers={makeAnswers()}
        statuses={new Map()}
      />
    );
    const srTable = container.querySelector("table.rk-sr-only");
    expect(srTable).toBeTruthy();
    // If someone routes this one through DataTable too, it acquires dt- classes.
    expect(srTable?.classList.contains("dt-table")).toBe(false);
  });
});
