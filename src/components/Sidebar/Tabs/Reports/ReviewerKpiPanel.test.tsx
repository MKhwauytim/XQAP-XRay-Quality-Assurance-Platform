/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getLabels } from "../../../../data/labels/labelsStore";
import type { ReviewerKpiModel } from "../../../../data/reporting/executive/model/reviewerKpis";
import ReviewerKpiPanel from "./ReviewerKpiPanel";
import { buildPChartSvgGeometry } from "./pChartSvgGeometry";

afterEach(cleanup);

describe("buildPChartSvgGeometry", () => {
  it("places the first category on the right and the last on the left", () => {
    const geometry = buildPChartSvgGeometry(
      [
        { pPct: 10, uclPct: 30, lclPct: 0 },
        { pPct: 20, uclPct: 40, lclPct: 5 },
        { pPct: 30, uclPct: 50, lclPct: 10 },
      ],
      20,
    );

    expect(geometry.points.map((point) => point.x)).toEqual([888, 456, 24]);
    expect(geometry.upperPath).toContain("H 456");
    expect(geometry.bandPath).toMatch(/^M .+ Z$/);
  });

  it("centres a single category and clamps percentages to the plot", () => {
    const geometry = buildPChartSvgGeometry(
      [{ pPct: 110, uclPct: 125, lclPct: -10 }],
      50,
    );

    expect(geometry.points[0]).toEqual({
      x: 456,
      pY: 16,
      uclY: 16,
      lclY: 242,
    });
    expect(geometry.centerY).toBe(129);
  });

  it("returns empty paths for an empty dataset", () => {
    expect(buildPChartSvgGeometry([], 0)).toMatchObject({
      points: [],
      upperPath: "",
      lowerPath: "",
      bandPath: "",
    });
  });
});

describe("ReviewerKpiPanel native chart", () => {
  it("renders an aria-hidden SVG, an accessible table, and switches to port data", () => {
    const model: ReviewerKpiModel = {
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
      reviewerPChart: {
        center: 0.25,
        minN: 5,
        groups: [
          {
            key: "reviewer-1",
            n: 8,
            x: 2,
            p: 0.25,
            center: 0.25,
            ucl: 0.7,
            lcl: 0,
            outOfControl: false,
            lowN: false,
          },
        ],
      },
      portPChart: {
        center: 0.4,
        minN: 5,
        groups: [
          {
            key: "ميناء الاختبار",
            n: 10,
            x: 4,
            p: 0.4,
            center: 0.4,
            ucl: 0.8,
            lcl: 0,
            outOfControl: false,
            lowN: false,
          },
        ],
      },
    };
    const labels = getLabels();
    const { container } = render(
      <ReviewerKpiPanel model={model} resolveName={() => "المراجع الأول"} />,
    );

    expect(container.querySelector(".rk-native-chart")).toBeInTheDocument();
    expect(container.querySelector(".rk-chart")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: labels.rk_pchart_reviewer_title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: labels.rk_pchart_reviewer_title }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: labels.rk_toggle_port }),
    );

    expect(
      screen.getByRole("heading", { name: labels.rk_pchart_port_title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: labels.rk_pchart_port_title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "ميناء الاختبار" }),
    ).toBeInTheDocument();
  });
});
