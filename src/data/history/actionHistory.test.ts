import { beforeEach, describe, expect, it } from "vitest";

import {
  ACTION_HISTORY_RETENTION_COUNT,
  __resetActionHistoryBudgetReportsForTests,
  loadActionHistory,
  recordActionHistorySnapshot,
} from "./actionHistory";
import {
  clearOperationLog,
  createMemoryDirectory,
  getOperationLog,
} from "../storage/memoryDirectory";
import { listDirectoryEntries } from "../storage/directoryScan";
import { clearErrors } from "../storage/errorLogger";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";

type Template = { templateName: string };

async function templatesHistoryEntries(root: ReturnType<typeof createMemoryDirectory>) {
  const systemDir = await getSystemRoot(root, true);
  const historyDir = await systemDir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.history, {
    create: true,
  });
  const familyDir = await historyDir.getDirectoryHandle("templates", { create: true });
  return listDirectoryEntries(familyDir);
}

async function record(
  root: ReturnType<typeof createMemoryDirectory>,
  recordId: string,
  previousState: Template | null,
  action = "template-edit"
) {
  await recordActionHistorySnapshot<Template>({
    directoryHandle: root,
    family: "templates",
    recordId,
    actor: "admin",
    action,
    previousState,
  });
}

describe("template action history", () => {
  beforeEach(() => {
    clearErrors();
    __resetActionHistoryBudgetReportsForTests();
  });

  it("keeps snapshots newest-first and caps them at the retention count", async () => {
    const root = createMemoryDirectory("workspace");
    for (let index = 0; index < ACTION_HISTORY_RETENTION_COUNT + 2; index += 1) {
      await record(root, "tmpl-1", { templateName: `v${index}` });
    }

    const snapshots = await loadActionHistory<Template>(root, "templates", "tmpl-1");

    expect(snapshots).toHaveLength(ACTION_HISTORY_RETENTION_COUNT);
    expect(snapshots[0]!.state).toEqual({ templateName: "v11" });
    expect(snapshots.at(-1)!.state).toEqual({ templateName: "v2" });
  });

  // The layout tripwire. A per-record DIRECTORY is what pushed the path over
  // Windows' cap and made the whole feature fail on a deep workspace, so
  // "one FILE per record, no nesting" is the property to defend.
  it("never nests: one file per record and zero directories", async () => {
    const root = createMemoryDirectory("workspace");
    for (let index = 0; index < 12; index += 1) {
      await record(root, "tmpl-1", { templateName: `v${index}` });
    }
    await record(root, "tmpl-2", { templateName: "other" });

    const entries = await templatesHistoryEntries(root);

    expect(entries.filter((entry) => entry.kind === "directory")).toEqual([]);
    // Live names only — `.bak`/`.tmp` siblings are safeWriteJson's own
    // torn-write machinery, present beside every managed file in the app.
    const liveNames = entries
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    expect(liveNames).toEqual(["tmpl-1.json", "tmpl-2.json"]);
  });

  it("prunes by rewriting one file, never by listing and removing entries", async () => {
    const root = createMemoryDirectory("workspace", { trackOperations: true });
    await record(root, "tmpl-1", { templateName: "v0" });
    clearOperationLog(root);

    for (let index = 1; index < 12; index += 1) {
      await record(root, "tmpl-1", { templateName: `v${index}` });
    }

    // The old layout pruned with a directory listing plus a removeEntry per
    // dropped snapshot. An array slice removes no snapshot at all — the only
    // removals left are safeWriteJson clearing its own `.tmp` staging name.
    const removedSnapshots = getOperationLog(root)
      .filter((entry) => entry.operation === "removeEntry")
      .filter((entry) => entry.name.endsWith(".json"));
    expect(removedSnapshots).toEqual([]);
  });

  it("records a null previous state for a first-ever save", async () => {
    const root = createMemoryDirectory("workspace");
    await record(root, "tmpl-new", null, "template-create");

    const snapshots = await loadActionHistory<Template>(root, "templates", "tmpl-new");

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.state).toBeNull();
    expect(snapshots[0]!.action).toBe("template-create");
    expect(snapshots[0]!.actor).toBe("admin");
  });

  it("keeps separate records separate", async () => {
    const root = createMemoryDirectory("workspace");
    await record(root, "tmpl-a", { templateName: "a" });
    await record(root, "tmpl-b", { templateName: "b" });

    expect((await loadActionHistory<Template>(root, "templates", "tmpl-a"))[0]!.state)
      .toEqual({ templateName: "a" });
    expect((await loadActionHistory<Template>(root, "templates", "tmpl-b"))[0]!.state)
      .toEqual({ templateName: "b" });
  });

  it("returns an empty trail for a record with no history", async () => {
    const root = createMemoryDirectory("workspace");
    await expect(loadActionHistory(root, "templates", "never-saved")).resolves.toEqual([]);
  });

  it("never lets a failed history write break the save it documents", async () => {
    const root = createMemoryDirectory("workspace", {
      faults: [{ operation: "createWritable", times: Number.POSITIVE_INFINITY }],
    });

    await expect(record(root, "tmpl-1", { templateName: "v0" })).resolves.toBeUndefined();
  });
});
