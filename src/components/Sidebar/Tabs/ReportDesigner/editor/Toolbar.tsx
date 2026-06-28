import { useRef } from "react";
import type { ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

interface ToolbarProps {
  doc: ReportDocument;
  currentPageIndex: number;
  onAddElement: (type: "text" | "shape") => void;
  onImageSelected: (dataUrl: string) => void;
  onAddPage: () => void;
  onDeletePage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSave: () => void;
  onPrint: () => void;
  saving: boolean;
}

export default function Toolbar({
  doc,
  currentPageIndex,
  onAddElement,
  onImageSelected,
  onAddPage,
  onDeletePage,
  onPrevPage,
  onNextPage,
  onSave,
  onPrint,
  saving,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalPages = doc.pages.length;
  const pageNum = currentPageIndex + 1;

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onImageSelected(reader.result);
      }
    };
    reader.readAsDataURL(file);
    // reset so the same file can be picked again
    e.target.value = "";
  }

  return (
    <div className="rd-toolbar" dir="rtl">
      {/* ── Element add buttons ── */}
      <div className="rd-toolbar-group">
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={() => onAddElement("text")}
          title="إضافة نص"
        >
          إضافة نص
        </button>
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={() => onAddElement("shape")}
          title="إضافة شكل"
        >
          إضافة شكل
        </button>
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={() => fileInputRef.current?.click()}
          title="إضافة صورة"
        >
          إضافة صورة
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleImageFileChange}
        />
      </div>

      {/* ── Page navigation ── */}
      <div className="rd-toolbar-group rd-toolbar-group--page">
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={onPrevPage}
          disabled={currentPageIndex === 0}
          title="الصفحة السابقة"
        >
          → صفحة
        </button>
        <span className="rd-page-indicator">
          صفحة {pageNum} من {totalPages}
        </span>
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={onNextPage}
          disabled={currentPageIndex >= totalPages - 1}
          title="الصفحة التالية"
        >
          صفحة ←
        </button>
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={onAddPage}
          title="إضافة صفحة"
        >
          + صفحة
        </button>
        <button
          className="rd-btn rd-btn-danger rd-btn-sm"
          onClick={onDeletePage}
          disabled={totalPages <= 1}
          title="حذف الصفحة الحالية"
        >
          حذف الصفحة
        </button>
      </div>

      {/* ── Save / Print ── */}
      <div className="rd-toolbar-group rd-toolbar-group--end">
        <button
          className="rd-btn rd-btn-primary rd-btn-sm"
          onClick={onSave}
          disabled={saving}
          title="حفظ التقرير"
        >
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
        <button
          className="rd-btn rd-btn-secondary rd-btn-sm"
          onClick={onPrint}
          title="طباعة"
        >
          طباعة
        </button>
      </div>
    </div>
  );
}
