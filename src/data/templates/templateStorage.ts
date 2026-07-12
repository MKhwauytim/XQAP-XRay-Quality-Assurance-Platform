import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import type { TemplateIndex, TemplateSchema } from "./templateTypes";

/**
 * CAS read-modify-write of the shared `templates.index.json`. It is edited by
 * every supervisor/manager/admin on every machine; the outer `withResourceLock`
 * (held by the caller) serializes same-tab writers, while casLoop re-reads fresh,
 * bumps `revision`, stamps `_writeToken`, and verifies both on read-back so a
 * concurrent author's index entry on another machine is never silently dropped.
 */
async function updateTemplateIndex(
  dir: DirectoryHandleLike,
  apply: (templates: TemplateIndex["templates"]) => TemplateIndex["templates"]
): Promise<void> {
  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const indexResult = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
      const existing: TemplateIndex = indexResult.ok ? indexResult.value : { templates: [] };
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: TemplateIndex = {
        revision: nextRevision,
        _writeToken: writeToken,
        templates: apply(existing.templates),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
      const verify = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { conflictError: "تعذّر تحديث فهرس القوالب: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

const INDEX_FILE = "templates.index.json";
const SELECTION_FILE = "template.selection.json";

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
    if (!schema.templateId || !schema.templateName) {
      return { ok: false, error: "بيانات القالب غير مكتملة، ولم يتم الحفظ." };
    }

    const dir = await getTemplatesDir(directoryHandle);
    await withResourceLock(`${dir.name}/templates-index`, async () => {
      const fileName = `${schema.templateId}.json`;
      // Per-id doc — single writer by id, safe to write once outside the CAS loop.
      await safeWriteJson(dir, fileName, schema);

      await updateTemplateIndex(dir, (templates) =>
        [
          ...templates.filter((t) => t.templateId !== schema.templateId),
          {
            templateId: schema.templateId,
            templateName: schema.templateName,
            version: schema.version,
            updatedAt: schema.updatedAt
          }
        ].sort((a, b) => a.templateName.localeCompare(b.templateName, "ar"))
      );
    });

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
    await withResourceLock(`${dir.name}/templates-index`, async () => {
      const templateFileName = `${templateId}.json`;
      const templateResult = await safeReadJson<TemplateSchema>(
        dir,
        templateFileName
      );
      if (templateResult.ok) {
        await safeWriteJson(dir, `${templateId}.deleted.bak.json`, {
          ...templateResult.value,
          deletedAt: new Date().toISOString()
        });
      }

      // Clear the active inspection-template selection if it points at the
      // template being deleted, so consumers (XrayReferrals, XrayInspectionResults,
      // Reports) don't keep silently referencing a dead templateId.
      const selectionResult = await safeReadJson<{
        templateId: string;
        updatedAt: string;
        updatedBy: string;
      }>(dir, SELECTION_FILE);
      if (selectionResult.ok && selectionResult.value.templateId === templateId) {
        await safeWriteJson(dir, SELECTION_FILE, {
          templateId: "",
          updatedAt: new Date().toISOString(),
          updatedBy: "system:deleteTemplate"
        });
      }

      await updateTemplateIndex(dir, (templates) =>
        templates.filter((t) => t.templateId !== templateId)
      );

      if (dir.removeEntry) {
        await dir.removeEntry(templateFileName);
      } else {
        await safeWriteJson(dir, templateFileName, {
          deleted: true,
          templateId,
          deletedAt: new Date().toISOString()
        });
      }
    });

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
