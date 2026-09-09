import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { listDirectoryEntries } from "../storage/directoryScan";
import { __resetBakRecoveryReportsForTests } from "../storage/bakRecoveryReport";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import type { TemplateSchema } from "./templateTypes";
import {
  deleteTemplate,
  loadTemplate,
  loadTemplateIncludingDeleted,
  loadTemplateIndex,
  saveTemplate,
} from "./templateStorage";

function makeTemplate(
  templateId: string,
  templateName: string,
  version = 1
): TemplateSchema {
  return {
    templateId,
    templateName,
    version,
    createdAt: "2026-05-01T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: `2026-05-0${version}T00:00:00.000Z`,
    updatedBy: "admin",
    phases: [],
    fields: [],
  };
}

describe("templateStorage", () => {
  it("saves a template and keeps the index consistent", async () => {
    const root = createMemoryDirectory();
    const result = await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ"));

    expect(result.ok).toBe(true);
    await expect(loadTemplate(root, "tmpl-a")).resolves.toMatchObject({
      templateId: "tmpl-a",
    });
    // toMatchObject (not toEqual): the index now also carries CAS bookkeeping
    // (revision + _writeToken) alongside the entry rows.
    await expect(loadTemplateIndex(root)).resolves.toMatchObject({
      templates: [
        {
          templateId: "tmpl-a",
          templateName: "قالب أ",
          version: 1,
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("re-saving the same template id replaces the index entry instead of duplicating it", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ", 1));
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ المحدث", 2));

    const index = await loadTemplateIndex(root);
    expect(index.templates).toHaveLength(1);
    expect(index.templates[0]).toMatchObject({
      templateId: "tmpl-a",
      templateName: "قالب أ المحدث",
      version: 2,
    });
  });

  it("serializes concurrent template saves and preserves both index entries (cross-machine CAS)", async () => {
    const root = createMemoryDirectory();
    // Two authors on two PCs save different templates at the same instant. The
    // withResourceLock + casLoop index RMW must land BOTH index entries — neither
    // author's entry may be dropped by the other's stale write.
    await Promise.all([
      saveTemplate(root, makeTemplate("tmpl-a", "قالب أ")),
      saveTemplate(root, makeTemplate("tmpl-b", "قالب ب")),
    ]);

    const index = await loadTemplateIndex(root);
    expect(index.templates.map((item) => item.templateId).sort()).toEqual([
      "tmpl-a",
      "tmpl-b",
    ]);
    // Both writes participated in the CAS protocol → revision advanced past both.
    expect(index.revision).toBe(2);
  });

  it("serializes concurrent saves of the SAME template id via per-id CAS (no silent clobber)", async () => {
    const root = createMemoryDirectory();
    // Two admins on two PCs edit the same template at the same instant. The
    // per-id template-file CAS (revision + _writeToken) must let BOTH writes
    // participate so neither silently clobbers the other's read-modify-write.
    await Promise.all([
      saveTemplate(root, makeTemplate("tmpl-x", "name-a", 1)),
      saveTemplate(root, makeTemplate("tmpl-x", "name-b", 2)),
    ]);

    const doc = await loadTemplate(root, "tmpl-x");
    expect(doc).not.toBeNull();
    expect(doc?.revision).toBe(2); // both writes went through the CAS chain

    const index = await loadTemplateIndex(root);
    expect(index.templates).toHaveLength(1); // one entry, not duplicated
  });

  it("stamps a CAS revision and write token on the saved template file", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-c", "قالب ج"));
    const doc = await loadTemplate(root, "tmpl-c");
    expect(doc?.revision).toBe(1);
    expect(typeof doc?._writeToken).toBe("string");
  });

  it("creates a recoverable template backup before delete/tombstone", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ"));

    const result = await deleteTemplate(root, "tmpl-a");
    expect(result.ok).toBe(true);

    const templatesDir = await root.getDirectoryHandle("6-templates", {
      create: false,
    });
    const backup = await safeReadJson<TemplateSchema>(
      templatesDir,
      "tmpl-a.deleted.bak.json"
    );
    expect(backup.ok).toBe(true);
    if (backup.ok) {
      expect(backup.value.templateId).toBe("tmpl-a");
    }
    await expect(loadTemplateIndex(root)).resolves.toMatchObject({ templates: [] });
  });

  it("loadTemplateIncludingDeleted recovers a deleted template's schema from its tombstone", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ"));
    await deleteTemplate(root, "tmpl-a");

    // The live file is gone -- loadTemplate alone can't see it any more.
    await expect(loadTemplate(root, "tmpl-a")).resolves.toBeNull();

    // But the answer that was submitted against it can still be resolved.
    const recovered = await loadTemplateIncludingDeleted(root, "tmpl-a");
    expect(recovered?.templateId).toBe("tmpl-a");
    expect(recovered?.templateName).toBe("قالب أ");
  });

  it("loadTemplateIncludingDeleted returns null for a templateId that never existed", async () => {
    const root = createMemoryDirectory();
    await expect(loadTemplateIncludingDeleted(root, "tmpl-never-existed")).resolves.toBeNull();
  });

  it("loadTemplateIncludingDeleted prefers the live template over its own stale tombstone", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ", 1));
    await deleteTemplate(root, "tmpl-a");
    // Re-created under the SAME id with a new name -- the live file must win.
    await saveTemplate(root, makeTemplate("tmpl-a", "قالب أ المعاد إنشاؤه", 1));

    const recovered = await loadTemplateIncludingDeleted(root, "tmpl-a");
    expect(recovered?.templateName).toBe("قالب أ المعاد إنشاؤه");
  });
});

// The tombstone `deleteTemplate` writes is a TemplateSchema plus a deletion
// stamp; the stamp is not part of the schema type itself.
type TombstonedTemplate = TemplateSchema & { deletedAt?: string };

async function templateFileNames(root: ReturnType<typeof createMemoryDirectory>) {
  const dir = await getTemplatesRoot(root, true);
  return (await listDirectoryEntries(dir))
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.name);
}

