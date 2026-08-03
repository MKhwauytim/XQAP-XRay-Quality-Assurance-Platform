import { describe, it, expect } from "vitest";
import { touchVisitedTabs } from "./visitedTabs";

describe("touchVisitedTabs", () => {
  it("adds the active id to an empty set", () => {
    const result = touchVisitedTabs(new Set<string>(), "a");
    expect([...result]).toEqual(["a"]);
  });

  it("keeps every previously visited id, adding the new one", () => {
    const result = touchVisitedTabs(new Set(["a", "b"]), "c");
    expect([...result]).toEqual(["a", "b", "c"]);
  });

  it("returns the SAME reference when the id is already visited (no-op)", () => {
    const current = new Set(["a", "b"]);
    const result = touchVisitedTabs(current, "b");
    expect(result).toBe(current);
  });

  it("returns a NEW reference when actually adding", () => {
    const current = new Set(["a"]);
    const result = touchVisitedTabs(current, "b");
    expect(result).not.toBe(current);
  });
});
