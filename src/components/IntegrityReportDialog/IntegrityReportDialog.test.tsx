/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../data/labels/labelsStore";
import type { BootIntegrityReport } from "../../data/integrity/bootIntegrityScan";
import { IntegrityReportDialog } from "./IntegrityReportDialog";

function makeReport(overrides: Partial<BootIntegrityReport> = {}): BootIntegrityReport {
  const findings = overrides.findings ?? [];
  return {
    findings,
    hasFindings: findings.length > 0,
    repairedCount: findings.filter((f) => f.outcome === "repaired").length,
    needsAttentionCount: findings.filter((f) => f.outcome !== "repaired").length,
    ...overrides,
  };
}

describe("IntegrityReportDialog", () => {
  // globals: false in this repo, so RTL's auto-cleanup is not installed —
  // without this, one test's dialog is still mounted for the next one.
  afterEach(cleanup);

  // A healthy workspace must not greet an admin with a dialog on every sign-in.
  it("renders nothing when the scan found nothing", () => {
    const { container } = render(
      <IntegrityReportDialog report={makeReport()} onDismiss={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("separates what it repaired from what still needs the admin", () => {
    const report = makeReport({
      findings: [
        {
          location: "6-templates",
          subject: "tmpl-gone.json.bak",
          problem: "orphan-sibling",
          outcome: "repaired",
          detail: "archived as tmpl-gone.json.bak.orphaned-2026-09-09T12-00-00-000Z",
        },
        {
          location: "6-templates",
          subject: "tmpl-lost.json",
          problem: "damaged",
          outcome: "needs-attention",
          detail: "unrecoverable",
        },
      ],
    });

    render(<IntegrityReportDialog report={report} onDismiss={() => {}} />);

    expect(screen.getByText(DEFAULT_LABELS.integrity_boot_group_repaired)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.integrity_boot_group_attention)).toBeInTheDocument();
    expect(screen.getByText("tmpl-gone.json.bak")).toBeInTheDocument();
    expect(screen.getByText("tmpl-lost.json")).toBeInTheDocument();
    // Both caveats are load-bearing and must be on screen whenever a repair ran.
    expect(screen.getByText(DEFAULT_LABELS.integrity_boot_archive_note)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LABELS.integrity_boot_restore_note)).toBeInTheDocument();
  });

  it("does not claim anything was repaired when nothing was", () => {
    const report = makeReport({
      findings: [
        {
          location: "5-system",
          subject: "5-system",
          problem: "orphan-sibling",
          outcome: "could-not-check",
          detail: "share did not answer",
        },
      ],
    });

    render(<IntegrityReportDialog report={report} onDismiss={() => {}} />);

    expect(screen.queryByText(DEFAULT_LABELS.integrity_boot_group_repaired)).toBeNull();
    expect(screen.queryByText(DEFAULT_LABELS.integrity_boot_archive_note)).toBeNull();
    expect(screen.getByText(DEFAULT_LABELS.integrity_boot_outcome_checkfail, { exact: false }))
      .toBeInTheDocument();
  });

  it("is dismissible", () => {
    const onDismiss = vi.fn();
    const report = makeReport({
      findings: [
        {
          location: "6-templates",
          subject: "tmpl-1.json.bak",
          problem: "orphan-sibling",
          outcome: "repaired",
        },
      ],
    });

    render(<IntegrityReportDialog report={report} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.integrity_boot_dismiss }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
