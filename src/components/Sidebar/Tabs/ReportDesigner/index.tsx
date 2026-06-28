/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import { readSession } from "../../../../auth/authSession";
import {
  loadDesignIndex,
  saveDesign,
  deleteDesign,
  loadDesign,
  type DesignIndex,
} from "../../../../data/reportDesigner/storage/reportDesignStorage";
import {
  createEmptyDocument,
  createElementId,
  createPageId,
  type ReportDocument,
  type Element,
  type PageSizePreset,
} from "../../../../data/reportDesigner/reportTypes";
import type { Rect } from "../../../../data/reportDesigner/geometry";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import Canvas from "./editor/Canvas";
import Inspector from "./editor/Inspector";
import PrintView from "./PrintView";
import "./ReportDesigner.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "report-designer",
  label: "مصمم التقارير",
  order: 27,
  allowedRoles: ["supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
};

type View = "list" | "editor";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-SA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Editor host ────────────────────────────────────────────────────────────

interface EditorHostProps {
  initialDoc: ReportDocument;
  directoryHandle: DirectoryHandleLike;
  currentUser: string;
  onBack: () => void;
}

function EditorHost({ initialDoc, directoryHandle, currentUser, onBack }: EditorHostProps) {
  const [doc, setDoc] = useState<ReportDocument>(initialDoc);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [showFormat, setShowFormat] = useState(true);

  // Debounce timer ref — stores the pending timeout id
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending-doc ref so the debounce callback always sees the latest doc
  const pendingDocRef = useRef<ReportDocument>(doc);
  pendingDocRef.current = doc;

  // Schedule autosave whenever doc changes
  useEffect(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void performSave(pendingDocRef.current);
    }, 800);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  async function performSave(docToSave: ReportDocument) {
    const now = new Date().toISOString();
    const stamped: ReportDocument = {
      ...docToSave,
      updatedAt: now,
      updatedBy: currentUser,
    };
    setSaving(true);
    setSaveError(null);
    const result = await saveDesign(directoryHandle, stamped);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
    }
  }

  function handleExplicitSave() {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void performSave(pendingDocRef.current);
  }

  // ── Element mutations ──

  const currentPage = doc.pages[currentPageIndex];

  function addElement(type: "text" | "shape") {
    if (!currentPage) return;
    const newEl: Element = {
      elementId: createElementId(),
      type,
      name: "عنصر جديد",
      x: 50,
      y: 50,
      w: 200,
      h: 60,
      z: currentPage.elements.length,
      style: {},
      config:
        type === "text"
          ? { kind: "text", text: "نص" }
          : { kind: "shape", shape: "rect" },
    };
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p, i) =>
        i === currentPageIndex
          ? { ...p, elements: [...p.elements, newEl] }
          : p
      ),
    }));
    setSelectedId(newEl.elementId);
  }

  function addImageElement(dataUrl: string) {
    if (!currentPage) return;
    const newEl: Element = {
      elementId: createElementId(),
      type: "image",
      name: "صورة",
      x: 50,
      y: 50,
      w: 200,
      h: 150,
      z: currentPage.elements.length,
      style: {},
      config: { kind: "image", dataUrl },
    };
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p, i) =>
        i === currentPageIndex
          ? { ...p, elements: [...p.elements, newEl] }
          : p
      ),
    }));
    setSelectedId(newEl.elementId);
  }

  function updateElement(updated: Element) {
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p, i) =>
        i === currentPageIndex
          ? {
              ...p,
              elements: p.elements.map((el) =>
                el.elementId === updated.elementId ? updated : el
              ),
            }
          : p
      ),
    }));
  }

  const handleElementChange = useCallback((elementId: string, rect: Rect) => {
    setDoc((d) => ({
      ...d,
      pages: d.pages.map((p, i) =>
        i === currentPageIndex
          ? {
              ...p,
              elements: p.elements.map((el) =>
                el.elementId === elementId
                  ? { ...el, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
                  : el
              ),
            }
          : p
      ),
    }));
  }, [currentPageIndex]);

  // ── Page mutations ──

  function addPage() {
    const newPage = {
      pageId: createPageId(),
      name: `صفحة ${doc.pages.length + 1}`,
      order: doc.pages.length,
      filters: [],
      elements: [],
    };
    setDoc((d) => {
      const newPages = [...d.pages, newPage];
      setCurrentPageIndex(newPages.length - 1);
      return { ...d, pages: newPages };
    });
    setSelectedId(null);
  }

  function deletePage() {
    if (doc.pages.length <= 1) return;
    const nextIndex = Math.max(0, currentPageIndex - 1);
    setDoc((d) => ({ ...d, pages: d.pages.filter((_, i) => i !== currentPageIndex) }));
    setCurrentPageIndex(nextIndex);
    setSelectedId(null);
  }

  function prevPage() {
    setCurrentPageIndex((i) => Math.max(0, i - 1));
    setSelectedId(null);
  }

  function nextPage() {
    setCurrentPageIndex((i) => Math.min(doc.pages.length - 1, i + 1));
    setSelectedId(null);
  }

  // Find selected element for inspector
  const selectedElement =
    selectedId != null
      ? currentPage?.elements.find((el) => el.elementId === selectedId) ?? null
      : null;

  return (
    <>
      <div
        className={`rd-pbi-layout${!showFields ? " rd-fields-hidden" : ""}${!showFormat ? " rd-format-hidden" : ""}`}
        style={{ height: "calc(100vh - 52px)" }}
      >
        {/* STUB: Ribbon (Task A.5 will replace this) */}
        <div className="rd-ribbon" dir="rtl">
          <button className="rd-ribbon-btn" onClick={onBack}>
            <span className="rd-ribbon-btn-icon">←</span>
            <span>رجوع</span>
          </button>
          <div className="rd-ribbon-separator" />
          <span className="rd-ribbon-doc-name">{doc.reportName}</span>
          <div style={{ flex: 1 }} />
          {saving && <span className="rd-saving-indicator">جاري الحفظ...</span>}
          <button className="rd-ribbon-btn" onClick={handleExplicitSave} disabled={saving}>
            <span className="rd-ribbon-btn-icon">💾</span>
            <span>حفظ</span>
          </button>
          <button className="rd-ribbon-btn rd-no-print" onClick={() => setShowPrint(true)}>
            <span className="rd-ribbon-btn-icon">🖨️</span>
            <span>طباعة</span>
          </button>
          <div className="rd-ribbon-separator" />
          <button className="rd-ribbon-btn" onClick={() => setShowFields((v) => !v)}>
            <span className="rd-ribbon-btn-icon">📋</span>
            <span>الحقول</span>
          </button>
          <button className="rd-ribbon-btn" onClick={() => setShowFormat((v) => !v)}>
            <span className="rd-ribbon-btn-icon">🎨</span>
            <span>التنسيق</span>
          </button>
        </div>

        {/* STUB: Fields panel (Task A.4 will replace this) */}
        <div className="rd-fields-panel">
          <div className="rd-panel-header"><span>الحقول</span></div>
          <p style={{ padding: "12px", color: "var(--rd-text-secondary)", fontSize: "13px" }}>
            لوحة الحقول — قريباً
          </p>
        </div>

        {/* Canvas area */}
        <div
          className="rd-canvas-area"
          style={{
            "--rd-page-width": `${doc.pageSetup.width}px`,
            "--rd-page-height": `${doc.pageSetup.height}px`,
          } as React.CSSProperties}
        >
          <Canvas
            doc={doc}
            pageIndex={currentPageIndex}
            selectedId={selectedId}
            onSelect={setSelectedId}
            mode="edit"
            zoom={1}
            onElementChange={handleElementChange}
          />
        </div>

        {/* STUB: Viz+Format panel (Task A.5 will replace this) */}
        <div className="rd-viz-panel">
          <div className="rd-panel-header"><span>التنسيق</span></div>
          <Inspector
            element={selectedElement}
            onUpdate={updateElement}
          />
        </div>

        {/* STUB: Pages bar (Task A.3 will replace this) */}
        <div className="rd-pages-bar">
          {doc.pages.map((page, i) => (
            <button
              key={page.pageId}
              className={`rd-page-tab${i === currentPageIndex ? " rd-page-tab--active" : ""}`}
              onClick={() => setCurrentPageIndex(i)}
            >
              {page.name}
            </button>
          ))}
          <button className="rd-page-tab-add" onClick={addPage}>+ صفحة</button>
        </div>
      </div>
      {showPrint && <PrintView doc={doc} onClose={() => setShowPrint(false)} />}
    </>
  );
}

