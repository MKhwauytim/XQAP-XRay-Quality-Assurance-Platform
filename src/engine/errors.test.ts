import { describe, expect, it } from "vitest";
import { formatIssue } from "./messages";

describe("formatIssue", () => {
  it("names page, visual and rule in Arabic, without long dashes", () => {
    const s = formatIssue({ rule: "fit.tooLong", page: 2, visual: "v1" });
    expect(s).toContain("\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u0627\u062d\u0629");
    expect(s).toContain("v1");
    expect(s).toContain("الصفحة 2");
    expect(s).toContain("fit.tooLong");
    expect(s).not.toMatch(/[\u2013\u2014]/);
  });
  it("host override replaces a message", () => {
    expect(formatIssue({ rule: "fit.tooLong" }, { "fit.tooLong": "X" })).toContain("X");
  });
});
