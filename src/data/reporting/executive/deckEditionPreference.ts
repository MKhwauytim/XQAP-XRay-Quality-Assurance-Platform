import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { casLoop } from "../../storage/casLoop";
import { withResourceLock } from "../../storage/webLocks";
import { getTemplatesRoot } from "../../workspace/workspacePaths";

const PREFERENCE_FILE = "executive-deck-edition.json";

export type ExecutiveDeckEdition = "v2" | "v3";

/** Global (not per-month) chosen executive-deck edition, persisted to the
 *  workspace's templates root — same shape and CAS contract as
 *  `deck2/styleChoices.ts`'s choices file. Missing/unreadable file means
 *  "no preference recorded"; callers treat that as "v2" (the default). */
export type DeckEditionPreference = {
  edition: ExecutiveDeckEdition;
  updatedAt: string;
  updatedBy: string;
  revision?: number;
  _writeToken?: string;
};

async function getPreferenceDir(
  directoryHandle: DirectoryHandleLike,
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function loadDeckEditionPreference(
  directoryHandle: DirectoryHandleLike,
): Promise<DeckEditionPreference | null> {
  try {
    const dir = await getPreferenceDir(directoryHandle);
    const result = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function saveDeckEditionPreference(
  directoryHandle: DirectoryHandleLike,
  edition: ExecutiveDeckEdition,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getPreferenceDir(directoryHandle);
    const outcome = await withResourceLock(`${dir.name}/deck-edition-preference:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: DeckEditionPreference = {
            edition,
            updatedAt: new Date().toISOString(),
            updatedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, PREFERENCE_FILE, updated);
          const verify = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<DeckEditionPreference>(dir, PREFERENCE_FILE);
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
        { conflictError: "تعذّر حفظ تفضيل تصميم العرض التنفيذي: تعارض في الكتابة بعد عدة محاولات." },
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
