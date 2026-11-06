import { describe, expect, it } from "vitest";
import { fitIssue, fitTableHeaders, fitText } from "./fitLadder";
import { createFixedAdvanceMeasurer, FIT_SAFETY } from "./measure";

const m = createFixedAdvanceMeasurer(); // Arabic letter = 0.5 x size, so at 25px bold one letter is 13.25px
const box = (w: number) => ({ w, basePx: 25, weight: 700 as const, maxLines: 2 as const });
const word = (n: number) => "س".repeat(n);

describe("measurer", () => {
  it("fixed advance is deterministic and bold is 1.06x", () => {
    expect(m.width("س", 25, 700)).toBeCloseTo(13.25);
    expect(m.width("A 1", 20, 400)).toBeCloseTo(20 * (0.55 + 0.25 + 0.55));
    expect(FIT_SAFETY).toBe(1.04);
  });
});

describe("fitText", () => {
  it("step 1 at base size when it fits", () => { expect(fitText(word(10), box(400), m)).toMatchObject({ step: 1, sizePx: 25, lines: [word(10)] }); });
  it("step 2 never below max(20, 0.85 x base)", () => {
    const r = fitText(word(30), box(400), m); // 30 x 13.25 x 1.04 = 413.4 > 400, fits after a small shrink
    expect(r.step).toBe(2); expect(r.sizePx).toBeGreaterThanOrEqual(21.25); expect(r.sizePx).toBeLessThan(25);
  });
  it("step 2 floor is 20px for small bases", () => {
    const r = fitText(word(30), { w: 300, basePx: 22, weight: 700, maxLines: 1 }, m);
    expect(r.step).toBe(5);
  });
  it("step 3 widens up to widenTo", () => {
    const r = fitText(word(40), box(400), m, 600); expect(r.step).toBe(3); expect(r.widthPx).toBeGreaterThan(400); expect(r.widthPx).toBeLessThanOrEqual(600);
  });
  it("step 4 gives two balanced lines split at a space", () => {
    const r = fitText(`${word(20)} ${word(20)}`, box(400), m); expect(r.step).toBe(4); expect(r.lines).toEqual([word(20), word(20)]);
  });
  it("step 4 picks the split minimising the longer line", () => {
    expect(fitText(`${word(5)} ${word(18)} ${word(20)}`, box(400), m).lines).toEqual([`${word(5)} ${word(18)}`, word(20)]);
  });
  it("step 5 keeps the full text", () => { const t = word(200); const r = fitText(t, box(400), m); expect(r.step).toBe(5); expect(r.lines.join(" ")).toBe(t); });
  it("maxLines 1 never splits", () => { expect(fitText(`${word(20)} ${word(20)}`, { ...box(400), maxLines: 1 }, m).step).toBe(5); });
  it("FIT_SAFETY applies: text measuring w / 1.03 does not fit at step 1", () => {
    const w = m.width(word(10), 25, 700) * 1.03; expect(fitText(word(10), box(w), m).step).not.toBe(1);
  });
  it("fitIssue gives a located fit.tooLong on step 5 only", () => {
    expect(fitIssue(fitText(word(200), box(400), m), { page: 2, visual: "t1" })).toEqual({ rule: "fit.tooLong", page: 2, visual: "t1" });
    expect(fitIssue(fitText(word(5), box(400), m), { page: 2 })).toBeNull();
  });
});

describe("fitTableHeaders", () => {
  it("fitTableHeaders keeps sum(colW) constant and never goes below minW", () => {
    const r = fitTableHeaders([word(40), "س", "س"], [300, 300, 300], [100, 120, 120], 25, m);
    expect(r.colW.reduce((a, b) => a + b)).toBe(900); r.colW.forEach((w, i) => expect(w).toBeGreaterThanOrEqual([100, 120, 120][i]));
    expect(r.colW[0]).toBeGreaterThan(300);
    expect(r.fits[0].step).toBe(3); expect(r.fits[0].widthPx).toBe(r.colW[0]);
  });
  it("a header too long for all slack is step 5 and leaves widths alone", () => {
    const r = fitTableHeaders([word(200), "س"], [300, 300], [100, 280], 25, m);
    expect(r.fits[0].step).toBe(5); expect(r.colW).toEqual([300, 300]);
  });
});
