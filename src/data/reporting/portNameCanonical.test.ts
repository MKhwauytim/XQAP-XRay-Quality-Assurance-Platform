import { describe, expect, it } from "vitest";
import { buildPortNameMap, canonicalizePortNames } from "./portNameCanonical";

describe("port name canonicalization", () => {
  it("folds الوديعة / الوديعه / الودعيه / منفذ الوديعة onto one spelling", () => {
    const map = buildPortNameMap(["الوديعة", "الوديعه", "الودعيه", "منفذ الوديعة"]);
    expect(new Set(map.values())).toEqual(new Set(["الوديعة"]));
  });

  it("uses the most frequent spelling for ports without a curated alias", () => {
    const map = buildPortNameMap(["حالة عمار", "حالة عمار", "حاله عمار"]);
    expect(map.get("حاله عمار")).toBe("حالة عمار");
  });

  it("keeps genuinely different ports apart and leaves null alone", () => {
    const rows = [{ portName: "الوديعة" }, { portName: "الرقعي" }, { portName: null }];
    const out = canonicalizePortNames(rows);
    expect(out).toBe(rows);
    expect(out.map((r) => r.portName)).toEqual(["الوديعة", "الرقعي", null]);
  });

  it("rewrites variant rows without mutating the input", () => {
    const rows = [{ portName: "الودعيه", n: 1 }, { portName: "الوديعة", n: 2 }];
    const out = canonicalizePortNames(rows);
    expect(out.map((r) => r.portName)).toEqual(["الوديعة", "الوديعة"]);
    expect(rows[0].portName).toBe("الودعيه");
  });

  it("merges the real workbook variants and keeps distinct ports apart", () => {
    const counts: Array<[string, number]> = [
      ["البطحاء", 17289], ["ميناء جده الاسلامي", 16493], ["ميناء الملك عبدالعزيز", 4594], ["الحديثة", 3724],
      ["جديدة عرعر", 3496], ["الوديعة", 1772], ["الدره", 1647], ["الخفجي", 1433], ["حالة عمار", 1244],
      ["الربع الخالي", 1080], ["جسر الملك فهد", 1032], ["سلوى", 546], ["الرقعي", 462], ["الحديثه", 437],
      ["حاله عمار", 336], ["الوديعه", 325], ["ميناء الملك عبد الله", 278], ["محافظة الجبيل", 210],
      ["الرياض - الميناء الجاف", 51], ["جديده عرعر", 10], ["ميناء نيوم", 5], ["ميناء ينبع التجاري", 3],
    ];
    const map = buildPortNameMap(counts.flatMap(([name, n]) => Array<string>(n).fill(name)));
    expect(map.get("الحديثه")).toBe("الحديثة");
    expect(map.get("حاله عمار")).toBe("حالة عمار");
    expect(map.get("جديده عرعر")).toBe("جديدة عرعر");
    expect(map.get("الوديعه")).toBe("الوديعة");
    expect(map.get("ميناء الملك عبد الله")).toBe("ميناء الملك عبد الله");
    expect(new Set(map.values()).size).toBe(counts.length - 4);
  });

  it("merges a one-letter typo of a much more common port, never two comparable ports", () => {
    const common = Array<string>(100).fill("الحديثة");
    expect(buildPortNameMap([...common, "الحديئة"]).get("الحديئة")).toBe("الحديثة");
    expect(new Set(buildPortNameMap([...common, ...Array<string>(60).fill("الحديدة")]).values()).size).toBe(2);
  });
});