describe("deleted templates do not linger as .bak orphans (2026-09-08/09 incident)", () => {
  it("deleteTemplate leaves no .bak/.tmp sibling behind", async () => {
    const root = createMemoryDirectory("workspace");
    const schema = makeTemplate("tmpl-orphan", "orphan");
    // Two saves, so the first revision has been snapshotted to `.bak` — the
    // state every real template is in by the time anyone deletes it.
    await saveTemplate(root, schema);
    await saveTemplate(root, { ...schema, templateName: "revision two" });

    expect(await templateFileNames(root)).toContain("tmpl-orphan.json.bak");

    await deleteTemplate(root, "tmpl-orphan");

    const remaining = await templateFileNames(root);
    expect(remaining).toContain("tmpl-orphan.deleted.bak.json");
    expect(remaining).not.toContain("tmpl-orphan.json");
    expect(remaining).not.toContain("tmpl-orphan.json.bak");
    expect(remaining).not.toContain("tmpl-orphan.json.tmp");
  });

  it("resolves a deleted template to its tombstone without logging a bak-recovery", async () => {
    const root = createMemoryDirectory("workspace");
    const schema = makeTemplate("tmpl-legacy", "legacy");
    await saveTemplate(root, schema);
    await saveTemplate(root, { ...schema, templateName: "revision two" });

    // Reproduce the PRE-FIX production state by hand: a delete that took only
    // the live name and orphaned the sibling.
    const dir = await getTemplatesRoot(root, true);
    await safeWriteJson(dir, "tmpl-legacy.deleted.bak.json", {
      ...schema,
      deletedAt: new Date().toISOString(),
    });
    await dir.removeEntry?.("tmpl-legacy.json");
    __resetBakRecoveryReportsForTests();
    clearErrors();

    const resolved = await loadTemplateIncludingDeleted(root, "tmpl-legacy");

    expect(resolved?.templateId).toBe("tmpl-legacy");
    expect((resolved as TombstonedTemplate | null)?.deletedAt).toBeTruthy();
    // The orphan is inert: no row, no banner, on a read that runs at every
    // sign-in through resolveAnswerTemplates.
    expect(getRecentErrors().filter((e) => e.context === "storage:bak-recovery")).toHaveLength(0);
  });

  it("prefers a re-created template's own snapshot over a stale tombstone when the live file is corrupt", async () => {
    const root = createMemoryDirectory("workspace");
    const dir = await getTemplatesRoot(root, true);

    // Deleted...
    await saveTemplate(root, makeTemplate("tmpl-reused", "original"));
    await deleteTemplate(root, "tmpl-reused");
    // ...then RE-CREATED under the same id (deleting does not reserve it), and
    // saved twice so the re-created revision has its own `.bak`.
    await saveTemplate(root, makeTemplate("tmpl-reused", "re-created"));
    await saveTemplate(root, makeTemplate("tmpl-reused", "re-created v2", 2));

    // Now the live file tears. Its snapshot holds the CURRENT template; the
    // tombstone holds the superseded one. Answering from the tombstone would
    // resolve employees' answers against the wrong questions.
    const handle = await dir.getFileHandle("tmpl-reused.json");
    const writable = await handle.createWritable?.();
    await writable?.write("{ truncated");
    await writable?.close();

    const resolved = await loadTemplateIncludingDeleted(root, "tmpl-reused");

    // The `.bak` holds the previous revision by construction, so the exact
    // revision recovered is v1 of the RE-CREATED template. What matters is
    // which lineage answered: a live-file lineage, never the tombstone.
    expect(resolved?.templateName).toBe("re-created");
    expect((resolved as TombstonedTemplate | null)?.deletedAt).toBeFalsy();
  });
});
