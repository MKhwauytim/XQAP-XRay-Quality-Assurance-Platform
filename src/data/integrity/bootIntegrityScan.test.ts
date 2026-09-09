import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { listDirectoryEntries } from "../storage/directoryScan";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { __resetBakRecoveryReportsForTests } from "../storage/bakRecoveryReport";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import { runBootIntegrityScan } from "./bootIntegrityScan";

const NOW = "2026-09-09T12:00:00.000Z";

function makeTemplate(templateId: string, templateName: string) {
  return {
    templateId,
    templateName,
    version: 1,
    createdAt: NOW,
    createdBy: "admin",
    updatedAt: NOW,
    updatedBy: "admin",
    phases: [],
    fields: [],
  };
}

async function templateNames(root: ReturnType<typeof createMemoryDirectory>) {
  const dir = await getTemplatesRoot(root, true);
  return (await listDirectoryEntries(dir))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name);
}

describe("admin boot integrity scan", () => {
  beforeEach(() => {
    clearErrors();
    __resetBakRecoveryReportsForTests();
  });

  it("reports nothing for a healthy workspace", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-ok.json", makeTemplate("tmpl-ok", "fine"));

    const report = await runBootIntegrityScan(root, { now: NOW });

    expect(report.hasFindings).toBe(false);
    expect(report.findings).toEqual([]);
  });

  // The exact production condition: a deleted template whose `.bak` survived
  // and answered every read for eighteen hours.
  it("archives an orphaned .bak so it stops answering reads", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-gone.json", makeTemplate("tmpl-gone", "v1"));
    await safeWriteJson(dir, "tmpl-gone.json", makeTemplate("tmpl-gone", "v2"));
    // Reproduce the pre-v135.0 delete: live name only.
    await dir.removeEntry?.("tmpl-gone.json");
    expect(await templateNames(root)).toContain("tmpl-gone.json.bak");

    const report = await runBootIntegrityScan(root, { now: NOW });

    const finding = report.findings.find((item) => item.subject === "tmpl-gone.json.bak");
    expect(finding?.problem).toBe("orphan-sibling");
    expect(finding?.outcome).toBe("repaired");
    expect(report.repairedCount).toBe(1);

    // Archived, never deleted — the bytes are still on the share.
    const names = await templateNames(root);
    expect(names).not.toContain("tmpl-gone.json.bak");
    expect(names.some((name) => name.startsWith("tmpl-gone.json.bak.orphaned-"))).toBe(true);

    // And the orphan no longer answers for the deleted record.
    __resetBakRecoveryReportsForTests();
    clearErrors();
    await expect(safeReadJson(dir, "tmpl-gone.json")).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
    expect(getRecentErrors().filter((e) => e.context === "storage:bak-recovery")).toHaveLength(0);
  });

  it("repairs a damaged live template from its snapshot and says which one", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-torn.json", makeTemplate("tmpl-torn", "v1"));
    await safeWriteJson(dir, "tmpl-torn.json", makeTemplate("tmpl-torn", "v2"));
    // Tear the live file: present, unparseable.
    const handle = await dir.getFileHandle("tmpl-torn.json");
    const writable = await handle.createWritable?.();
    await writable?.write("{ truncated");
    await writable?.close();

    const report = await runBootIntegrityScan(root, { now: NOW });

    const finding = report.findings.find((item) => item.subject === "tmpl-torn.json");
    expect(finding?.problem).toBe("damaged");
    expect(finding?.outcome).toBe("repaired");
    // The admin must be told it came from a snapshot -- the most recent edit
    // may not be in it.
    expect(finding?.detail).toContain("restored from .");
    expect(finding?.detail).toContain("archived as");

    const restored = await safeReadJson<{ templateId: string }>(dir, "tmpl-torn.json");
    expect(restored.ok).toBe(true);
  });

  it("reports a damaged file it cannot repair instead of counting it fixed", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-lost.json", makeTemplate("tmpl-lost", "v1"));
    // Damage the live file with NO usable sibling to restore from.
    for (const name of ["tmpl-lost.json", "tmpl-lost.json.bak"]) {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable?.();
      await writable?.write("{ truncated");
      await writable?.close();
    }

    const report = await runBootIntegrityScan(root, { now: NOW });

    const finding = report.findings.find((item) => item.subject === "tmpl-lost.json");
    expect(finding?.outcome).toBe("needs-attention");
    expect(report.repairedCount).toBe(0);
    expect(report.needsAttentionCount).toBeGreaterThan(0);
  });

  // A self-check that throws must never be able to keep an admin out.
  it("never throws, even when the share stops answering", async () => {
    const root = createMemoryDirectory("workspace", {
      faults: [{ operation: "getDirectoryHandle", times: Number.POSITIVE_INFINITY }],
    });

    await expect(runBootIntegrityScan(root, { now: NOW })).resolves.toBeDefined();
  });
});
