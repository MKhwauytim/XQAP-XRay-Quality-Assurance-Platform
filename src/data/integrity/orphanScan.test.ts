import { describe, expect, test } from "vitest";

import { scanReferentialIntegrity } from "./orphanScan";

describe("scanReferentialIntegrity (B3)", () => {
  test("flags answers/approvals ids absent from the current distribution", () => {
    const result = scanReferentialIntegrity({
      populationIds: ["p1", "p2", "p3"],
      sampleIds: ["p1", "p2"],
      distributionIds: ["p1"], // p2 was sampled but not (yet) distributed
      answersIds: ["p1", "p2"], // p2 has an answer but no distribution entry → orphan
      approvalsIds: ["p9"], // p9 referenced by a request but not distributed → orphan
    });
    expect(result.answersOrphans).toEqual(["p2"]);
    expect(result.approvalsOrphans).toEqual(["p9"]);
    expect(result.sampleOrphans).toEqual([]); // p1,p2 both in population
    expect(result.clean).toBe(false);
  });

  test("flags sample rows absent from the population", () => {
    const result = scanReferentialIntegrity({
      populationIds: ["p1"],
      sampleIds: ["p1", "ghost"],
      distributionIds: ["p1"],
      answersIds: [],
      approvalsIds: [],
    });
    expect(result.sampleOrphans).toEqual(["ghost"]);
  });

  test("clean when every id is anchored", () => {
    const result = scanReferentialIntegrity({
      populationIds: ["p1", "p2"],
      sampleIds: ["p1"],
      distributionIds: ["p1"],
      answersIds: ["p1"],
      approvalsIds: ["p1"],
    });
    expect(result.clean).toBe(true);
    expect(result.answersOrphans).toEqual([]);
    expect(result.approvalsOrphans).toEqual([]);
    expect(result.sampleOrphans).toEqual([]);
  });

  test("orphan lists are deduped and sorted", () => {
    const result = scanReferentialIntegrity({
      populationIds: [],
      sampleIds: [],
      distributionIds: [],
      answersIds: ["b", "a", "b", "a"],
      approvalsIds: [],
    });
    expect(result.answersOrphans).toEqual(["a", "b"]);
  });
});
