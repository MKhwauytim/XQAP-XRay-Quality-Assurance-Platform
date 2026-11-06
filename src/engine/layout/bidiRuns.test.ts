import { describe, expect, it } from "vitest";
import { splitRuns } from "./bidiRuns";

describe("splitRuns", () => {
  it.each([
    ["نسبة 85.5% في جدة", [false, true, false]], ["الصفحة 20 / 37", [false, true]],
    ["التاريخ 05-11-2026", [false, true]], ["الموظف A6838", [false, true]],
  ])("splitRuns(%s)", (s, ltr) => {
    expect(splitRuns(s).map((r) => r.ltr)).toEqual(ltr);
    expect(splitRuns(s).map((r) => r.text).join("")).toBe(s);
  });
  it("parentheses stay in the Arabic run", () => { expect(splitRuns("(نسبة) 50%").map((r) => r.text)).toEqual(["(نسبة) ", "50%"]); });
  it("' / ' joins two tokens into one cluster", () => { expect(splitRuns("الصفحة 20 / 37")[1].text).toBe("20 / 37"); });
  it("&'()* are not part of a token (hyphen literal, C18)", () => {
    expect(splitRuns("A&B").map((r) => r.text)).toEqual(["A", "&", "B"]);
    expect(splitRuns("5*3").map((r) => r.text)).toEqual(["5", "*", "3"]);
  });
  it("empty text gives no runs", () => { expect(splitRuns("")).toEqual([]); });
});
