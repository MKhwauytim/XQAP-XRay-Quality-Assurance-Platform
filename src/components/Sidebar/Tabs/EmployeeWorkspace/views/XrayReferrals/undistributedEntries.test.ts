import { describe, expect, it } from "vitest";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { SampleMasterData } from "../../../../../../data/sampling/sampleTypes";
import { resolvePanelAuthoring } from "./subComponents";
import { isUndistributedEntry, undistributedEntries } from "./undistributedEntries";

const sample = (ids: string[], replaced: string[] = []) =>
  ({ rows: ids.map((xrayImageId) => ({ xrayImageId, portName: "p" })), replacedRowIds: replaced }) as unknown as SampleMasterData;
const entry = (xrayImageId: string) =>
  ({ xrayImageId, assignedTo: "emp1", status: "pending", replacedById: null, lastEventAt: "" }) as unknown as DistributionEntry;

describe("undistributedEntries", () => {
  it("adds every live sample row no entry covers, with no assignee", () => {
    const extra = undistributedEntries(sample(["A", "B", "C", "R"], ["R"]), [entry("A")]);
    expect(extra.map((e) => e.xrayImageId)).toEqual(["B", "C"]);
    expect(extra.every(isUndistributedEntry)).toBe(true);
    expect(isUndistributedEntry(entry("A"))).toBe(false);
  });

  it("opens an undistributed row read-only, even for an admin who may answer on behalf", () => {
    const [row] = undistributedEntries(sample(["B"]), []);
    expect(resolvePanelAuthoring({
      entry: row, username: "admin", answersMap: new Map(), canSubmitAnswers: true, canAnswerOnBehalf: true,
    })).toEqual({ readonly: true, onBehalfOf: null, reason: "undistributed" });
  });
});
