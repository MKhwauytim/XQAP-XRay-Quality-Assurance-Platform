import type { DirectoryHandleLike } from "../../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../../storage/safeWrite";
import { casLoop } from "../../../storage/casLoop";
import { withResourceLock } from "../../../storage/webLocks";
import { getTemplatesRoot } from "../../../workspace/workspacePaths";

const CHOICES_FILE = "deck2.style-choices.json";

/** Global (not per-month) admin-chosen variant index (0-3) per deck2 slide
 *  id, persisted to the workspace's templates root — same shape and CAS
 *  contract as `templateSelectionStorage.ts`'s selection file. */
export type DeckStyleChoices = {
  choices: Record<string, number>;
  updatedAt: string;
  updatedBy: string;
  /** Monotonic CAS revision for this shared, multi-admin choices file. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};

async function getStyleChoicesDir(
  directoryHandle: DirectoryHandleLike,
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function loadDeckStyleChoices(
  directoryHandle: DirectoryHandleLike,
): Promise<DeckStyleChoices | null> {
  try {
    const dir = await getStyleChoicesDir(directoryHandle);
    const result = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function saveDeckStyleChoices(
  directoryHandle: DirectoryHandleLike,
  choices: Record<string, number>,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getStyleChoicesDir(directoryHandle);
    // Shared, multi-admin choices file: CAS (revision + _writeToken, verified
    // on read-back) so a concurrent save on another machine is not silently
    // clobbered. The `:rmw` outer lock serializes same-tab writers.
    const outcome = await withResourceLock(`${dir.name}/deck2-style-choices:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: DeckStyleChoices = {
            choices,
            updatedAt: new Date().toISOString(),
            updatedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, CHOICES_FILE, updated);
          const verify = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
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
        { conflictError: "تعذّر حفظ تخصيص التصميم: تعارض في الكتابة بعد عدة محاولات." },
      ),
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
