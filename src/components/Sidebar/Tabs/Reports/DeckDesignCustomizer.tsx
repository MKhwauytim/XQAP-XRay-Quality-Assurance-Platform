import { useEffect, useMemo, useRef, useState } from "react";
import { X, Save } from "lucide-react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
import { buildExecutiveDeckV2 } from "../../../../data/reporting/executive/deck2";
import { loadDeckStyleChoices, saveDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import { readSession } from "../../../../auth/authSession";

type Props = {
  execInput: ExecutiveReportInput;
  employeeDisplayNames: Record<string, string>;
  directoryHandle: DirectoryHandleLike;
  canMutate: (featureId: string) => boolean;
  onClose: () => void;
};

type MessageEventLike = { data?: { type?: string; slideId?: string; variantIndex?: number } };

/**
 * The 3 named design systems (plus the original/default) a "*" deck-wide
 * choice can select — same 0-3 slot indices `resolveVariantIndex`
 * (slideKit.ts) resolves per-slide, same Arabic names/ordinal labels used
 * throughout docs/superpowers/specs/2026-07-25-deck2-design-systems-design.md.
 */
const DECK_WIDE_SYSTEMS: ReadonlyArray<{ index: number; label: string }> = [
  { index: 0, label: "الافتراضي (1/4)" },
  { index: 1, label: "السجل (2/4)" },
  { index: 2, label: "الإحاطة (3/4)" },
  { index: 3, label: "الشبكة (4/4)" },
];

/**
 * Admin-only in-app design customizer: renders the CURRENT REAL month's
 * report (variantPreview=true, so every slide's arrow-cycle switcher is
 * live) into an iframe, listens for choices via postMessage (the bridge
 * DECK_VARIANT_SCRIPT's persist() now emits unconditionally), and saves the
 * accumulated combination on an explicit Save click — never auto-saves per
 * click, matching "customize... and save it" as one deliberate action.
 *
 * The "تطبيق على كل الصفحات" segmented control below the toolbar sets the
 * engine's deck-wide `"*"` fallback key (`resolveVariantIndex`'s 3rd lookup
 * tier, slideKit.ts) directly from the React side, rather than through the
 * iframe's own per-page arrow switchers — clicking it also CLEARS every
 * per-page override accumulated so far, so "switch all pages to 2/4"
 * genuinely becomes a consistent whole-deck choice instead of one that
 * stale per-page overrides could silently reassert on individual pages
 * later. The per-page arrows remain available afterward to mix and match
 * on top of that new baseline (both requirements straight from the
 * commissioning admin's own framing of this feature).
 * See docs/superpowers/specs/2026-07-25-admin-report-customization-design.md.
 */
export default function DeckDesignCustomizer({ execInput, employeeDisplayNames, directoryHandle, canMutate, onClose }: Props) {
  const [loadedChoices, setLoadedChoices] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const pendingChoices = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void loadDeckStyleChoices(directoryHandle).then((saved) => {
      if (cancelled) return;
      const choices = saved?.choices ?? {};
      pendingChoices.current = { ...choices };
      setLoadedChoices(choices);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  useEffect(() => {
    function onMessage(event: MessageEventLike) {
      if (event.data?.type !== "deck2-style-choice") return;
      const { slideId, variantIndex } = event.data;
      if (typeof slideId !== "string" || typeof variantIndex !== "number") return;
      pendingChoices.current = { ...pendingChoices.current, [slideId]: variantIndex };
    }
    window.addEventListener("message", onMessage as EventListener);
    return () => window.removeEventListener("message", onMessage as EventListener);
  }, []);

  const html = useMemo(() => {
    if (!ready) return null;
    return buildExecutiveDeckV2(execInput, employeeDisplayNames, {
      variantPreview: true,
      styleChoices: loadedChoices ?? {},
    });
  }, [ready, execInput, employeeDisplayNames, loadedChoices]);

  // Highlights whichever segment matches the last deck-wide choice recorded
  // in `loadedChoices` (the state that also drives the iframe rebuild below).
  // Per-page arrow clicks inside the iframe only ever touch `pendingChoices`
  // (a ref, deliberately non-reactive — see the per-page bridge effect
  // above), so this can go stale relative to what's live on individual
  // pages after mixing — an accepted trade-off, since it still answers the
  // question this control actually asks ("what did I last apply to the
  // whole deck"), not "does every page currently match it".
  const activeDeckWideIndex = loadedChoices?.["*"] ?? null;

  function applyDeckWideChoice(index: number) {
    const next: Record<string, number> = { "*": index };
    pendingChoices.current = next;
    setLoadedChoices(next);
  }

  async function handleSave() {
    if (!canMutate("export-reports")) {
      setStatus({ kind: "error", text: "لا تملك صلاحية تصدير التقارير." });
      return;
    }
    const session = readSession();
    setSaving(true);
    setStatus(null);
    const result = await saveDeckStyleChoices(directoryHandle, pendingChoices.current, session?.username ?? "admin");
    setSaving(false);
    setStatus(result.ok ? { kind: "ok", text: "تم حفظ تخصيص التصميم." } : { kind: "error", text: result.error });
  }

  return (
    <div className="rh-customizer-overlay" role="dialog" aria-modal="true" aria-label="تخصيص تصميم العرض التنفيذي">
      <div className="rh-customizer-panel">
        <div className="rh-customizer-toolbar">
          <span className="rh-customizer-title">تخصيص تصميم العرض التنفيذي</span>
          <div className="rh-customizer-actions">
            {status ? <span className={`rh-customizer-status rh-customizer-status-${status.kind}`}>{status.text}</span> : null}
            <button type="button" className="rh-btn rh-btn-teal" onClick={() => { void handleSave(); }} disabled={!ready || saving}>
              {saving ? <span className="rh-spinner" /> : <Save size={15} strokeWidth={2} />}
              حفظ
            </button>
            <button type="button" className="rh-btn" onClick={onClose} aria-label="إغلاق">
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="rh-customizer-deckwide" role="group" aria-label="تطبيق نظام تصميم واحد على كل صفحات العرض">
          <span className="rh-customizer-deckwide-label">تطبيق على كل الصفحات:</span>
          <div className="rh-customizer-deckwide-segs">
            {DECK_WIDE_SYSTEMS.map((sys) => (
              <button
                key={sys.index}
                type="button"
                className={`rh-customizer-deckwide-seg${activeDeckWideIndex === sys.index ? " active" : ""}`}
                onClick={() => applyDeckWideChoice(sys.index)}
                disabled={!ready}
                aria-pressed={activeDeckWideIndex === sys.index}
              >
                {sys.label}
              </button>
            ))}
          </div>
        </div>
        <div className="rh-customizer-frame-wrap">
          {html ? <iframe title="معاينة تخصيص العرض التنفيذي" className="rh-customizer-frame" srcDoc={html} /> : <div className="rh-customizer-loading">جارٍ التحميل…</div>}
        </div>
      </div>
    </div>
  );
}
