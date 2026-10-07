import { useEffect, useState } from "react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import {
  deleteDeckTextPreset,
  loadDeckTextPresets,
  saveDeckTextPreset,
} from "../../../../data/reporting/executive/deck2/textPresets";
import type { DeckTextPreset } from "../../../../data/reporting/executive/deck2/textPresets";
import { TEXT_PRESET_CHANNEL } from "../../../../data/reporting/executive/deck2/textEdit";
import {
  getActiveTextPresetId,
  setActiveTextPresetId,
} from "../../../../data/preferences/deckTextPresetPreference";

type Props = {
  directoryHandle: DirectoryHandleLike | null;
  /** Whether the current user may write workspace files (export-reports). */
  canSave: boolean;
  username: string;
  onError: (text: string) => void;
};

type SaveRequest = { type?: string; name?: unknown; overrides?: unknown };

/**
 * Picks which saved text preset the executive deck (deck2) opens with, and
 * is the app-side receiver for the opened report's "save as preset" button:
 * that tab has no `opener`, so it posts over a same-origin BroadcastChannel
 * and this component writes the workspace file and replies with the result.
 * "الافتراضي" (the default deck) is always available and never overwritten.
 */
export default function DeckTextPresetPicker({ directoryHandle, canSave, username, onError }: Props) {
  const [presets, setPresets] = useState<DeckTextPreset[]>([]);
  const [activeId, setActiveId] = useState<string>(() => getActiveTextPresetId() ?? "");

  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    void loadDeckTextPresets(directoryHandle).then((list) => {
      if (cancelled) return;
      setPresets(list);
      setActiveId((current) => (current && !list.some((p) => p.id === current) ? "" : current));
    });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  useEffect(() => {
    if (!directoryHandle || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TEXT_PRESET_CHANNEL);
    channel.onmessage = (event: MessageEvent<SaveRequest>) => {
      const data = event.data;
      if (data?.type !== "deck2-text-preset-save" || typeof data.name !== "string") return;
      const name = data.name;
      void (async () => {
        if (!canSave) {
          channel.postMessage({ type: "deck2-text-preset-result", name, ok: false, error: "لا تملك صلاحية الحفظ" });
          return;
        }
        const result = await saveDeckTextPreset(directoryHandle, name, data.overrides, username);
        if (result.ok) {
          const saved = result.presets.find((p) => p.name === name.trim());
          setPresets(result.presets);
          if (saved) {
            setActiveTextPresetId(saved.id);
            setActiveId(saved.id);
          }
        }
        channel.postMessage({
          type: "deck2-text-preset-result",
          name,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
        });
      })();
    };
    return () => channel.close();
  }, [directoryHandle, canSave, username]);

  function handleSelect(id: string): void {
    setActiveId(id);
    setActiveTextPresetId(id || null);
  }

  async function handleDelete(): Promise<void> {
    if (!directoryHandle || !activeId) return;
    const target = presets.find((p) => p.id === activeId);
    if (!target || !window.confirm(`حذف الإعداد المسبق «${target.name}»؟`)) return;
    const result = await deleteDeckTextPreset(directoryHandle, activeId, username);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setPresets(result.presets);
    handleSelect("");
  }

  return (
    <div className="rh-deck-text-preset">
      <label>
        <span>نص العرض: </span>
        <select value={activeId} onChange={(e) => handleSelect(e.target.value)} aria-label="إعداد نص العرض التنفيذي">
          <option value="">الافتراضي</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {activeId && canSave ? (
        <button type="button" className="rh-btn" onClick={() => { void handleDelete(); }} title="حذف الإعداد المحدد">
          حذف
        </button>
      ) : null}
    </div>
  );
}
