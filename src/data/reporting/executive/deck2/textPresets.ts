import type { DirectoryHandleLike } from "../../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../../storage/safeWrite";
import { casLoop } from "../../../storage/casLoop";
import { withResourceLock } from "../../../storage/webLocks";
import { getTemplatesRoot } from "../../../workspace/workspacePaths";
import { sanitizeOverrides } from "./textEdit";
import type { TextOverrides } from "./textEdit";

export const DECK_TEXT_PRESETS_FILE = "deck2.text-presets.json";

export type DeckTextPreset = {
  id: string;
  name: string;
  /** Default text -> replacement text (static wording only, see textEdit.ts). */
  overrides: TextOverrides;
  updatedAt: string;
  updatedBy: string;
};

/** Named text presets for the deck2 executive report, shared per workspace.
 *  The default deck is never stored here — it is simply "no preset". */
export type DeckTextPresets = {
  presets: DeckTextPreset[];
  updatedAt: string;
  updatedBy: string;
  /** Monotonic CAS revision for this shared, multi-admin file. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};

export function newPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Drops malformed entries from a file read off disk. */
export function normalizePresets(raw: DeckTextPresets | null | undefined): DeckTextPreset[] {
  if (!raw || !Array.isArray(raw.presets)) return [];
  return raw.presets
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim())
    .map((p) => ({ ...p, name: p.name.trim(), overrides: sanitizeOverrides(p.overrides) }));
}

export async function loadDeckTextPresets(
  directoryHandle: DirectoryHandleLike,
): Promise<DeckTextPreset[]> {
  try {
    const dir = await getTemplatesRoot(directoryHandle, true);
    const result = await safeReadJson<DeckTextPresets>(dir, DECK_TEXT_PRESETS_FILE);
    return result.ok ? normalizePresets(result.value) : [];
  } catch {
    return [];
  }
}

type MutateOutcome = { ok: true; presets: DeckTextPreset[] } | { ok: false; error: string };

/** Read-modify-write of the whole preset list under CAS. `mutate` gets the
 *  current list and returns the next one. */
async function mutatePresets(
  directoryHandle: DirectoryHandleLike,
  updatedBy: string,
  mutate: (current: DeckTextPreset[]) => DeckTextPreset[],
): Promise<MutateOutcome> {
  try {
    const dir = await getTemplatesRoot(directoryHandle, true);
    const outcome = await withResourceLock(`${dir.name}/deck2-text-presets:rmw`, () =>
      casLoop<DeckTextPreset[]>(
        async (writeToken) => {
          const existing = await safeReadJson<DeckTextPresets>(dir, DECK_TEXT_PRESETS_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const presets = mutate(existing.ok ? normalizePresets(existing.value) : []);
          const updated: DeckTextPresets = {
            presets,
            updatedAt: new Date().toISOString(),
            updatedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, DECK_TEXT_PRESETS_FILE, updated);
          const stillMine = async () => {
            const r = await safeReadJson<DeckTextPresets>(dir, DECK_TEXT_PRESETS_FILE);
            return r.ok && r.value.revision === nextRevision && r.value._writeToken === writeToken;
          };
          if (await stillMine()) return { done: true, result: presets, verify: stillMine };
          return { done: false };
        },
        {
          context: "executiveDeck:textPresets",
          conflictError: "تعذّر حفظ الإعداد المسبق: تعارض في الكتابة بعد عدة محاولات.",
        },
      ),
    );
    return Array.isArray(outcome) ? { ok: true, presets: outcome } : { ok: false, error: outcome.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Saves `overrides` under `name`; an existing preset with the same name is replaced. */
export function saveDeckTextPreset(
  directoryHandle: DirectoryHandleLike,
  name: string,
  overrides: unknown,
  updatedBy: string,
): Promise<MutateOutcome> {
  const clean = sanitizeOverrides(overrides);
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return Promise.resolve({ ok: false, error: "اسم الإعداد مطلوب" });
  if (Object.keys(clean).length === 0) {
    return Promise.resolve({ ok: false, error: "لا توجد تعديلات صالحة للحفظ" });
  }
  return mutatePresets(directoryHandle, updatedBy, (current) => {
    const existing = current.find((p) => p.name === trimmed);
    const entry: DeckTextPreset = {
      id: existing?.id ?? newPresetId(),
      name: trimmed,
      overrides: clean,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    return existing ? current.map((p) => (p.id === existing.id ? entry : p)) : [...current, entry];
  });
}

export function deleteDeckTextPreset(
  directoryHandle: DirectoryHandleLike,
  id: string,
  updatedBy: string,
): Promise<MutateOutcome> {
  return mutatePresets(directoryHandle, updatedBy, (current) => current.filter((p) => p.id !== id));
}
