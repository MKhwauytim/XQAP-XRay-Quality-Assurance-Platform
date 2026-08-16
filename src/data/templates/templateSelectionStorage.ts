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

/**
 * The one CAS read-modify-write path for `template.selection.json`.
 *
 * `apply` receives the freshly re-read selection (`null` when the file is
 * absent or unreadable) on every attempt and returns the selection to persist,
 * or `null` to leave the file untouched. Every writer of this file must go
 * through here: a raw `safeWriteJson` drops `revision`/`_writeToken`, rewinding
 * the counter and silently clobbering a concurrent admin's change (P1-B).
 */
async function casUpdateSelection(
  directoryHandle: DirectoryHandleLike,
  apply: (
    existing: InspectionTemplateSelection | null
  ) => Omit<InspectionTemplateSelection, "revision" | "_writeToken"> | null,
  conflictError: string
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
          const next = apply(existing.ok ? existing.value : null);
          // Nothing to change — a no-op must not burn a revision.
          if (next === null) return { done: true, result: { ok: true as const } };
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: InspectionTemplateSelection = {
            ...next,
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
        { conflictError }
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

export async function saveInspectionTemplateSelection(
  directoryHandle: DirectoryHandleLike,
  selection: InspectionTemplateSelection
): Promise<{ ok: true } | { ok: false; error: string }> {
  return casUpdateSelection(
    directoryHandle,
    () => selection,
    "تعذّر حفظ اختيار القالب: تعارض في الكتابة بعد عدة محاولات."
  );
}

/**
 * Clear the active selection, but only while it still points at `templateId`.
 *
 * The match test runs INSIDE the CAS loop against the freshly re-read file, so
 * an admin who switched the selection to another template between the caller's
 * read and this write is never blanked. Used by `deleteTemplate` so consumers
 * (XrayReferrals, XrayInspectionResults, Reports) stop referencing a dead id.
 */
export async function clearInspectionTemplateSelectionIfMatches(
  directoryHandle: DirectoryHandleLike,
  templateId: string,
  updatedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return casUpdateSelection(
    directoryHandle,
    (existing) =>
      existing && existing.templateId === templateId
        ? { templateId: "", updatedAt: new Date().toISOString(), updatedBy }
        : null,
    "تعذّر مسح اختيار القالب: تعارض في الكتابة بعد عدة محاولات."
  );
}
