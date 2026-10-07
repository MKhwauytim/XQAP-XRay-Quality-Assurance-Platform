import { describe, expect, it } from "vitest";
import { createPopulationFold } from "./populationSummary";
import { applyPopulationSummary } from "../reporting/executive/model/populationSummaryKpis";
import type { ExecutiveKPIs } from "../reporting/executiveReportTypes";

const row = (over: Record<string, string>): Record<string, string> => ({
  "معرف الأشعة": "X1",
  "المستوى": "THIRD_STAGE",
  "اسم المنفذ": "البطحاء",
  "نوع المنفذ": "منفذ بري",
  "نتيجة المستوى الأول": "سليمة",
  "نتيجة المستوى الثاني": "سليمة",
  ...over,
});

describe("createPopulationFold", () => {
  it("counts clean / suspicious by the OR rule and keeps non-standard results as «other»", () => {
    const fold = createPopulationFold();
    fold.add(row({ "معرف الأشعة": "A" }), false);
    fold.add(row({ "معرف الأشعة": "B", "نتيجة المستوى الثاني": "اشتباه" }), false);
    fold.add(row({ "معرف الأشعة": "C", "نتيجة المستوى الأول": "11" }), false);
    fold.add(row({ "معرف الأشعة": "D", "نتيجة المستوى الأول": "سليمه" }), false); // spelling variant → clean
    const s = fold.finish([]);
    expect(s.total).toBe(4);
    expect(s.byStage["THIRD_STAGE"]).toEqual({ total: 4, clean: 2, suspicious: 1, other: 1 });
    expect(s.levelOne).toEqual({ clean: 3, suspicious: 0, other: 1 });
    expect(s.levelTwo).toEqual({ clean: 3, suspicious: 1, other: 0 });
    expect(s.otherValues.levelOne).toEqual({ "11": 1 });
    expect(s.byPort[0]).toMatchObject({ name: "البطحاء", portType: "منفذ بري", total: 4 });
  });

  it("an اشتباه in either level wins over an «other» in the other one", () => {
    const fold = createPopulationFold();
    fold.add(row({ "نتيجة المستوى الأول": "0", "نتيجة المستوى الثاني": "اشتباه" }), false);
    expect(fold.finish([]).byStage["THIRD_STAGE"]).toEqual({ total: 1, clean: 0, suspicious: 1, other: 0 });
  });

  it("maps January's numeric codes only when asked (1 → سليمة, 2 → اشتباه); other codes stay «other»", () => {
    const jan = createPopulationFold();
    jan.add(row({ "نتيجة المستوى الأول": "1", "نتيجة المستوى الثاني": "2" }), true);
    jan.add(row({ "معرف الأشعة": "B", "نتيجة المستوى الأول": "13", "نتيجة المستوى الثاني": "1" }), true);
    const s = jan.finish([]);
    expect(s.levelOne).toEqual({ clean: 1, suspicious: 0, other: 1 });
    expect(s.levelTwo).toEqual({ clean: 1, suspicious: 1, other: 0 });
    const other = createPopulationFold();
    other.add(row({ "نتيجة المستوى الأول": "1" }), false);
    expect(other.finish([]).levelOne.other).toBe(1);
  });

  it("skips rows without an image id or a stage, and labels blanks «فارغ»", () => {
    const fold = createPopulationFold();
    fold.add(row({ "معرف الأشعة": "" }), false);
    fold.add(row({ "المستوى": "" }), false);
    fold.add(row({ "نتيجة المستوى الثاني": "" }), false);
    const s = fold.finish([]);
    expect(s.total).toBe(1);
    expect(s.otherValues.levelTwo).toEqual({ "فارغ": 1 });
  });
});

describe("applyPopulationSummary", () => {
  const kpis = {
    totalPopulation: 10, totalSample: 4, sampleCoverage: 40, suspiciousCount: 1, cleanCount: 9, suspicionRate: 10,
    stageProfiles: [{ stageKey: "third", stageLabel: "المستوى الثالث", population: 10, sampleSize: 4, coverage: 40, studied: 4, completionRate: 100 }],
    portProfiles: [{
      portName: "البطحاء", population: 10, clean: 9, suspicious: 1, suspicionRate: 10, sampleSize: 4, coverage: 40, studied: 4,
      completionRate: 100, accuracyByImage: 75, suspiciousDetectionRateByImage: null, missedSuspicionRateByImage: null, status: "stable",
    }],
  } as unknown as ExecutiveKPIs;

  it("overlays population totals and recomputes coverage, leaving sample-scoped figures alone", () => {
    const fold = createPopulationFold();
    for (let i = 0; i < 8; i++) fold.add(row({ "معرف الأشعة": `P${i}` }), false);
    fold.add(row({ "معرف الأشعة": "S1", "نتيجة المستوى الأول": "اشتباه" }), false);
    const out = applyPopulationSummary(kpis, fold.finish([]));
    expect(out.totalPopulation).toBe(9);
    expect(out.cleanCount).toBe(8);
    expect(out.suspiciousCount).toBe(1);
    expect(out.sampleCoverage).toBeCloseTo((4 / 9) * 100);
    expect(out.stageProfiles[0]).toMatchObject({ population: 9, sampleSize: 4, studied: 4 });
    expect(out.portProfiles[0]).toMatchObject({ portName: "البطحاء", population: 9, clean: 8, suspicious: 1, status: "stable", accuracyByImage: 75 });
  });

  it("adds ports and stages the sample never touched, with no sample figures", () => {
    const fold = createPopulationFold();
    fold.add(row({ "معرف الأشعة": "Z", "المستوى": "FORTH_STAGE", "اسم المنفذ": "الوديعة" }), false);
    const out = applyPopulationSummary(kpis, fold.finish([]));
    expect(out.portProfiles.find((p) => p.portName === "الوديعة")).toMatchObject({ population: 1, sampleSize: 0, status: "insufficient" });
    expect(out.stageProfiles.map((s) => s.stageKey)).toEqual(["third", "fourth"]);
  });
});
