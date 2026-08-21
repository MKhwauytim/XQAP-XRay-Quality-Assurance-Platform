import { describe, expect, it } from "vitest";

import { planAdhocAssignment } from "./adhocAssignmentPlan";
import type { AdhocRow, AssignmentMode, AssignmentTarget } from "./adhocImportModel";

const IMPORT_ID = "imp-001";

function makeRow(index: number, overrides: Partial<AdhocRow> = {}): AdhocRow {
  return {
    rowKey: `ورقة1:${index}`,
    mapped: { xrayImageId: `IMG-${index}` },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
    ...overrides
  };
}

function makePool(count: number): AdhocRow[] {
  return Array.from({ length: count }, (_, i) => makeRow(i + 1));
}

function targetsFor(...usernames: string[]): AssignmentTarget[] {
  return usernames.map((username) => ({ username }));
}

const ALL_MODES: AssignmentMode[] = ["explicit", "count", "percentage", "fanout"];

describe("planAdhocAssignment — guards", () => {
  it("returns an error and an empty plan when no employee is selected, in every mode", () => {
    for (const mode of ALL_MODES) {
      const result = planAdhocAssignment({
        rows: makePool(4),
        mode,
        targets: [],
        explicitRowKeys: ["ورقة1:1"],
        importId: IMPORT_ID
      });
      expect(result.plan).toEqual([]);
      expect(result.leftover).toBe(4);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("لم يتم اختيار أي موظف"))).toBe(true);
    }
  });

  it("returns an error and an empty plan when the eligible pool is empty, in every mode", () => {
    for (const mode of ALL_MODES) {
      const result = planAdhocAssignment({
        rows: [],
        mode,
        targets: targetsFor("sara"),
        explicitRowKeys: ["ورقة1:1"],
        importId: IMPORT_ID
      });
      expect(result.plan).toEqual([]);
      expect(result.leftover).toBe(0);
      expect(result.errors.some((e) => e.includes("لا توجد صفوف مؤهلة"))).toBe(true);
    }
  });

  it("never plans ineligible rows (invalid, admin-excluded, already assigned)", () => {
    const rows: AdhocRow[] = [
      makeRow(1),
      makeRow(2, { validation: { valid: false, reason: "ناقص" } }),
      makeRow(3, { excludedByAdmin: true }),
      makeRow(4, {
        assignments: [
          { username: "old", replicaIndex: 0, xrayImageId: "ADHOC-x-IMG-4", assignedAt: "2026-08-01" }
        ]
      })
    ];

    for (const mode of ALL_MODES) {
      const result = planAdhocAssignment({
        rows,
        mode,
        targets: [{ username: "sara", count: 10, weight: 100 }],
        explicitRowKeys: rows.map((row) => row.rowKey),
        importId: IMPORT_ID
      });
      expect(result.plan.map((entry) => entry.rowKey)).toEqual(["ورقة1:1"]);
    }
  });

  it("de-duplicates repeated usernames, reports it, and does not double-assign under fan-out", () => {
    const result = planAdhocAssignment({
      rows: makePool(3),
      mode: "fanout",
      targets: targetsFor("sara", "sara", "omar"),
      importId: IMPORT_ID
    });

    expect(result.errors.some((e) => e.includes("تم تكرار الموظف"))).toBe(true);
    expect(result.plan).toHaveLength(6);
    expect(result.plan.filter((entry) => entry.username === "sara")).toHaveLength(3);
    expect(result.plan.filter((entry) => entry.username === "omar")).toHaveLength(3);
  });

  it("skips a pool row whose xrayImageId is missing rather than emitting a malformed id", () => {
    const rows = [makeRow(1), makeRow(2, { mapped: { xrayImageId: "  " } })];
    const result = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: targetsFor("sara"),
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]?.rowKey).toBe("ورقة1:1");
    expect(result.leftover).toBe(1);
    expect(result.errors.some((e) => e.includes("لا يوجد معرّف أشعة"))).toBe(true);
  });

  it("does not mutate the caller's rows array", () => {
    const rows = makePool(12);
    const snapshot = JSON.parse(JSON.stringify(rows)) as AdhocRow[];
    const order = rows.map((row) => row.rowKey);

    planAdhocAssignment({ rows, mode: "fanout", targets: targetsFor("sara", "omar"), importId: IMPORT_ID });

    expect(rows.map((row) => row.rowKey)).toEqual(order);
    expect(rows).toEqual(snapshot);
  });
});

