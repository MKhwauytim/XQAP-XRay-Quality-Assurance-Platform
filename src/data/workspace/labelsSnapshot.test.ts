import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import {
  getCustomLabelOverrides,
  getLabels,
  resetAllLabels,
  setLabel,
} from "../labels/labelsStore";
import { getUserDataRoot } from "./workspacePaths";
import { exportLabelsSnapshot, importLabelsSnapshot } from "./labelsSnapshot";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as DirectoryHandleLike;
}

describe("labelsSnapshot", () => {
  afterEach(() => {
    resetAllLabels();
  });

  it("exports and re-imports custom label overrides round-trip", async () => {
    const root = makeRoot();
    setLabel("sidebar_title", "لوحة مخصصة");
    setLabel("kpi_sample", "عينة اليوم");

    await exportLabelsSnapshot(root);

    // Simulate a fresh session (e.g. after a restore on another machine):
    // clear the in-memory overrides, then import from the snapshot.
    resetAllLabels();
    expect(getLabels().sidebar_title).not.toBe("لوحة مخصصة");

    const applied = await importLabelsSnapshot(root);
    expect(applied).toBe(2);
    expect(getLabels().sidebar_title).toBe("لوحة مخصصة");
    expect(getLabels().kpi_sample).toBe("عينة اليوم");
  });

  it("importLabelsSnapshot returns 0 when no snapshot exists", async () => {
    const root = makeRoot();
    const applied = await importLabelsSnapshot(root);
    expect(applied).toBe(0);
  });

  it("skips keys the current build no longer knows instead of storing them forever", async () => {
    // A snapshot written by an older build carries keys since renamed or
    // deleted. Storing them puts entries in `xray_custom_labels_v1` that the
    // Settings UI cannot see (it iterates DEFAULT_LABELS), so they can never be
    // reset individually — and `exportLabelsSnapshot` writes them straight back
    // to the workspace, making the pollution self-perpetuating.
    const root = makeRoot();
    const userDataDir = await getUserDataRoot(root, true);
    await safeWriteJson(userDataDir, "labels.snapshot.json", {
      overrides: {
        sidebar_title: "لوحة مخصصة",
        legacy_key_removed_in_v40: "قيمة قديمة",
        "<script>alert(1)</script>": "junk",
      },
      savedAt: new Date().toISOString(),
    });

    const applied = await importLabelsSnapshot(root);

    expect(applied).toBe(1);
    expect(Object.keys(getCustomLabelOverrides())).toEqual(["sidebar_title"]);
    expect(getLabels().sidebar_title).toBe("لوحة مخصصة");
  });

  it("exportLabelsSnapshot never throws even against a broken handle", async () => {
    const throwingDir = {
      kind: "directory",
      name: "broken",
      getFileHandle: async () => { throw new Error("disk gone"); },
      getDirectoryHandle: async () => { throw new Error("disk gone"); },
    } as unknown as DirectoryHandleLike;

    await expect(exportLabelsSnapshot(throwingDir)).resolves.toBeUndefined();
  });
});
