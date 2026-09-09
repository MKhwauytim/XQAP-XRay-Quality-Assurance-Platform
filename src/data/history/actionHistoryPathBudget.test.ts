import { beforeEach, describe, expect, it } from "vitest";

import {
  HISTORY_MAX_RELATIVE_PATH_CHARS,
  __resetActionHistoryBudgetReportsForTests,
  __resetActionHistoryUnwritableScopesForTests,
  historyRelativePath,
  recordActionHistorySnapshot,
  type ActionHistoryFamily,
} from "./actionHistory";
import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
} from "../storage/memoryDirectory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";

const FAMILIES: ActionHistoryFamily[] = ["templates", "answers", "distribution"];

describe("action-history path budget (XQ-IO-037)", () => {
  beforeEach(() => {
    clearErrors();
    __resetActionHistoryBudgetReportsForTests();
    __resetActionHistoryUnwritableScopesForTests();
  });

  it("skips an over-budget path WITHOUT touching the share at all", async () => {
    const root = createMemoryDirectory("workspace", { trackOperations: true });
    clearOperationLog(root);

    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "answers",
      // The production shape: a month, a username, and an xrayImageId.
      scopeParts: ["9-September-2026", "hihaloraini", "10B2526081300153"],
      actor: "hihaloraini",
      action: "answer-save",
      previousState: { some: "state" },
    });

    // The whole point: no retry ladder, no cause probes, and no `create: true`
    // directory minted on the way to a write that could never succeed.
    expect(getOperationLog(root)).toEqual([]);
  });

  it("reports the skip once per family per session, not twice per save", async () => {
    const root = createMemoryDirectory("workspace");
    const scopeParts = ["9-September-2026", "hihaloraini", "10B2526081300153"];

    for (let index = 0; index < 5; index += 1) {
      await recordActionHistorySnapshot({
        directoryHandle: root,
        family: "answers",
        // A different record every time — the trailing part is a per-record id,
        // which is exactly why the v134.4 prefix cache could not help.
        scopeParts: [...scopeParts.slice(0, -1), `10B252608130015${index}`],
        actor: "hihaloraini",
        action: "answer-save",
        previousState: null,
      });
    }

    const rows = getRecentErrors().filter((entry) => entry.errorCode === "XQ-IO-037");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.context).toBe("actionHistory:path-budget [XQ-IO-037]");
    // The row has to name the path and its length, or an admin cannot act on it.
    expect(rows[0]!.message).toContain("5-system/history/answers");
    expect(rows[0]!.message).toContain(String(HISTORY_MAX_RELATIVE_PATH_CHARS));
  });

  it("still writes a snapshot whose path fits", async () => {
    const root = createMemoryDirectory("workspace", { trackOperations: true });

    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      scopeParts: ["tmpl-1"],
      actor: "admin",
      action: "template-save",
      previousState: { version: 1 },
    });

    expect(getRecentErrors().filter((e) => e.errorCode === "XQ-IO-037")).toHaveLength(0);
    const writes = getOperationLog(root).filter((entry) => entry.operation === "createWritable");
    expect(writes.length).toBeGreaterThan(0);
  });

  it("measures the same path the writer builds, for every family", () => {
    // A tripwire on the layout: adding a directory level, a longer leaf, or a
    // new family fails HERE, at `npm run test:run`, instead of on the share.
    for (const family of FAMILIES) {
      const path = historyRelativePath(family, ["tmpl-1787457917309-ngm1iq"], "x.json");
      expect(path.startsWith(`5-system/history/${family}/`)).toBe(true);
    }

    // The one whole-file-overwrite family must fit with room to spare, using
    // the longest template id the app mints plus the staging suffix.
    const templatePath = historyRelativePath(
      "templates",
      ["tmpl-1787457917309-ngm1iq"],
      "2026-09-09T09-03-07-106Z-000023.json"
    );
    expect(templatePath.length + ".tmp.crswap".length).toBeGreaterThan(
      HISTORY_MAX_RELATIVE_PATH_CHARS
    );
  });
});
