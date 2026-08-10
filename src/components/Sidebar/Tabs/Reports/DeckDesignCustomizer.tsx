import { useEffect, useRef, useState } from "react";
import { X, Save, Eye } from "lucide-react";
import { ModalPortal } from "../../../ModalPortal/ModalPortal";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
import { loadDeckStyleChoices, saveDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import { readSession } from "../../../../auth/authSession";

type Props = {
  // P0 perf fix: the dialog used to receive an already-built `execInput`
  // (full population + sample + distribution + all employee files), which
  // forced the caller to load ALL of that BEFORE the dialog could even open
  // (~30 minutes on the owner's 500k-row / ~9,000-sample workspace). It now
  // receives loaders instead, and the load only runs when the admin
  // explicitly asks for a live preview (see handleGeneratePreview below) --
  // choosing a style option must never require the built report model.
  loadExecInput: () => Promise<ExecutiveReportInput | null>;
  buildDisplayNameMap: () => Record<string, string>;
  directoryHandle: DirectoryHandleLike;
  canMutate: (featureId: string) => boolean;
  onClose: () => void;
};

type MessageEventLike = { data?: { type?: string; slideId?: string; variantIndex?: number } };

/**
 * Admin-only in-app design customizer. Opens instantly (no month data read
 * on mount) and only loads the style-choices file, which is small and
 * unrelated to population/sample/distribution size. The live preview --
 * which renders the CURRENT REAL month's report with variantPreview=true so
 * every slide's arrow-cycle switcher is live -- is built only after the
 * admin explicitly clicks "معاينة حية" (Live preview), with progress
 * feedback while the heavy read + build runs. Choices arrive via
 * postMessage (the bridge DECK_VARIANT_SCRIPT's persist() emits
 * unconditionally) and are saved on an explicit Save click — never
 * auto-saves per click, matching "customize... and save it" as one
 * deliberate action.
 * See docs/superpowers/specs/2026-07-25-admin-report-customization-design.md.
 */
export default function DeckDesignCustomizer({ loadExecInput, buildDisplayNameMap, directoryHandle, canMutate, onClose }: Props) {
  const [loadedChoices, setLoadedChoices] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const pendingChoices = useRef<Record<string, number>>({});

  // Cheap: a single small JSON file at the workspace's templates root, not
  // month data -- safe to load on mount without delaying dialog open.
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

  // P0 perf fix: this used to build the FULL deck (the heaviest computation
  // in the reporting layer, on top of the full execInput load) unconditionally
  // on mount, before the admin had picked any style option. It now only runs
  // when the admin explicitly requests a live preview -- the dialog itself
  // (style-choice list, Save button) needs none of this.
  const [html, setHtml] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function handleGeneratePreview() {
    setPreviewState("loading");
    setPreviewError(null);
    try {
      const execInput = await loadExecInput();
      if (!execInput) {
        setPreviewState("error");
        setPreviewError("لم يتم العثور على بيانات المجتمع لهذا الشهر. يجب معالجة المجتمع أولاً.");
        return;
      }
      const names = buildDisplayNameMap();
      const { buildExecutiveDeckV2 } = await import("../../../../data/reporting/executive/deck2");
      const result = await buildExecutiveDeckV2(execInput, names, {
        variantPreview: true,
        styleChoices: loadedChoices ?? {},
      });
      setHtml(result);
      setPreviewState("idle");
    } catch {
      setPreviewState("error");
      setPreviewError("تعذّر توليد المعاينة الحية.");
    }
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
    <ModalPortal>
    <div className="rh-customizer-overlay" role="dialog" aria-modal="true" aria-label="تخصيص تصميم العرض التنفيذي">
      <div className="rh-customizer-panel">
        <div className="rh-customizer-toolbar">
          <span className="rh-customizer-title">تخصيص تصميم العرض التنفيذي</span>
          <div className="rh-customizer-actions">
            {status ? <span className={`rh-customizer-status rh-customizer-status-${status.kind}`}>{status.text}</span> : null}
            <button
              type="button"
              className="rh-btn"
              onClick={() => { void handleGeneratePreview(); }}
              disabled={!ready || previewState === "loading"}
            >
              {previewState === "loading" ? <span className="rh-spinner" /> : <Eye size={15} strokeWidth={2} />}
              {html ? "تحديث المعاينة" : "معاينة حية"}
            </button>
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
          {html ? (
            <iframe title="معاينة تخصيص العرض التنفيذي" className="rh-customizer-frame" srcDoc={html} />
          ) : previewState === "loading" ? (
            <div className="rh-customizer-loading">جارٍ تحميل بيانات الشهر وتوليد المعاينة…</div>
          ) : previewState === "error" ? (
            <div className="rh-customizer-loading">{previewError}</div>
          ) : (
            <div className="rh-customizer-loading">
              اختر «معاينة حية» لعرض تصميم العرض التنفيذي بالبيانات الفعلية لهذا الشهر وتبديل أنماط الشرائح.
            </div>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
