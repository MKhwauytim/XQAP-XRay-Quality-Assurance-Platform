import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getTemplatesRoot } from "../workspace/workspacePaths";

const SELECTION_FILE = "template.selection.json";

export type InspectionTemplateSelection = {
  templateId: string;
  updatedAt: string;
  updatedBy: string;
  /** Monotonic CAS revision for this shared, multi-admin selection file. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};

async function getTemplatesDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
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
    // Shared, multi-admin selection file: CAS (revision + _writeToken, verified
    // on read-back) so a concurrent selection change on another machine is not
    // silently clobbered. The `:rmw` outer lock serializes same-tab writers.
    const outcome = await withResourceLock(`${dir.name}/template-selection:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<InspectionTemplateSelection>(dir, SELECTION_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: InspectionTemplateSelection = {
            ...selection,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, SELECTION_FILE, updated);
          const verify = await safeReadJson<InspectionTemplateSelection>(dir, SELECTION_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<InspectionTemplateSelection>(dir, SELECTION_FILE);
                return (
                  recheck.ok &&
                  recheck.value.revision === nextRevision &&
                  recheck.value._writeToken === writeToken
                );
              },
            };
          }
          return { done: false };
        },
        { conflictError: "تعذّر حفظ اختيار القالب: تعارض في الكتابة بعد عدة محاولات." }
      )
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error"
    };
  }
}
