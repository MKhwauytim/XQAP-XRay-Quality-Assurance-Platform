import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatExportTimestamp } from "./formatting";

describe("formatExportTimestamp", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Riyadh";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("zone local: renders the viewer's local digits, zero-padded, across a day boundary", () => {
    expect(formatExportTimestamp("2026-09-20T10:00:05.123Z", { zone: "local" })).toBe("2026-09-20 13:00:05");
    expect(formatExportTimestamp("2026-01-01T22:30:00Z", { zone: "local" })).toBe("2026-01-02 01:30:00");
  });
  it("zone local: an unparseable value is empty", () => {
    expect(formatExportTimestamp("not a date", { zone: "local" })).toBe("");
  });
  it("zone utc is the default and ignores the machine timezone", () => {
    expect(formatExportTimestamp("2026-01-01T22:30:00Z", { zone: "utc" })).toBe("2026-01-01 22:30:00");
    expect(formatExportTimestamp("2026-01-01T22:30:00Z")).toBe("2026-01-01 22:30:00");
  });

  it("renders an ISO instant as sortable YYYY-MM-DD HH:mm:ss", () => {
    expect(formatExportTimestamp("2026-09-20T10:00:05.123Z")).toBe("2026-09-20 10:00:05");
  });
  it("renders a missing value as empty", () => {
    expect(formatExportTimestamp(undefined)).toBe("");
    expect(formatExportTimestamp("")).toBe("");
  });
});
