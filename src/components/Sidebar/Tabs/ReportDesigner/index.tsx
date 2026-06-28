/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from "react";
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
  type ReportDocument,
} from "../../../../data/reportDesigner/reportTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
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
    setLoadingIndex(true);
    setIndexError(null);
    loadDesignIndex(directoryHandle)
      .then((idx) => {
        if (!cancelled) {
          setIndex(idx);
          setLoadingIndex(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setIndexError(
            err instanceof Error ? err.message : "خطأ غير متوقع عند تحميل القائمة."
          );
          setLoadingIndex(false);
        }
      });
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
  if (view === "editor") {
    return (
      <div className="rd-root" dir="rtl">
        <div className="rd-editor-header">
          <button
            className="rd-btn rd-btn-secondary"
            onClick={() => {
              setView("list");
              setOpenDoc(null);
            }}
          >
            رجوع
          </button>
          <h2 className="rd-title rd-title-inline">
            {openDoc?.reportName ?? "تقرير جديد"}
          </h2>
        </div>
        <div className="rd-editor-placeholder">
          محرر التقارير — قيد التطوير
        </div>
      </div>
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
    const doc = createEmptyDocument(name, currentUser);
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
