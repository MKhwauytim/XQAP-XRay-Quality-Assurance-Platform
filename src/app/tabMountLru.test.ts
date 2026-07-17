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
