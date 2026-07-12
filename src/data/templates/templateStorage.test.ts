import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { safeReadJson } from "../storage/safeWrite";
import type { TemplateSchema } from "./templateTypes";
import {
  deleteTemplate,
  loadTemplate,
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
});
