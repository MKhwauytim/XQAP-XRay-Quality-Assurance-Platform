// Which saved deck2 text preset (if any) the executive deck opens with.
// Absent = the default wording. Per-browser convenience only — the presets
// themselves live in the workspace (deck2/textPresets.ts). Every access is
// try/caught: storage can be blocked or empty.
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { loadDeckTextPresets } from "../reporting/executive/deck2/textPresets";
import type { TextOverrides } from "../reporting/executive/deck2/textEdit";

export const ACTIVE_TEXT_PRESET_KEY = "xray_deck2_text_preset_v1";

export function getActiveTextPresetId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TEXT_PRESET_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveTextPresetId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_TEXT_PRESET_KEY, id);
    else localStorage.removeItem(ACTIVE_TEXT_PRESET_KEY);
  } catch {
    // Selection just won't persist.
  }
}

/** The preset the next deck should open with, or null for the default deck. */
export async function resolveActiveTextPreset(
  directoryHandle: DirectoryHandleLike | null | undefined,
): Promise<{ name: string; overrides: TextOverrides } | null> {
  const id = getActiveTextPresetId();
  if (!id || !directoryHandle) return null;
  const presets = await loadDeckTextPresets(directoryHandle);
  const found = presets.find((p) => p.id === id);
  return found ? { name: found.name, overrides: found.overrides } : null;
}
