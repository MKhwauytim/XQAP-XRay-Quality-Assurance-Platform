import { expect, test } from "vitest";

import { hamiltonApportionment } from "./apportionment";

test("total allocated equals totalSeats", () => {
  const groups = [
    { key: "A", size: 100 },
    { key: "B", size: 200 },
    { key: "C", size: 300 }
  ];
  const result = hamiltonApportionment(groups, 10);
  const total = result.reduce((s, r) => s + r.allocated, 0);
  expect(total).toBe(10);
});

test("proportional allocation is roughly correct", () => {
  const groups = [
    { key: "A", size: 1000 },
    { key: "B", size: 1000 }
  ];
  const result = hamiltonApportionment(groups, 10);
  expect(result.find((r) => r.key === "A")!.allocated).toBe(5);
  expect(result.find((r) => r.key === "B")!.allocated).toBe(5);
});

test("largest-remainder gives extra seat to highest fractional part", () => {
  // 3 groups, 2 seats: each group gets exact=0.667, floor=0, remainder=0.667
  // all equal, so first two alphabetically get the seats
  const groups = [
    { key: "A", size: 1 },
    { key: "B", size: 1 },
    { key: "C", size: 1 }
  ];
  const result = hamiltonApportionment(groups, 2);
  const total = result.reduce((s, r) => s + r.allocated, 0);
  expect(total).toBe(2);
  // Two of the three must have 1 seat
  const withOneSeat = result.filter((r) => r.allocated === 1);
  expect(withOneSeat).toHaveLength(2);
});

test("returns zeros when totalSeats is zero", () => {
  const groups = [
    { key: "A", size: 100 },
    { key: "B", size: 200 }
  ];
  const result = hamiltonApportionment(groups, 0);
  expect(result.every((r) => r.allocated === 0)).toBe(true);
});

test("returns zeros when all sizes are zero", () => {
  const groups = [
    { key: "A", size: 0 },
    { key: "B", size: 0 }
  ];
  const result = hamiltonApportionment(groups, 10);
  expect(result.every((r) => r.allocated === 0)).toBe(true);
});

test("single group gets all seats", () => {
  const groups = [{ key: "A", size: 50 }];
  const result = hamiltonApportionment(groups, 10);
  expect(result[0]!.allocated).toBe(10);
});

test("large allocation — total stays exact", () => {
  const groups = [
    { key: "بري", size: 4521 },
    { key: "بحري", size: 2108 },
    { key: "افراد", size: 983 },
    { key: "عبور", size: 388 }
  ];
  const total = 300;
  const result = hamiltonApportionment(groups, total);
  const allocated = result.reduce((s, r) => s + r.allocated, 0);
  expect(allocated).toBe(total);
});
