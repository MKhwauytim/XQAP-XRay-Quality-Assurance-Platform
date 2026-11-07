import { describe, expect, it } from "vitest";
import { lintText } from "../lint/designLint";
import { formatIssue } from "../messages";
import { NUMBERS_LOCK } from "./numbers.lock";
import { CATALOG, activeDesigns, getDesign } from "./registry";
import type { CatalogDesign } from "./types";

function design(over: Partial<CatalogDesign>): CatalogDesign {
  return {
    number: 1,
    nameAr: "تصميم تجريبي",
    descriptionAr: "وصف",
    deck3Source: "test",
    status: "active",
    slots: [],
    page: { grid: { cols: 24, rows: 14 }, visuals: [] },
    ...over,
  };
}

describe("catalog registry", () => {
  it("numbers are unique positive integers", () => {
    expect(new Set(CATALOG.map((d) => d.number)).size).toBe(CATALOG.length);
    for (const d of CATALOG) {
      expect(Number.isInteger(d.number)).toBe(true);
      expect(d.number).toBeGreaterThanOrEqual(1);
    }
  });

  it("lock is append-only and matches", () => {
    for (const [n, entry] of Object.entries(NUMBERS_LOCK)) {
      const d = CATALOG.find((x) => x.number === Number(n));
      expect(d, `design ${n}`).toBeDefined();
      expect(d?.nameAr).toBe(entry.nameAr);
      expect(d?.slots.map((s) => s.id).sort()).toEqual([...entry.slotIds].sort());
    }
    for (const d of CATALOG) expect(NUMBERS_LOCK[d.number], `lock for ${d.number}`).toBeDefined();
  });

  it("numbers 10 to 17 are reserved as planned, slots frozen in the lock", () => {
    for (let n = 10; n <= 17; n++) {
      const d = CATALOG.find((x) => x.number === n);
      expect(d?.status, `design ${n}`).toBe("planned");
      expect(d?.page.visuals).toEqual([]);
      expect(d?.deck3Source).not.toBe("");
      expect(NUMBERS_LOCK[n]?.slotIds.length, `lock for ${n}`).toBeGreaterThan(0);
      for (const s of d?.slots ?? []) expect(NUMBERS_LOCK[n].slotIds).toContain(s.id);
      const g = getDesign(n);
      expect(!g.ok && g.issue.rule).toBe("catalog.planned");
    }
  });

  it("unknown number refused", () => {
    const r = getDesign(999);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.rule).toBe("catalog.unknownNumber");
      expect(formatIssue(r.issue)).toContain("999");
    }
  });

  it("planned and retired refused", () => {
    const cat = [
      design({ number: 2, status: "planned" }),
      design({ number: 3, status: "retired", retiredReasonAr: "استبدل بتصميم أحدث" }),
      design({ number: 4 }),
    ];
    const p = getDesign(2, cat);
    expect(!p.ok && p.issue.rule).toBe("catalog.planned");
    const r = getDesign(3, cat);
    expect(!r.ok && r.issue.rule).toBe("catalog.retired");
    if (!r.ok) expect(formatIssue(r.issue)).toContain("استبدل بتصميم أحدث");
    const a = getDesign(4, cat);
    expect(a.ok).toBe(true);
    expect(activeDesigns(cat).map((d) => d.number)).toEqual([4]);
  });

  it("activeDesigns sorts by number", () => {
    const cat = [design({ number: 9 }), design({ number: 5 })];
    expect(activeDesigns(cat).map((d) => d.number)).toEqual([5, 9]);
  });

  it("names are human Arabic", () => {
    const bad = /خطوة\s*\d|[A-Za-z_]{3,}|\d/;
    for (const d of CATALOG) {
      for (const name of [d.nameAr, ...d.slots.map((s) => s.nameAr)]) {
        expect(name).not.toMatch(bad);
        expect(lintText(name)).toEqual([]);
      }
    }
  });
});
