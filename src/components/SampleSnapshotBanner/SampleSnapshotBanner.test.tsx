/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DEFAULT_LABELS } from "../../data/labels/labelsStore";
import { SampleSnapshotBanner } from "./SampleSnapshotBanner";

afterEach(cleanup);

describe("SampleSnapshotBanner", () => {
  it("renders nothing for a zero count", () => {
    const { container } = render(<SampleSnapshotBanner count={0} />);
    expect(container.textContent).toBe("");
  });

  it("names the count in an alert", () => {
    render(<SampleSnapshotBanner count={12} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      DEFAULT_LABELS.report_sample_snapshot_banner.replace("{count}", "12")
    );
  });

  it("uses its own wording for the Report Designer, whose tiles include the snapshot rows", () => {
    render(<SampleSnapshotBanner count={3} variant="designer" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      DEFAULT_LABELS.report_designer_sample_snapshot_banner.replace("{count}", "3")
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("ولا تدخل في مقامات المجتمع");
  });
});
