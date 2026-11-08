import { describe, expect, it } from "vitest";
import { createWorkloadAggregator, dayOf, isWorkloadSheet, orderWorkloadSheets } from "./workloadAggregate";

describe("workloadAggregate", () => {
  it("recognises and orders the population sheets", () => {
    expect(["2024", "2025-Q1", "Q4B", "نتائج الدراسة"].filter(isWorkloadSheet)).toEqual(["2024", "2025-Q1", "Q4B"]);
    expect(orderWorkloadSheets(["Q4B", "2025-Q2", "2024", "2025-Q1"], (s) => s)).toEqual(["2024", "2025-Q1", "2025-Q2", "Q4B"]);
  });

  it("reads Excel serial days and ISO dates", () => {
    expect(dayOf(45658)).toBe("2025-01-01");
    expect(dayOf("2026-03-14 10:00")).toBe("2026-03-14");
    expect(dayOf("#N/A")).toBe("");
  });

  it("counts images, coded images and employees per port and month, once per image id", () => {
    const agg = createWorkloadAggregator();
    agg.startSheet("2025-Q1");
    agg.row({ A: "ملخص" }); // a summary row before the header is skipped
    agg.row({ A: "رقم صورة الاشعة", B: "تاريخ دخول الاشعة", C: "اسم المنفذ", D: "نوع المنفذ", E: "موظف المستوى الاول", F: "نتيجة المستوى الأول" });
    agg.row({ A: "1", B: 45658, C: "ميناء أ", D: "منفذ بحري", E: "E1", F: "اشتباه" });
    agg.row({ A: "2", B: 45659, C: "ميناء أ", D: "منفذ بحري", E: "X-RAY", F: "سليمة" });
    agg.startSheet("Q4B");
    agg.row({ A: "رقم صورة الاشعة", B: "تاريخ دخول الاشعة", C: "اسم المنفذ", D: "نوع المنفذ", E: "كود موظف المستوى الأول" });
    agg.row({ A: "1", B: 45658, C: "ميناء أ", D: "منفذ بحري", E: "E1" }); // already seen
    const { months, sheets } = agg.result();
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ port: "ميناء أ", month: "2025-01", images: 2, coded: 1, suspicion: 1, l1: { E1: 1 } });
    expect(months[0].days).toEqual(["2025-01-01", "2025-01-02"]);
    expect(sheets.map((s) => [s.name, s.rows, s.duplicates])).toEqual([["2025-Q1", 2, 0], ["Q4B", 0, 1]]);
  });
});
