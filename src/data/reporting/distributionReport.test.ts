// Data-correctness tests for the distribution report model (Wave 3). The three
// renderers (document / deck / xlsx) all read `computeDistributionModel`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { computeDistributionModel, buildDistributionDocument, buildDistributionDeck, buildDistributionXlsx } from "./distributionReport";
import { makeRow, makeDistribution } from "./reportTestFixtures";
import { yieldToMain } from "../storage/yieldToMain";
import type { DistributionStatus } from "../distribution/distributionTypes";

// The vendored xlsx module namespace is frozen (ESM), so `vi.spyOn` can't
// replace writeFile. Partial-mock the module: keep the real `utils` (the
// export builds a real workbook) but stub `writeFile` so no download is
// attempted in the test environment and the built workbook can be inspected.
// Same idiom as DataTable/index.test.tsx.
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

// Wrap the real `yieldToMain` in a spy (keep its actual setTimeout-based
// behavior) so tests below can assert the chunked XLSX export actually
// yields the main thread for a population above EXPORT_CHUNK_SIZE.
vi.mock("../storage/yieldToMain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/yieldToMain")>();
  return { ...actual, yieldToMain: vi.fn(actual.yieldToMain) };
});

function data() {
  return makeDistribution([
    { id: "IMG-1", assignedTo: "u1", status: "completed", row: makeRow("IMG-1", "منفذ أ") },
    { id: "IMG-2", assignedTo: "u1", status: "pending", row: makeRow("IMG-2", "منفذ أ") },
    { id: "IMG-3", assignedTo: "u2", status: "replacement-requested", row: makeRow("IMG-3", "منفذ ب") },
    { id: "IMG-4", assignedTo: "u2", status: "replaced", row: makeRow("IMG-4", "منفذ ب"), replacedById: "IMG-9" },
  ], {
    totalAssigned: 4, totalCompleted: 1, totalPending: 1, totalReplaced: 1,
    quotas: { u1: { username: "u1", sampleCount: 2, dailyQuota: 5, daysRemainingAtAssignment: 10, assignedAt: "2026-07-01T00:00:00.000Z" } },
  });
}

