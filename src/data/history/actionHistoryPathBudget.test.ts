import { beforeEach, describe, expect, it } from "vitest";

import {
  HISTORY_MAX_RELATIVE_PATH_CHARS,
  __resetActionHistoryBudgetReportsForTests,
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
const STAGING = ".tmp.crswap".length;

describe("action-history path budget (XQ-IO-037)", () => {
  beforeEach(() => {
    clearErrors();
    __resetActionHistoryBudgetReportsForTests();
  });

  // The tripwire on the layout. Adding a directory level, a longer leaf, or a
  // new family fails HERE, at `npm run test:run`, instead of silently on a
  // customer's share the way the old per-record-directory layout did.
  it("keeps every family's real-world path inside the budget", () => {
    // `tmpl-{13 digits}-{6 chars}` is the shape createTemplateId actually
    // mints, and 40 chars is generous headroom above it. Both must fit for
    // every family — a directory level added to this tree breaks this first.
    for (const family of FAMILIES) {
      for (const id of ["tmpl-1787457917309-ngm1iq", "z".repeat(40)]) {
        const path = historyRelativePath(family, id);
        expect(path.startsWith(`5-system/history/${family}/`)).toBe(true);
        expect(path.length + STAGING).toBeLessThanOrEqual(HISTORY_MAX_RELATIVE_PATH_CHARS);
      }
    }
  });

  // sanitizeRecordId truncates at 120 characters, which is longer than the
  // budget allows. That is not a hole: the guard below catches it in memory.
  // Asserted explicitly so nobody "fixes" the truncation to fit and silently
  // introduces id collisions between two long, distinct records.
  it("does not pretend an absurdly long id fits", () => {
    expect(
      historyRelativePath("templates", "x".repeat(120)).length + STAGING
    ).toBeGreaterThan(HISTORY_MAX_RELATIVE_PATH_CHARS);
  });

  it("writes a real template snapshot, well inside the budget", async () => {
    const root = createMemoryDirectory("workspace", { trackOperations: true });

    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "templates",
      recordId: "tmpl-1787457917309-ngm1iq",
      actor: "admin",
      action: "template-edit",
      previousState: { version: 1 },
    });

    expect(getRecentErrors().filter((e) => e.errorCode === "XQ-IO-037")).toHaveLength(0);
    expect(
      getOperationLog(root).filter((entry) => entry.operation === "createWritable").length
    ).toBeGreaterThan(0);
  });

  // The budget is not decoration: if a future layout change did push a path
  // over it, the verdict must be reached in memory and cost nothing.
  it("skips an over-budget path WITHOUT touching the share, and says so once", async () => {
    const root = createMemoryDirectory("workspace", { trackOperations: true });
    // sanitizeRecordId caps at 120 chars, which with the current flat layout
    // is still inside the budget by design — so drive the guard directly with
    // a family whose own prefix is long enough to matter.
    const overBudget = "y".repeat(120);
    expect(
      historyRelativePath("distribution", overBudget).length + STAGING
    ).toBeGreaterThan(HISTORY_MAX_RELATIVE_PATH_CHARS);

    clearOperationLog(root);
    await recordActionHistorySnapshot({
      directoryHandle: root,
      family: "distribution" as "templates",
      recordId: overBudget,
      actor: "admin",
      action: "distribution:reassigned",
      previousState: null,
    });

    // No retry ladder, no cause probes, no `create: true` directory minted on
    // the way to a write that could never succeed.
    expect(getOperationLog(root)).toEqual([]);

    const rows = getRecentErrors().filter((entry) => entry.errorCode === "XQ-IO-037");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.context).toBe("actionHistory:path-budget [XQ-IO-037]");
    expect(rows[0]!.message).toContain(String(HISTORY_MAX_RELATIVE_PATH_CHARS));
  });
});
