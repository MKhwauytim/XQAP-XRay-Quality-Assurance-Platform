// classifyReplacementRowAvailability — the shared freshness verdict behind
// approveReplacement's step-3b guard and XrayReferrals' immediate-replace
// re-check. The distinction under test is the XQ-DIST-005 crash state: a
// partial replacement (sample row appended + dead id retired in one CAS
// write, events never landed) must classify as "resume-partial" so a retry
// with the SAME candidate can complete, while every other occupied state
// stays "taken". Both call sites used to collapse all of these into "taken",
// which made a partial replacement permanently unrecoverable.
import { describe, expect, it } from "vitest";

import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "./distributionTypes";
import { classifyReplacementRowAvailability } from "./replacement";

function row(id: string): PreparedPopulationRow {
  return { xrayImageId: id } as PreparedPopulationRow;
}

function entry(id: string): DistributionEntry {
  return { xrayImageId: id } as DistributionEntry;
}

describe("classifyReplacementRowAvailability", () => {
  it("a spare row (not sampled, not owned) is free", () => {
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("A2")] },
        entries: [entry("A1"), entry("A2")],
      })
    ).toBe("free");
  });

  it("the XQ-DIST-005 partial write — in sample, unowned, dead row retired — is resume-partial", () => {
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("A2"), row("C1")], replacedRowIds: ["A1"] },
        entries: [entry("A1"), entry("A2")],
      })
    ).toBe("resume-partial");
  });

  it("a row owned by a distribution entry is taken even when the dead row is retired", () => {
    // The full replacement already applied (possibly for ANOTHER request) —
    // resuming here would silently transfer ownership.
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("A2"), row("C1")], replacedRowIds: ["A1"] },
        entries: [entry("A1"), entry("A2"), entry("C1")],
      })
    ).toBe("taken");
  });

  it("an unowned in-sample row stays taken when the dead row was never retired", () => {
    // Normal in a partially-distributed month: the row is drawn, just not
    // handed out yet. Re-drawing it as a replacement double-counts it.
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "A3",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("A2"), row("A3")] },
        entries: [entry("A1"), entry("A2")],
      })
    ).toBe("taken");
  });

  it("a retired-list naming OTHER dead rows does not unlock the resume", () => {
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("A2"), row("C1")], replacedRowIds: ["A2"] },
        entries: [entry("A1"), entry("A2")],
      })
    ).toBe("taken");
  });

  it("tolerates a missing entries list (cache not derivable) without opening the guard", () => {
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1"), row("C1")] },
        entries: null,
      })
    ).toBe("taken");
    expect(
      classifyReplacementRowAvailability({
        replacementXrayImageId: "C1",
        deadXrayImageId: "A1",
        sample: { rows: [row("A1")] },
        entries: undefined,
      })
    ).toBe("free");
  });
});
