import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { formatIssue } from "../messages";
import type { RawSheet } from "../data/types";
import { parsePicksSheet, parsePicksText } from "./picks";
import type { CatalogDesign } from "./types";

const mk = (number: number, status: CatalogDesign["status"] = "active"): CatalogDesign => ({
  number,
  nameAr: "تصميم تجريبي",
  descriptionAr: "وصف",
  deck3Source: "test",
  status,
  slots: [],
  page: { grid: { cols: 24, rows: 14 }, visuals: [] },
});
const cat = [1, 4, 5, 6, 10].map((n) => mk(n)).concat(mk(7, "planned"), mk(8, "planned"));

function issues(r: ReturnType<typeof parsePicksText>) {
  if (r.ok) throw new Error("expected failure");
  return r.issues;
}

describe("parsePicksText", () => {
  it("parses plain lists", () => {
    expect(parsePicksText("1, 4, 5, 6, 10", cat)).toEqual({ ok: true, numbers: [1, 4, 5, 6, 10] });
  });
  it("normalizes Arabic digits and separators, ignores blanks", () => {
    expect(parsePicksText("٤، ٥\n\n 6 ,", cat)).toEqual({ ok: true, numbers: [4, 5, 6] });
  });
  it("accepts comma, arabic comma, semicolon, whitespace and newline", () => {
    expect(parsePicksText("1;4 5\n6،10", cat)).toEqual({ ok: true, numbers: [1, 4, 5, 6, 10] });
  });
  it("reports a repeated number", () => {
    const i = issues(parsePicksText("4, 4, 5", cat));
    expect(i[0].rule).toBe("picks.repeated");
    expect(formatIssue(i[0])).toContain("4");
  });
  it("quotes a non-number token", () => {
    const i = issues(parsePicksText("4, ب", cat));
    expect(i[0].rule).toBe("picks.notNumber");
    expect(formatIssue(i[0])).toContain("ب");
  });
  it("rejects empty input", () => {
    expect(issues(parsePicksText("", cat))[0].rule).toBe("picks.empty");
    expect(issues(parsePicksText(" , ", cat))[0].rule).toBe("picks.empty");
  });
  it("reports every refused number at once", () => {
    const i = issues(parsePicksText("7, 8, 999", cat));
    expect(i.map((x) => x.rule)).toEqual(["catalog.planned", "catalog.planned", "catalog.unknownNumber"]);
  });
  it("refuses more than the slide limit", () => {
    const text = Array.from({ length: LIMITS.maxSlides + 1 }, (_, k) => k + 1).join(",");
    const i = issues(parsePicksText(text, cat)).find((x) => x.rule === "picks.tooMany");
    expect(i).toEqual({ rule: "picks.tooMany", detail: `${LIMITS.maxSlides + 1} > ${LIMITS.maxSlides}` });
  });
  it("shows the retired reason of a retired design", () => {
    const retired = { ...mk(9, "retired"), retiredReasonAr: "استبدل بتصميم أحدث" };
    const i = issues(parsePicksText("9", [...cat, retired]));
    expect(formatIssue(i[0])).toContain("استبدل بتصميم أحدث");
  });
});

describe("parsePicksSheet", () => {
  it("reads the first column", () => {
    const sheet: RawSheet = { sheetName: "ورقة", headers: ["رقم التصميم"], rows: [[1], [4], [null], ["5"]] };
    expect(parsePicksSheet(sheet, cat)).toEqual({ ok: true, numbers: [1, 4, 5] });
  });
});
