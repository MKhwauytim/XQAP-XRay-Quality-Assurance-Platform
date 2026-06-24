import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import type { TemplateIndex, TemplateSchema } from "./templateTypes";

const INDEX_FILE = "templates.index.json";

async function getTemplatesDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function saveTemplate(
  directoryHandle: DirectoryHandleLike,
  schema: TemplateSchema
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const fileName = `${schema.templateId}.json`;
    await safeWriteJson(dir, fileName, schema);

    // Update index
    const indexResult = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
    const existing: TemplateIndex = indexResult.ok
      ? indexResult.value
      : { templates: [] };

    const otherTemplates = existing.templates.filter(
      (t) => t.templateId !== schema.templateId
    );
    const updated: TemplateIndex = {
      templates: [
        ...otherTemplates,
        {
          templateId: schema.templateId,
          templateName: schema.templateName,
          version: schema.version,
          updatedAt: schema.updatedAt
        }
      ].sort((a, b) => a.templateName.localeCompare(b.templateName, "ar"))
    };
    await safeWriteJson(dir, INDEX_FILE, updated);

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadTemplate(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<TemplateSchema | null> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const result = await safeReadJson<TemplateSchema>(
      dir,
      `${templateId}.json`
    );
    return result.ok && typeof result.value.templateId === "string"
      ? result.value
      : null;
  } catch {
    return null;
  }
}

export async function loadTemplateIndex(
  directoryHandle: DirectoryHandleLike
): Promise<TemplateIndex> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const result = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
    return result.ok ? result.value : { templates: [] };
  } catch {
    return { templates: [] };
  }
}

export async function deleteTemplate(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getTemplatesDir(directoryHandle);

    // Remove from index
    const indexResult = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
    if (indexResult.ok) {
      const updated: TemplateIndex = {
        templates: indexResult.value.templates.filter(
          (t) => t.templateId !== templateId
        )
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
    }

    if (dir.removeEntry) {
      await dir.removeEntry(`${templateId}.json`);
    } else {
      await safeWriteJson(dir, `${templateId}.json`, {
        deleted: true,
        templateId,
        deletedAt: new Date().toISOString()
      });
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export function createTemplateId(): string {
  return `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFieldId(): string {
  return `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPhaseId(): string {
  return `phs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
