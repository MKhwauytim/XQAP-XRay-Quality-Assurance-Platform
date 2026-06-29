import { useCallback, useEffect, useRef, useState } from "react";
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
  getPageSetup,
  PAGE_SIZE_LABELS,
  type ReportDocument,
  type Element,
  type PageSizePreset,
} from "../../../../data/reportDesigner/reportTypes";
import type { Rect } from "../../../../data/reportDesigner/geometry";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import Canvas from "./editor/Canvas";
import Ribbon from "./editor/Ribbon";
import VizPanel from "./editor/VizPanel";
import PagesBar from "./editor/PagesBar";
import FieldsPanel from "./editor/FieldsPanel";
import FieldDropDialog, { type AggChoice } from "./editor/FieldDropDialog";
import PrintView from "./PrintView";
import type { FieldRole } from "../../../../data/reportDesigner/query/fieldCatalog";
import "./ReportDesigner.css";

// tabConfig intentionally removed — Report Designer is now a sub-tab under إدارة التقارير.

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

function pageSizeLabel(p: PageSizePreset): string {
  return PAGE_SIZE_LABELS[p] ?? p;
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
  const [, setSaveError] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [showFormat, setShowFormat] = useState(true);

  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [fieldDrop, setFieldDrop] = useState<{
    fieldLabel: string;
    fieldName: string;
    role: FieldRole;
    canvasX: number;
    canvasY: number;
    screenX: number;
    screenY: number;
  } | null>(null);

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

  function addElement(type: "text" | "shape", x = 50, y = 50) {
    if (!currentPage) return;
    const newEl: Element = {
      elementId: createElementId(),
      type,
      name: "عنصر جديد",
      x,
      y,
      w: 200,
      h: 60,
      z: currentPage.elements.length,
      style: type === "shape" ? { fill: "#dce6f1", borderWidth: 1, borderColor: "#0078d4" } : {},
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

  function addFieldElement(label: string, fieldName: string, role: FieldRole, x = 50, y = 50, agg: AggChoice = "none") {
    if (!currentPage) return;
    const isDim = role === "dimension";
    const fill = isDim ? "#dce6f1" : "#dff6dd";
    const borderColor = isDim ? "#0078d4" : "#107c10";

    let newEl: Element;
    if (agg === "none") {
      // Dimension used as-is → styled text label, centered on drop
      const w = 200, h = 50;
      newEl = {
        elementId: createElementId(),
        type: "text",
        name: label,
        x: Math.max(0, x - w / 2),
        y: Math.max(0, y - h / 2),
        w, h,
        z: currentPage.elements.length,
        style: { fill, borderWidth: 1, borderColor, fontSize: 14, fontWeight: 600, color: "#201f1e", padding: 8 },
        config: { kind: "text", text: label },
      };
    } else {
      // With aggregation → KPI card, centered on drop
      const w = 160, h = 100;
      newEl = {
        elementId: createElementId(),
        type: "kpi",
        name: label,           // Arabic display label shown in card
        x: Math.max(0, x - w / 2),
        y: Math.max(0, y - h / 2),
        w, h,
        z: currentPage.elements.length,
        style: { fill, borderWidth: 1, borderColor },
        config: { kind: "kpi", dataSourceId: "population", valueField: fieldName, agg },
      };
    }
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

  // Bridge for VizPanel onUpdate(id, patch) → updateElement
  function handleElementUpdate(id: string, patch: Partial<Element>) {
    const el = doc.pages[currentPageIndex]?.elements.find((e) => e.elementId === id);
    if (!el) return;
    updateElement({ ...el, ...patch });
  }

  function handlePageSizeChange(preset: PageSizePreset) {
    const ps = getPageSetup(preset);
    setDoc((d) => ({ ...d, pageSetup: ps }));
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

  function handleDeletePage(index: number) {
    setDoc((d) => {
      if (d.pages.length <= 1) return d;
      const pages = d.pages.filter((_, i) => i !== index);
      setCurrentPageIndex((ci) => Math.min(ci, pages.length - 1));
      return { ...d, pages };
    });
  }

  return (
    <>
      <div
        className={`rd-pbi-layout${!showFields ? " rd-fields-hidden" : ""}${!showFormat ? " rd-format-hidden" : ""}`}
        style={{ height: "calc(100vh - 52px)" }}
      >
        <Ribbon
          doc={doc}
          saving={saving}
          showFields={showFields}
          showFormat={showFormat}
          onToggleFields={() => setShowFields((v) => !v)}
          onToggleFormat={() => setShowFormat((v) => !v)}
          onSave={handleExplicitSave}
          onPrint={() => setShowPrint(true)}
          onPageSizeChange={handlePageSizeChange}
          onBack={onBack}
        />

        {/* Fields panel (Task A.4) */}
        <div className="rd-fields-panel">
          <FieldsPanel />
        </div>

        {/* Canvas area */}
        <div
          ref={canvasAreaRef}
          className="rd-canvas-area"
          style={{
            "--rd-page-width": `${doc.pageSetup.width}px`,
            "--rd-page-height": `${doc.pageSetup.height}px`,
          } as React.CSSProperties}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const canvasPage = canvasAreaRef.current?.querySelector(".rd-canvas") as HTMLElement | null;
            const getDropCoords = (): { cx: number; cy: number } => {
              if (!canvasPage) return { cx: 50, cy: 50 };
              const pr = canvasPage.getBoundingClientRect();
              return {
                cx: Math.max(0, Math.round((e.clientX - pr.left) / 8) * 8),
                cy: Math.max(0, Math.round((e.clientY - pr.top) / 8) * 8),
              };
            };

            // Viz-type drag (from التصورات panel) → place element centered on drop
            const vizKey = e.dataTransfer.getData("application/x-rd-viz-type");
            if (vizKey) {
              const { cx, cy } = getDropCoords();
              if (vizKey === "text" || vizKey === "shape" || vizKey === "line") {
                // addElement defaults are 200×60; center on cursor
                addElement(vizKey === "line" ? "shape" : (vizKey as "text" | "shape"), Math.max(0, cx - 100), Math.max(0, cy - 30));
              }
              return;
            }

            // Field drag (from الحقول panel)
            const raw = e.dataTransfer.getData("application/x-rd-field");
            if (!raw) return;
            const { field, label, role } = JSON.parse(raw) as { field: string; label: string; role: FieldRole };
            const { cx, cy } = getDropCoords();

            // If dropping a dimension onto an existing KPI → set as groupBy breakdown
            if (role === "dimension" && currentPage) {
              const hitKpi = currentPage.elements.find(
                (el) =>
                  el.config.kind === "kpi" &&
                  cx >= el.x && cx <= el.x + el.w &&
                  cy >= el.y && cy <= el.y + el.h
              );
              if (hitKpi) {
                const updatedConfig = {
                  ...(hitKpi.config as import("../../../../data/reportDesigner/reportTypes").KpiConfig),
                  groupByField: field,
                  groupByLabel: label,
                };
                setDoc((d) => ({
                  ...d,
                  pages: d.pages.map((p, i) =>
                    i === currentPageIndex
                      ? {
                          ...p,
                          elements: p.elements.map((el) =>
                            el.elementId === hitKpi.elementId
                              ? { ...el, config: updatedConfig }
                              : el
                          ),
                        }
                      : p
                  ),
                }));
                setSelectedId(hitKpi.elementId);
                return;
              }
            }

            setFieldDrop({ fieldLabel: label, fieldName: field, role, canvasX: cx, canvasY: cy, screenX: e.clientX, screenY: e.clientY });
          }}
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

        <div className="rd-viz-panel">
          <VizPanel
            selectedElement={selectedId ? (doc.pages[currentPageIndex]?.elements.find((e) => e.elementId === selectedId) ?? null) : null}
            onAddElement={addElement}
            onImageSelected={addImageElement}
            onUpdate={handleElementUpdate}
          />
        </div>

        {/* Pages bar (Task A.3) */}
        <PagesBar doc={doc} currentPageIndex={currentPageIndex} onSelectPage={setCurrentPageIndex} onAddPage={addPage} onDeletePage={handleDeletePage} />
      </div>
      {fieldDrop && (
        <FieldDropDialog
          fieldLabel={fieldDrop.fieldLabel}
          fieldName={fieldDrop.fieldName}
          role={fieldDrop.role}
          screenX={fieldDrop.screenX}
          screenY={fieldDrop.screenY}
          onConfirm={(agg) => {
            addFieldElement(fieldDrop.fieldLabel, fieldDrop.fieldName, fieldDrop.role, fieldDrop.canvasX, fieldDrop.canvasY, agg);
            setFieldDrop(null);
          }}
          onCancel={() => setFieldDrop(null)}
        />
      )}
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

  // Loaded docs for thumbnail previews
  const [loadedDocs, setLoadedDocs] = useState<Record<string, ReportDocument>>({});

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

  // Load all documents in background to populate thumbnail previews
  useEffect(() => {
    if (!directoryHandle || index.designs.length === 0) return;
    let cancelled = false;
    void Promise.all(
      index.designs.map(async (d) => {
        const doc = await loadDesign(directoryHandle!, d.reportId);
        if (doc && !cancelled) {
          setLoadedDocs((prev) => ({ ...prev, [d.reportId]: doc }));
        }
      })
    );
    return () => { cancelled = true; };
  }, [directoryHandle, index]);

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
            dir="rtl"
            title="حجم الصفحة"
            aria-label="حجم الصفحة"
          >
            {(["A4", "Letter", "16:9", "4:3", "16:9-fhd"] as PageSizePreset[]).map((p) => (
              <option key={p} value={p}>{pageSizeLabel(p)}</option>
            ))}
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
        <ul className="rd-cards">
          {index.designs.map((d) => {
            const thumbDoc = loadedDocs[d.reportId];
            const isOpening = openingId === d.reportId;
            const isDeleting = deletingId === d.reportId;
            const busy = isOpening || isDeleting;
            return (
              <li key={d.reportId} className="rd-card">
                {/* Thumbnail — click to open */}
                <div
                  className={`rd-card-thumb${busy ? " rd-card-thumb--loading" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`فتح ${d.reportName}`}
                  onClick={() => { if (!busy) void handleOpen(d.reportId); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void handleOpen(d.reportId); }}
                >
                  {isOpening && <span className="rd-card-thumb-spinner">جاري التحميل…</span>}
                  {!isOpening && thumbDoc ? (
                    <div className="rd-card-thumb-inner" style={{ pointerEvents: "none" }}>
                      <Canvas
                        doc={thumbDoc}
                        pageIndex={0}
                        selectedId={null}
                        onSelect={() => {}}
                        mode="view"
                        zoom={240 / thumbDoc.pageSetup.width}
                      />
                    </div>
                  ) : (
                    !isOpening && <span className="rd-card-thumb-placeholder">…</span>
                  )}
                </div>
                {/* Card footer */}
                <div className="rd-card-footer">
                  <div className="rd-card-info">
                    <span className="rd-card-name">{d.reportName}</span>
                    <span className="rd-card-date">{formatDate(d.updatedAt)}</span>
                  </div>
                  <div className="rd-card-actions">
                    <button
                      className="rd-btn rd-btn-primary rd-btn-sm"
                      onClick={() => void handleOpen(d.reportId)}
                      disabled={busy}
                    >
                      {isOpening ? "…" : "فتح"}
                    </button>
                    <button
                      className="rd-btn rd-btn-danger rd-btn-sm"
                      onClick={() => void handleDelete(d.reportId)}
                      disabled={busy}
                    >
                      {isDeleting ? "…" : "حذف"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