// ── Main tab component ──────────────────────────────────────────────────────

export default function ReportDesigner() {
  const { directoryHandle } = useWorkspace();
  const currentUser = readSession()?.username ?? "admin";

  const [view, setView] = useState<View>("list");
  const [openDoc, setOpenDoc] = useState<ReportDocument | null>(null);

  // List state
  const [index, setIndex] = useState<DesignIndex>({ designs: [] });
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

  // New-design form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPreset, setNewPreset] = useState<PageSizePreset>("A4");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  // Per-row action state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // --- Load index on mount / when directoryHandle changes ---
  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    async function fetchIndex() {
      setLoadingIndex(true);
      setIndexError(null);
      try {
        const idx = await loadDesignIndex(directoryHandle!);
        if (!cancelled) {
          setIndex(idx);
          setLoadingIndex(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setIndexError(
            err instanceof Error ? err.message : "خطأ غير متوقع عند تحميل القائمة."
          );
          setLoadingIndex(false);
        }
      }
    }
    void fetchIndex();
    return () => {
      cancelled = true;
    };
  }, [directoryHandle]);

  // Focus the input when the new-design form opens
  useEffect(() => {
    if (showNewForm) {
      newNameInputRef.current?.focus();
    }
  }, [showNewForm]);

  // --- Guard: no workspace ---
  if (!directoryHandle) {
    return (
      <div className="rd-root" dir="rtl">
        <h2 className="rd-title">مصمم التقارير</h2>
        <p className="rd-no-workspace">الرجاء اختيار مجلد العمل أولاً.</p>
      </div>
    );
  }

  // --- Editor view ---
  if (view === "editor" && openDoc) {
    return (
      <EditorHost
        initialDoc={openDoc}
        directoryHandle={directoryHandle}
        currentUser={currentUser}
        onBack={() => {
          setView("list");
          setOpenDoc(null);
        }}
      />
    );
  }

  // --- List view ---

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setCreateError("الرجاء إدخال اسم للتقرير.");
      return;
    }
    if (!directoryHandle) return;
    setCreating(true);
    setCreateError(null);
    const doc = createEmptyDocument(name, currentUser, newPreset);
    const result = await saveDesign(directoryHandle, doc);
    if (!result.ok) {
      setCreateError(result.error);
      setCreating(false);
      return;
    }
    setCreating(false);
    setNewName("");
    setShowNewForm(false);
    setOpenDoc(doc);
    setView("editor");
  }

  async function handleOpen(reportId: string) {
    if (!directoryHandle) return;
    setOpeningId(reportId);
    setOpenError(null);
    const doc = await loadDesign(directoryHandle, reportId);
    setOpeningId(null);
    if (!doc) {
      setOpenError("تعذّر تحميل التقرير. ربما تم حذف الملف.");
      return;
    }
    setOpenDoc(doc);
    setView("editor");
  }

  async function handleDelete(reportId: string) {
    if (!directoryHandle) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا التقرير؟")) return;
    setDeletingId(reportId);
    setDeleteError(null);
    const result = await deleteDesign(directoryHandle, reportId);
    if (!result.ok) {
      setDeleteError(result.error);
      setDeletingId(null);
      return;
    }
    setDeletingId(null);
    // Refresh list
    loadDesignIndex(directoryHandle)
      .then(setIndex)
      .catch(() => {});
  }

  return (
    <div className="rd-root" dir="rtl">
      <div className="rd-list-header">
        <h2 className="rd-title">مصمم التقارير</h2>
        {!showNewForm && (
          <button
            className="rd-btn rd-btn-primary"
            onClick={() => {
              setShowNewForm(true);
              setCreateError(null);
            }}
          >
            + تقرير جديد
          </button>
        )}
      </div>

      {showNewForm && (
        <div className="rd-new-form">
          <input
            ref={newNameInputRef}
            className="rd-new-input"
            type="text"
            placeholder="اسم التقرير"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") {
                setShowNewForm(false);
                setNewName("");
                setCreateError(null);
              }
            }}
            disabled={creating}
          />
          <select
            className="rd-new-select"
            value={newPreset}
            onChange={(e) => setNewPreset(e.target.value as PageSizePreset)}
            disabled={creating}
          >
            <option value="A4">A4 عمودي</option>
            <option value="Letter">Letter عمودي</option>
            <option value="16:9">16:9 شرائح</option>
            <option value="4:3">4:3 شرائح</option>
            <option value="16:9-fhd">16:9 FHD</option>
          </select>
          <button
            className="rd-btn rd-btn-primary"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? "جاري الإنشاء..." : "إنشاء"}
          </button>
          <button
            className="rd-btn rd-btn-secondary"
            onClick={() => {
              setShowNewForm(false);
              setNewName("");
              setCreateError(null);
            }}
            disabled={creating}
          >
            إلغاء
          </button>
          {createError && <p className="rd-error">{createError}</p>}
        </div>
      )}

      {indexError && <p className="rd-error">{indexError}</p>}
      {openError && <p className="rd-error">{openError}</p>}
      {deleteError && <p className="rd-error">{deleteError}</p>}

      {loadingIndex ? (
        <p className="rd-loading">جاري التحميل…</p>
      ) : index.designs.length === 0 ? (
        <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
      ) : (
        <ul className="rd-list">
          {index.designs.map((d) => (
            <li key={d.reportId} className="rd-row">
              <div className="rd-row-info">
                <span className="rd-row-name">{d.reportName}</span>
                <span className="rd-row-date">{formatDate(d.updatedAt)}</span>
              </div>
              <div className="rd-row-actions">
                <button
                  className="rd-btn rd-btn-secondary rd-btn-sm"
                  onClick={() => void handleOpen(d.reportId)}
                  disabled={openingId === d.reportId || deletingId === d.reportId}
                >
                  {openingId === d.reportId ? "جاري التحميل..." : "فتح"}
                </button>
                <button
                  className="rd-btn rd-btn-danger rd-btn-sm"
                  onClick={() => void handleDelete(d.reportId)}
                  disabled={deletingId === d.reportId || openingId === d.reportId}
                >
                  {deletingId === d.reportId ? "جاري الحذف..." : "حذف"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
