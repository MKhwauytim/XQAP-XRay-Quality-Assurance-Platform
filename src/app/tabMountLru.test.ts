import { describe, expect, it } from "vitest";

import { touchTabMountLru } from "./tabMountLru";

const allowed = new Set(["population", "reports", "archive", "settings"]);

describe("touchTabMountLru", () => {
  it("adds the active tab as the most recent entry", () => {
    expect(touchTabMountLru(["population"], "reports", allowed)).toEqual([
      "population",
      "reports",
    ]);
  });

  it("moves a revisited tab to the most recent position", () => {
    expect(
      touchTabMountLru(
        ["population", "reports", "archive"],
        "population",
        allowed,
      ),
    ).toEqual(["reports", "archive", "population"]);
  });

  it("keeps at most three mounted tabs", () => {
    expect(
      touchTabMountLru(
        ["population", "reports", "archive"],
        "settings",
        allowed,
      ),
    ).toEqual(["reports", "archive", "settings"]);
  });

  it("drops tabs that are no longer allowed", () => {
    expect(
      touchTabMountLru(
        ["population", "reports", "archive"],
        "reports",
        new Set(["reports", "settings"]),
      ),
    ).toEqual(["reports"]);
  });

  it("returns no mounts when there is no valid active tab", () => {
    expect(touchTabMountLru(["population"], "", allowed)).toEqual([]);
    expect(touchTabMountLru(["population"], "hidden", allowed)).toEqual([]);
  });
});

describe("touchTabMountLru — pinning a tab that holds unsaved work", () => {
  const allowed = new Set(["a", "b", "c", "d", "e"]);

  it("keeps a pinned tab that recency would have evicted", () => {
    // Without pinning, visiting three other tabs unmounts "a" — and with it an
    // InspectionPanel's typed answers, silently and with no dialog. That is the
    // one destruction path none of the app's confirm guards can see coming.
    const evicted = touchTabMountLru(["a", "b", "c"], "d", allowed);
    expect(evicted).not.toContain("a");

    const pinned = touchTabMountLru(["a", "b", "c"], "d", allowed, 3, new Set(["a"]));
    expect(pinned).toContain("a");
    expect(pinned).toContain("d");
  });

  it("keeps the active tab newest-last even when a pin is re-admitted", () => {
    const result = touchTabMountLru(["a", "b", "c"], "d", allowed, 3, new Set(["a"]));
    expect(result[result.length - 1]).toBe("d");
  });

  it("does not exempt a pinned tab from the access filter", () => {
    // Pinning outranks recency, never permission: a tab the user may no longer
    // open must be unmounted whatever it holds.
    const result = touchTabMountLru(["a", "b", "c"], "d", new Set(["b", "c", "d"]), 3, new Set(["a"]));
    expect(result).not.toContain("a");
  });

  it("is unchanged when nothing is pinned", () => {
    const withEmpty = touchTabMountLru(["a", "b", "c"], "d", allowed, 3, new Set());
    const without = touchTabMountLru(["a", "b", "c"], "d", allowed, 3);
    expect(withEmpty).toEqual(without);
  });

  it("does not duplicate a pinned tab that survived on recency anyway", () => {
    const result = touchTabMountLru(["a", "b"], "c", allowed, 3, new Set(["a"]));
    expect(result.filter((id) => id === "a")).toHaveLength(1);
  });
});
