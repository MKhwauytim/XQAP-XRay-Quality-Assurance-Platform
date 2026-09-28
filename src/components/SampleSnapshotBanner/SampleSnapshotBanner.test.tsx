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
});