describe("planAdhocAssignment — explicit mode", () => {
  it("assigns the ticked rows to the single target, in the caller's order", () => {
    const rows = makePool(5);
    const result = planAdhocAssignment({
      rows,
      mode: "explicit",
      targets: targetsFor("sara"),
      explicitRowKeys: ["ورقة1:4", "ورقة1:1", "ورقة1:3"],
      importId: IMPORT_ID
    });

    expect(result.errors).toEqual([]);
    expect(result.plan.map((entry) => entry.rowKey)).toEqual(["ورقة1:4", "ورقة1:1", "ورقة1:3"]);
    expect(result.plan.every((entry) => entry.username === "sara")).toBe(true);
    expect(result.plan.every((entry) => entry.replicaIndex === 0)).toBe(true);
    expect(result.plan[0]?.xrayImageId).toBe(`ADHOC-${IMPORT_ID}-IMG-4`);
    expect(result.leftover).toBe(2);
  });

  it("silently skips unknown or ineligible row keys but still counts them as leftover", () => {
    const rows = [makeRow(1), makeRow(2, { excludedByAdmin: true }), makeRow(3)];
    const result = planAdhocAssignment({
      rows,
      mode: "explicit",
      targets: targetsFor("sara"),
      explicitRowKeys: ["ورقة1:2", "ورقة1:99", "ورقة1:1", "ورقة1:1"],
      importId: IMPORT_ID
    });

    expect(result.plan.map((entry) => entry.rowKey)).toEqual(["ورقة1:1"]);
    // Eligible pool is rows 1 and 3; only row 1 was placed.
    expect(result.leftover).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("rejects zero or multiple targets and a missing row selection", () => {
    const rows = makePool(3);

    const twoTargets = planAdhocAssignment({
      rows,
      mode: "explicit",
      targets: targetsFor("sara", "omar"),
      explicitRowKeys: ["ورقة1:1"],
      importId: IMPORT_ID
    });
    expect(twoTargets.plan).toEqual([]);
    expect(twoTargets.errors.some((e) => e.includes("موظف واحد فقط"))).toBe(true);
    expect(twoTargets.leftover).toBe(3);

    const noRows = planAdhocAssignment({
      rows,
      mode: "explicit",
      targets: targetsFor("sara"),
      importId: IMPORT_ID
    });
    expect(noRows.plan).toEqual([]);
    expect(noRows.errors.some((e) => e.includes("صف واحد على الأقل"))).toBe(true);

    const emptyRowKeys = planAdhocAssignment({
      rows,
      mode: "explicit",
      targets: targetsFor("sara"),
      explicitRowKeys: [],
      importId: IMPORT_ID
    });
    expect(emptyRowKeys.errors.some((e) => e.includes("صف واحد على الأقل"))).toBe(true);
  });
});

describe("planAdhocAssignment — count mode", () => {
  it("hands out sequential, non-overlapping slices and reports the leftover", () => {
    const result = planAdhocAssignment({
      rows: makePool(10),
      mode: "count",
      targets: [
        { username: "sara", count: 3 },
        { username: "omar", count: 2 }
      ],
      importId: IMPORT_ID
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toHaveLength(5);
    expect(result.plan.filter((entry) => entry.username === "sara")).toHaveLength(3);
    expect(result.plan.filter((entry) => entry.username === "omar")).toHaveLength(2);
    expect(new Set(result.plan.map((entry) => entry.rowKey)).size).toBe(5);
    expect(result.plan.every((entry) => entry.replicaIndex === 0)).toBe(true);
    expect(result.leftover).toBe(5);
  });

  it("never pads or reuses a row when the pool runs short, and names requested vs placed", () => {
    const result = planAdhocAssignment({
      rows: makePool(4),
      mode: "count",
      targets: [
        { username: "sara", count: 3 },
        { username: "omar", count: 5 }
      ],
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(4);
    expect(result.plan.filter((entry) => entry.username === "omar")).toHaveLength(1);
    expect(new Set(result.plan.map((entry) => entry.rowKey)).size).toBe(4);
    expect(result.leftover).toBe(0);
    expect(result.errors.some((e) => e.includes("omar") && e.includes("5") && e.includes("1"))).toBe(true);
  });

  it("gives a single employee exactly the requested count", () => {
    const result = planAdhocAssignment({
      rows: makePool(9),
      mode: "count",
      targets: [{ username: "sara", count: 4 }],
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(4);
    expect(result.leftover).toBe(5);
    expect(result.errors).toEqual([]);
  });

  it("errors when every count is zero or absent", () => {
    const zeros = planAdhocAssignment({
      rows: makePool(5),
      mode: "count",
      targets: [
        { username: "sara", count: 0 },
        { username: "omar" }
      ],
      importId: IMPORT_ID
    });

    expect(zeros.plan).toEqual([]);
    expect(zeros.leftover).toBe(5);
    expect(zeros.errors.some((e) => e.includes("لم يتم تحديد عدد صفوف"))).toBe(true);
  });
});

describe("planAdhocAssignment — percentage mode", () => {
  it("treats weights as relative (they need not sum to 100) and places the whole pool", () => {
    const result = planAdhocAssignment({
      rows: makePool(10),
      mode: "percentage",
      targets: [
        { username: "sara", weight: 3 },
        { username: "omar", weight: 1 }
      ],
      importId: IMPORT_ID
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toHaveLength(10);
    // 3:1 over 10 rows is 7.5 / 2.5; Hamilton's remainders tie, and the tie-break
    // is alphabetical by username, so the spare row goes to "omar".
    expect(result.plan.filter((entry) => entry.username === "sara")).toHaveLength(7);
    expect(result.plan.filter((entry) => entry.username === "omar")).toHaveLength(3);
    expect(result.leftover).toBe(0);
  });

  it("splits equally when no weights are given", () => {
    const result = planAdhocAssignment({
      rows: makePool(9),
      mode: "percentage",
      targets: targetsFor("sara", "omar", "hind"),
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(9);
    for (const username of ["sara", "omar", "hind"]) {
      expect(result.plan.filter((entry) => entry.username === username)).toHaveLength(3);
    }
    expect(result.leftover).toBe(0);
  });

  it("gives a target with no weight a fair share alongside explicit weights", () => {
    const result = planAdhocAssignment({
      rows: makePool(10),
      mode: "percentage",
      targets: [{ username: "sara", weight: 50 }, { username: "omar" }],
      importId: IMPORT_ID
    });

    expect(result.plan.filter((entry) => entry.username === "omar")).toHaveLength(5);
    expect(result.leftover).toBe(0);
  });

  it("errors and plans nothing when every weight is zero", () => {
    const result = planAdhocAssignment({
      rows: makePool(6),
      mode: "percentage",
      targets: [
        { username: "sara", weight: 0 },
        { username: "omar", weight: 0 }
      ],
      importId: IMPORT_ID
    });

    expect(result.plan).toEqual([]);
    expect(result.leftover).toBe(6);
    expect(result.errors.some((e) => e.includes("جميع النسب تساوي صفرًا"))).toBe(true);
  });

  it("gives a single employee the entire pool", () => {
    const result = planAdhocAssignment({
      rows: makePool(7),
      mode: "percentage",
      targets: [{ username: "sara", weight: 42 }],
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(7);
    expect(result.leftover).toBe(0);
  });
});

describe("planAdhocAssignment — fan-out mode", () => {
  it("gives every eligible row to every reviewer with a distinct replica id", () => {
    const result = planAdhocAssignment({
      rows: makePool(4),
      mode: "fanout",
      targets: targetsFor("sara", "omar", "hind"),
      importId: IMPORT_ID
    });

    expect(result.errors).toEqual([]);
    expect(result.plan).toHaveLength(12);
    expect(result.leftover).toBe(0);
    expect(new Set(result.plan.map((entry) => entry.xrayImageId)).size).toBe(12);

    const forFirstRow = result.plan.filter((entry) => entry.rowKey === "ورقة1:1");
    expect(forFirstRow.map((entry) => entry.replicaIndex)).toEqual([0, 1, 2]);
    expect(forFirstRow.map((entry) => entry.xrayImageId)).toEqual([
      `ADHOC-${IMPORT_ID}-IMG-1`,
      `ADHOC-${IMPORT_ID}-R1-IMG-1`,
      `ADHOC-${IMPORT_ID}-R2-IMG-1`
    ]);
  });

  it("behaves like a plain full assignment for a single reviewer", () => {
    const result = planAdhocAssignment({
      rows: makePool(5),
      mode: "fanout",
      targets: targetsFor("sara"),
      importId: IMPORT_ID
    });

    expect(result.plan).toHaveLength(5);
    expect(result.plan.every((entry) => entry.replicaIndex === 0)).toBe(true);
    expect(result.leftover).toBe(0);
  });
});

describe("planAdhocAssignment — determinism and id uniqueness", () => {
  it("produces an identical plan for the same seed and inputs", () => {
    const build = () =>
      planAdhocAssignment({
        rows: makePool(30),
        mode: "count",
        targets: [
          { username: "sara", count: 10 },
          { username: "omar", count: 10 }
        ],
        importId: IMPORT_ID,
        seed: "seed-A"
      });

    expect(build()).toEqual(build());
  });

  it("falls back to importId as the seed, deterministically", () => {
    const build = (importId: string) =>
      planAdhocAssignment({
        rows: makePool(30),
        mode: "percentage",
        targets: targetsFor("sara", "omar"),
        importId
      });

    expect(build(IMPORT_ID)).toEqual(build(IMPORT_ID));
    expect(build(IMPORT_ID)).not.toEqual(build("imp-002"));
  });

  it("changes which rows an employee gets when the seed changes", () => {
    const build = (seed: string) =>
      planAdhocAssignment({
        rows: makePool(40),
        mode: "count",
        targets: [{ username: "sara", count: 20 }],
        importId: IMPORT_ID,
        seed
      }).plan.map((entry) => entry.rowKey);

    expect(build("seed-A")).not.toEqual(build("seed-B"));
    expect(build("seed-A")).toEqual(build("seed-A"));
  });

  it("keeps every planned xrayImageId unique, dropping and reporting file-level duplicates", () => {
    const rows = [
      makeRow(1),
      makeRow(2, { rowKey: "ورقة1:2", mapped: { xrayImageId: "IMG-1" } })
    ];
    const result = planAdhocAssignment({
      rows,
      mode: "fanout",
      targets: targetsFor("sara", "omar"),
      importId: IMPORT_ID
    });

    expect(new Set(result.plan.map((entry) => entry.xrayImageId)).size).toBe(result.plan.length);
    expect(result.plan).toHaveLength(2);
    expect(result.leftover).toBe(1);
    expect(result.errors.some((e) => e.includes("مكرّرة"))).toBe(true);
  });
});
