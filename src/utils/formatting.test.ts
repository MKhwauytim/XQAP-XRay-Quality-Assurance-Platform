import { describe, expect, it } from "vitest";

import { formatExportTimestamp } from "./formatting";

describe("formatExportTimestamp", () => {
  it("renders an ISO instant as sortable YYYY-MM-DD HH:mm:ss", () => {
    expect(formatExportTimestamp("2026-09-20T10:00:05.123Z")).toBe("2026-09-20 10:00:05");
  });
  it("renders a missing value as empty", () => {
    expect(formatExportTimestamp(undefined)).toBe("");
    expect(formatExportTimestamp("")).toBe("");
  });
});
