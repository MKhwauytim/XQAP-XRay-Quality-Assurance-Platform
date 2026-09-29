/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS, resetAllLabels, setLabel } from "../../../../../data/labels/labelsStore";
import type { PopulationOverwriteAssessment } from "../../../../../data/population/populationOverwriteGuard";
import { ReprocessConfirmDialog } from "./ReprocessConfirmDialog";

afterEach(() => {
  cleanup();
  resetAllLabels();
});

function assessment(overrides: Partial<PopulationOverwriteAssessment>): PopulationOverwriteAssessment {
  return {
    sampleExists: true,
    liveSampledIds: ["A1", "A2"],
    distributionCount: 2,
    answerCount: 1,
    missingCount: 0,
    missingExamples: [],
    certScanChangedCount: 0,
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

  it("renders nothing without an assessment, even when open", () => {
    const { container } = render(
      <ReprocessConfirmDialog open assessment={null} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("joins the example ids with the label-driven separator", () => {
    setLabel("population_reprocess_examples_separator", "/");
    render(
      <ReprocessConfirmDialog
        open
        assessment={assessment({ missingCount: 2, missingExamples: ["A1", "A2"], blocked: true })}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(
      screen.getByText(DEFAULT_LABELS.population_reprocess_missing_examples.replace("{ids}", "A1/A2"))
    ).toBeInTheDocument();
  });

  it("warns, without blocking, when sampled rows would change CertScan status (C2)", () => {
    const onConfirm = vi.fn();
    render(
      <ReprocessConfirmDialog open assessment={assessment({ certScanChangedCount: 3 })} onConfirm={onConfirm} onCancel={() => {}} />
    );
    expect(
      screen.getByText(DEFAULT_LABELS.population_reprocess_certscan_warning.replace("{count}", "3"))
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.confirm_dialog_default_ok }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows no CertScan warning when nothing sampled changes", () => {
    render(<ReprocessConfirmDialog open assessment={assessment({})} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/سيتغيّر وضع CertScan/)).toBeNull();
  });
});
