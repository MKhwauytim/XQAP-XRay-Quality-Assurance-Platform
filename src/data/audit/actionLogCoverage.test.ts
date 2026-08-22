// The action log now covers the whole app, not just governance actions, so the
// property that matters here is an exhaustiveness one: EVERY member of the
// widened `WorkspaceActionType` union has to survive a write/read cycle
// unchanged. Cheap to assert once, impossible to keep true by hand.
//
// The matching viewer-side exhaustiveness checks (every type has a label and
// lands in exactly one filter group) live in
// `UserManagement/actionCatalog.test.ts` — the lazy-tab boundary rule forbids
// importing that module from `src/data`.
//
// The on-behalf case gets its own test because it is the only entry that names
// two people, and the whole point of recording it is that neither name is
// derivable from the other.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  ALL_ACTION_TYPES,
  HIGH_VOLUME_ACTION_TYPES,
  appendWorkspaceAction,
  readWorkspaceActions,
  recordAction,
} from "./actionLog";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("action-log coverage", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("round-trips every action type with its target, month and details intact", async () => {
    const root = makeRoot();

    for (const action of ALL_ACTION_TYPES) {
      await appendWorkspaceAction(root, {
        actor: "admin",
        actorRole: "admin",
        action,
        monthFolderName: "5-may-2026",
        target: `target-${action}`,
        details: { note: `note-${action}`, count: 3, flag: true },
      });
    }

    const entries = await readWorkspaceActions(root);
    expect(entries).toHaveLength(ALL_ACTION_TYPES.length);

    for (const action of ALL_ACTION_TYPES) {
      const entry = entries.find((e) => e.action === action);
      expect(entry, `no entry read back for ${action}`).toBeDefined();
      expect(entry!.target).toBe(`target-${action}`);
      expect(entry!.monthFolderName).toBe("5-may-2026");
      expect(entry!.details).toEqual({ note: `note-${action}`, count: 3, flag: true });
      expect(entry!.actor).toBe("admin");
    }
  });

  it("only nominates real action types as high-volume", () => {
    for (const action of HIGH_VOLUME_ACTION_TYPES) {
      expect(ALL_ACTION_TYPES).toContain(action);
    }
    // The accountability record must stay visible by default — it is rare, and
    // hiding it would defeat the reason it is recorded at all.
    expect(HIGH_VOLUME_ACTION_TYPES).not.toContain("answer-submitted-on-behalf");
  });

  it("records BOTH the assignee and the real author on an on-behalf answer", async () => {
    const root = makeRoot();

    await appendWorkspaceAction(root, {
      actor: "sup-1",
      actorRole: "supervisor",
      action: "answer-submitted-on-behalf",
      monthFolderName: "5-may-2026",
      target: "IMG-THEIRS",
      details: { assignee: "emp-a", templateId: "tpl-1" },
    });

    const [entry] = await readWorkspaceActions(root);
    expect(entry).toBeDefined();
    // The actor IS the author — that is what "who did this" means — and the
    // assignee is carried separately because `answeredBy` in the answer file is
    // pinned to the assignee and so cannot express authorship (answerTypes.ts).
    expect(entry!.actor).toBe("sup-1");
    expect(entry!.details?.assignee).toBe("emp-a");
    expect(entry!.target).toBe("IMG-THEIRS");
  });

  it("writes nothing, and reports nothing, when there is no workspace to write to", async () => {
    recordAction(null, "sup-1", "supervisor", "answer-submitted", { target: "IMG-1" });
    await appendWorkspaceAction(null, {
      actor: "sup-1",
      actorRole: "supervisor",
      action: "answer-submitted",
    });
    // A user working without a connected workspace is not an error condition,
    // and filling the ring buffer with one entry per answer would drown the
    // failures that ARE errors.
    expect(getRecentErrors()).toHaveLength(0);
  });

  it("keeps its never-throw contract when the actor cannot be turned into a file name", async () => {
    const root = makeRoot();

    // `recordAction` is called as `void recordAction(...)` from every call site,
    // so a synchronous throw here surfaces as an unhandled rejection in the
    // middle of a user's save rather than as a logged failure. The bad actor is
    // not hypothetical: a component whose session mock omits `username` passes
    // `undefined` straight through.
    await expect(
      appendWorkspaceAction(root, {
        actor: undefined as unknown as string,
        actorRole: "supervisor",
        action: "answer-submitted",
      })
    ).resolves.toBeUndefined();

    expect(await readWorkspaceActions(root)).toHaveLength(0);
    expect(getRecentErrors().length).toBeGreaterThan(0);
  });
});
