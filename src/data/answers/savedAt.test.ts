import { describe, expect, it } from "vitest";

import { compareSavedAt } from "./savedAt";

describe("compareSavedAt", () => {
  it("orders by instant, not by string", () => {
    expect(compareSavedAt("2026-09-28T10:00:01.000Z", "2026-09-28T10:00:00.000Z")).toBeGreaterThan(0);
    expect(compareSavedAt("2026-09-28T10:00:00.000Z", "2026-09-28T10:00:01.000Z")).toBeLessThan(0);
  });

  it("treats a legacy no-milliseconds stamp as equal to the same second with .000", () => {
    // String order would call "…:00Z" GREATER than "…:00.000Z" ('Z' > '.').
    expect(compareSavedAt("2026-09-28T10:00:00Z", "2026-09-28T10:00:00.000Z")).toBe(0);
  });

  it("orders a legacy stamp correctly against a later millisecond stamp", () => {
    expect(compareSavedAt("2026-09-28T10:00:00Z", "2026-09-28T10:00:00.500Z")).toBeLessThan(0);
  });

  it("falls back to string order when a value is unparseable", () => {
    expect(compareSavedAt("garbage-b", "garbage-a")).toBeGreaterThan(0);
    expect(compareSavedAt("garbage-a", "garbage-b")).toBeLessThan(0);
    expect(compareSavedAt("same", "same")).toBe(0);
  });
});