describe("computeDistributionModel", () => {
  it("aggregates per-employee status counts and daily quota", () => {
    const m = computeDistributionModel(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(m.employees.map((e) => e.username)).toEqual(["u1", "u2"]); // sorted by total desc (tie → insertion)
    const u1 = m.employees.find((e) => e.username === "u1")!;
    expect(u1.displayName).toBe("أحمد");
    expect(u1.total).toBe(2);
    expect(u1.completed).toBe(1);
    expect(u1.pending).toBe(1);
    expect(u1.dailyQuota).toBe(5);
    expect(u1.completionRate).toBeCloseTo(50, 5);
    const u2 = m.employees.find((e) => e.username === "u2")!;
    expect(u2.requested).toBe(1);
    expect(u2.replaced).toBe(1);
    expect(u2.dailyQuota).toBeNull(); // no quota entry
  });

  it("counts replacement-requested into totalRequested and surfaces highlights", () => {
    const m = computeDistributionModel(data(), "6-June-2026");
    expect(m.totalRequested).toBe(1);
    expect(m.completionRate).toBeCloseTo(25, 5); // 1 completed / 4 assigned
    expect(m.highlights.map((h) => h.xrayImageId).sort()).toEqual(["IMG-3", "IMG-4"]);
    const replaced = m.highlights.find((h) => h.xrayImageId === "IMG-4")!;
    expect(replaced.replacedById).toBe("IMG-9");
  });

  it("returns null completion rate when nothing is assigned", () => {
    const m = computeDistributionModel(makeDistribution([], { totalAssigned: 0 }), "6-June-2026");
    expect(m.completionRate).toBeNull();
    expect(m.employees).toEqual([]);
  });
});

describe("distribution renderers", () => {
  it("document uses display names and is a self-contained HTML doc", async () => {
    const html = await buildDistributionDocument(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("أحمد");
    expect(html).toContain("تقرير التوزيع");
  });

  it("deck renders slides with the completion figure", async () => {
    const html = await buildDistributionDeck(data(), "6-June-2026");
    expect(html).toContain("class=\"slide");
    expect(html).toContain("يونيو 2026");
  });
});

// ─── Golden snapshot (P3-7) ────────────────────────────────────────────────────
// Byte-identical proof that adding `await yieldToMain()` breaks inside these
// builders (main-thread chunking, P3-7) changed ONLY timing, never output.
// If either snapshot ever needs updating for a real content change, that
// change must be deliberate and reviewed on its own — never used to paper
// over an unintended regression introduced by a chunking edit.
describe("distribution renderers — golden snapshot (P3-7 chunking safety)", () => {
  // formatIssueDate() defaults to `new Date()` (today's real date), so this
  // byte-identity pin is only reproducible if the clock is frozen to the
  // instant the snapshot was actually captured — otherwise it silently
  // breaks on every day rollover. Frozen at UTC noon so local-timezone date
  // rollover doesn't shift the captured calendar day either.
  beforeEach(() => {
    // toFake: ["Date"] only — these builders themselves `await yieldToMain()`
    // (a real `setTimeout`) as part of P3-7's chunking; faking `setTimeout`
    // too would hang those awaits forever without an explicit timer advance.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("document output is byte-identical", async () => {
    expect(await buildDistributionDocument(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" })).toMatchSnapshot();
  });

  it("deck output is byte-identical", async () => {
    expect(await buildDistributionDeck(data(), "6-June-2026", { u1: "أحمد", u2: "سارة" })).toMatchSnapshot();
  });
});

// ─── buildDistributionXlsx chunked yielding (Task 2, P3-7 follow-up) ──────────
// Proves the "التعيينات" (Sheet 2) row loop actually yields the main thread
// for a population above EXPORT_CHUNK_SIZE, and that chunking the row-array
// build didn't drop or duplicate any rows across a chunk boundary.
describe("buildDistributionXlsx — chunked yielding", () => {
  function bigData(n: number) {
    const entries: Array<{ id: string; assignedTo: string; status: DistributionStatus; row: ReturnType<typeof makeRow> }> = [];
    for (let i = 1; i <= n; i++) {
      entries.push({
        id: `IMG-${i}`,
        assignedTo: i % 2 === 0 ? "u1" : "u2",
        status: "pending",
        row: makeRow(`IMG-${i}`, "منفذ أ"),
      });
    }
    return makeDistribution(entries, { totalAssigned: n, totalPending: n });
  }

  beforeEach(() => {
    vi.mocked(XLSX.writeFile).mockClear();
    vi.mocked(yieldToMain).mockClear();
  });

  it("yields the main thread at least once for a population above EXPORT_CHUNK_SIZE", async () => {
    await buildDistributionXlsx(bigData(1500), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(vi.mocked(yieldToMain).mock.calls.length).toBeGreaterThan(0);
    expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledTimes(1);
  });

  it("does not yield for a population at or below EXPORT_CHUNK_SIZE", async () => {
    await buildDistributionXlsx(bigData(1000), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    expect(vi.mocked(yieldToMain).mock.calls.length).toBe(0);
  });

  it("chunked row-build output has no drops/duplicates across the chunk boundary", async () => {
    const n = 2500; // spans 3 chunks of EXPORT_CHUNK_SIZE (1000)
    await buildDistributionXlsx(bigData(n), "6-June-2026", { u1: "أحمد", u2: "سارة" });
    const wb = vi.mocked(XLSX.writeFile).mock.calls[0]![0] as XLSX.WorkBook;
    const sheet = wb.Sheets["التعيينات"]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(rows.length).toBe(n + 1); // header + n data rows, no drops/dupes
    expect(rows[1]![0]).toBe("IMG-1");
    expect(rows[1000]![0]).toBe("IMG-1000"); // last row of chunk 1
    expect(rows[1001]![0]).toBe("IMG-1001"); // first row of chunk 2
    expect(rows[n]![0]).toBe(`IMG-${n}`); // last row overall
    const ids = rows.slice(1).map((r) => (r as unknown[])[0]);
    expect(new Set(ids).size).toBe(n); // no duplicate xrayImageId
  });
});
