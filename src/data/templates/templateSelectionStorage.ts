import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";

const TEMPLATES_FOLDER = "templates";
const SELECTION_FILE = "active.inspection-template.json";

export type InspectionTemplateSelection = {
  templateId: string;
  updatedAt: string;
  updatedBy: string;
};

async function getTemplatesDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return directoryHandle.getDirectoryHandle(TEMPLATES_FOLDER, { create: true });
}

export async function loadInspectionTemplateSelection(
  directoryHandle: DirectoryHandleLike
): Promise<InspectionTemplateSelection | null> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const result = await safeReadJson<InspectionTemplateSelection>(
      dir,
      SELECTION_FILE
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function saveInspectionTemplateSelection(
  directoryHandle: DirectoryHandleLike,
  selection: InspectionTemplateSelection
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    await safeWriteJson(dir, SELECTION_FILE, selection);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error"
    };
  }
}
