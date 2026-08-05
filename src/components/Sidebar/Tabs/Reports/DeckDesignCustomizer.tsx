import { useEffect, useRef, useState } from "react";
import { X, Save } from "lucide-react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
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
 * Admin-only in-app design customizer: renders the CURRENT REAL month's
 * report (variantPreview=true, so every slide's arrow-cycle switcher is
 * live) into an iframe, listens for choices via postMessage (the bridge
 * DECK_VARIANT_SCRIPT's persist() now emits unconditionally), and saves the
 * accumulated combination on an explicit Save click — never auto-saves per
 * click, matching "customize... and save it" as one deliberate action.
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

  // P3-7: buildExecutiveDeckV2 is now async (main-thread-chunked), so this can
  // no longer be a plain `useMemo` — it needs the same cancellation-guarded
  // `useEffect` pattern already used above for `loadDeckStyleChoices`.
  // The `executive/deck2` import is also dynamic here now, for the same
  // startup-eval reason as `Reports/index.tsx`'s other conversions (§N) —
  // this was previously a static top-level import, which alone kept the
  // whole `deck2` module graph (including the two largest files in the
  // repo) in the eager boot path regardless of those other conversions,
  // since this component is itself statically imported by `Reports/index.tsx`.
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    // Guard-only, no setState here (react-hooks/set-state-in-effect):
    // `html` already starts `null` and there is no path back to `!ready`
    // once `loadDeckStyleChoices` resolves, so skipping the effect body is
    // enough — no stale-state reset needed.
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const { buildExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
      const result = await buildExecutiveDeckV2(execInput, employeeDisplayNames, {
        variantPreview: true,
        styleChoices: loadedChoices ?? {},
      });
      if (!cancelled) setHtml(result);
    })();
    return () => { cancelled = true; };
  }, [ready, execInput, employeeDisplayNames, loadedChoices]);

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
        <div className="rh-customizer-frame-wrap">
          {html ? <iframe title="معاينة تخصيص العرض التنفيذي" className="rh-customizer-frame" srcDoc={html} /> : <div className="rh-customizer-loading">جارٍ التحميل…</div>}
        </div>
      </div>
    </div>
  );
}
