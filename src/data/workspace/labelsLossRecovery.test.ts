import { describe, it, expect } from "vitest";
import { shouldOfferLabelRestore } from "./labelsSnapshot";

describe("shouldOfferLabelRestore", () => {
  it("offers a restore when local overrides are empty but a snapshot exists", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 12 })).toBe(true);
  });

  it("stays silent on a genuine first run with no snapshot", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 0 })).toBe(false);
  });

  it("stays silent when local overrides are intact", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 12, snapshotOverrideCount: 12 })).toBe(false);
  });

  it("does not treat a deliberate reset-to-defaults as a loss when the snapshot is also empty", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 0 })).toBe(false);
  });
});
