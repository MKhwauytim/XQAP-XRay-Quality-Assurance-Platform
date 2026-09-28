/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../../../../data/labels/labelsStore";
import type { PopulationOverwriteAssessment } from "../../../../../data/population/populationOverwriteGuard";
import { ReprocessConfirmDialog } from "./ReprocessConfirmDialog";

afterEach(cleanup);

function assessment(overrides: Partial<PopulationOverwriteAssessment>): PopulationOverwriteAssessment {
  return {
    sampleExists: true,
    liveSampledIds: ["A1", "A2"],
    distributionCount: 2,
    answerCount: 1,
    missingCount: 0,
    missingExamples: [],
    blocked: false,
    ...overrides,
  };
}

describe("ReprocessConfirmDialog", () => {
  it("shows the answer, distribution and missing counts and lets the user continue", () => {
    const onConfirm = vi.fn();
    render(<ReprocessConfirmDialog open assessment={assessment({})} onConfirm={onConfirm} onCancel={() => {}} />);

    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_confirm_title)).toBeInTheDocument();
    expect(
      screen.getByText(
        DEFAULT_LABELS.population_reprocess_impact_counts
          .replace("{answers}", "1")
          .replace("{distribution}", "2")
          .replace("{missing}", "0")
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("explains a blocked save, lists example ids, and offers no way to continue", () => {
    const onCancel = vi.fn();
    render(
      <ReprocessConfirmDialog
        open
        assessment={assessment({ missingCount: 2, missingExamples: ["A1", "A2"], blocked: true })}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_blocked_title)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.population_reprocess_blocked_message)).toBeInTheDocument();
    expect(
      screen.getByText(DEFAULT_LABELS.population_reprocess_missing_examples.replace("{ids}", "A1، A2"))
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.population_reprocess_blocked_close }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without an assessment", () => {
    const { container } = render(
      <ReprocessConfirmDialog open={false} assessment={null} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container.textContent).toBe("");
  });
});
