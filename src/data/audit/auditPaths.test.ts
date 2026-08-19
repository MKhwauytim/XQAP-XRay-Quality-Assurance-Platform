import { describe, expect, it } from "vitest";

import {
  ACTIONS_FILE_SUFFIX,
  ACTIVITY_FILE_SUFFIX,
  actionsArchiveFileName,
  actionsFileName,
  activityFileName,
  auditUserStem,
  isActionsArchiveFileName,
} from "./auditPaths";

describe("auditUserStem", () => {
  it("keeps names that sanitize alike in DIFFERENT files", () => {
    // `safeWorkspaceFilePart` maps every one of these to "a_b". Without the
    // raw-name hash they would share one file — the exact two-writers-one-file
    // bug the per-user layout exists to remove, silently reintroduced.
    const collidingNames = ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"];
    const stems = collidingNames.map(auditUserStem);
    expect(new Set(stems).size).toBe(collidingNames.length);
  });

  it("is stable for the same name", () => {
    expect(auditUserStem("sara")).toBe(auditUserStem("sara"));
  });

  it("produces a filesystem-safe stem", () => {
    expect(auditUserStem("a/b")).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe("audit file-name suffix arithmetic", () => {
  it("a per-year archive does NOT match the live-log suffix", () => {
    // This is what keeps the two listings in `audit/actions/` disjoint with no
    // second predicate: the year sits between `.actions` and `.json`. A
    // `.includes(".actions.json")` filter would silently fold every archived
    // entry back into the live log.
    const live = actionsFileName("sara");
    const archive = actionsArchiveFileName("sara", 2026);

    expect(live.endsWith(ACTIONS_FILE_SUFFIX)).toBe(true);
    expect(archive.endsWith(ACTIONS_FILE_SUFFIX)).toBe(false);
    expect(archive.endsWith(".actions.2026.json")).toBe(true);
    expect(isActionsArchiveFileName(archive, 2026)).toBe(true);
    expect(isActionsArchiveFileName(archive, 2025)).toBe(false);
    expect(isActionsArchiveFileName(live, 2026)).toBe(false);
  });

  it("activity and actions files never collide for the same user", () => {
    expect(activityFileName("sara").endsWith(ACTIVITY_FILE_SUFFIX)).toBe(true);
    expect(activityFileName("sara")).not.toBe(actionsFileName("sara"));
    expect(activityFileName("sara").endsWith(ACTIONS_FILE_SUFFIX)).toBe(false);
    expect(actionsFileName("sara").endsWith(ACTIVITY_FILE_SUFFIX)).toBe(false);
  });
});
