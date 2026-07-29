import { ArrowRight, Columns, Paintbrush, Printer, Save } from "lucide-react";
import type { PageSizePreset, ReportDocument } from "../../../../../data/reportDesigner/reportTypes";
import { PAGE_SIZE_LABELS } from "../../../../../data/reportDesigner/reportTypes";
import { useLabels } from "../../../../../data/labels/useLabels";

const SW = 1.8;

interface RibbonProps {
  doc: ReportDocument;
  saving: boolean;
  saveError?: string | null;
  showFields: boolean;
  showFormat: boolean;
  /**
   * False for a view-only user (e.g. supervisor without report-designer.edit).
   * Disables the mutation controls — save and page-size — while leaving
   * navigation (back), layout toggles, and print available, since those never
   * write to the design document.
   */
  canEdit: boolean;
  onToggleFields: () => void;
  onToggleFormat: () => void;
  onSave: () => void;
  onPrint: () => void;
  onPageSizeChange: (preset: PageSizePreset) => void;
  onBack: () => void;
}

export default function Ribbon({
  doc, saving, saveError, showFields, showFormat, canEdit,
  onToggleFields, onToggleFormat,
  onSave, onPrint, onPageSizeChange, onBack,
}: RibbonProps) {
  const labels = useLabels();
  const editDeniedTitle = labels.rd_edit_denied_msg;
  return (
    <div className="rd-ribbon" dir="rtl">
      <button className="rd-ribbon-btn" onClick={onBack} type="button" title={labels.rd_back_title}>
        <span className="rd-ribbon-btn-icon"><ArrowRight size={18} strokeWidth={SW} /></span>
        <span>{labels.rd_back_btn}</span>
      </button>
      <div className="rd-ribbon-separator" />

      <div className="rd-ribbon-group">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 8px", gap: "2px" }}>
          <select
            value={doc.pageSetup.size}
            onChange={(e) => onPageSizeChange(e.target.value as PageSizePreset)}
            disabled={!canEdit}
            style={{
              fontSize: "12px",
              border: "1px solid var(--rd-ribbon-border)",
              borderRadius: "4px",
              padding: "2px 6px",
              background: "#fff",
              direction: "rtl",
              cursor: canEdit ? "pointer" : "not-allowed",
            }}
            title={canEdit ? labels.rd_page_size_label : editDeniedTitle}
            aria-label={labels.rd_page_size_label}
          >
            {(Object.keys(PAGE_SIZE_LABELS) as PageSizePreset[]).map((key) => (
              <option key={key} value={key}>{PAGE_SIZE_LABELS[key]}</option>
            ))}
          </select>
          <span style={{ fontSize: "10px", color: "var(--rd-text-secondary)" }}>{labels.rd_page_word}</span>
        </div>
      </div>
      <div className="rd-ribbon-separator" />

      <button
        className={`rd-ribbon-btn${showFields ? " rd-ribbon-btn--active" : ""}`}
        onClick={onToggleFields}
        type="button"
        title={labels.rd_toggle_fields_title}
      >
        <span className="rd-ribbon-btn-icon"><Columns size={18} strokeWidth={SW} /></span>
        <span>{labels.rd_fields_label}</span>
      </button>
      <button
        className={`rd-ribbon-btn${showFormat ? " rd-ribbon-btn--active" : ""}`}
        onClick={onToggleFormat}
        type="button"
        title={labels.rd_toggle_format_title}
      >
        <span className="rd-ribbon-btn-icon"><Paintbrush size={18} strokeWidth={SW} /></span>
        <span>{labels.rd_format_label}</span>
      </button>
      <div className="rd-ribbon-separator" />

      <span className="rd-ribbon-doc-name" title={doc.reportName}>{doc.reportName}</span>
      <div style={{ flex: 1 }} />

      {saving && <span className="rd-saving-indicator">{labels.rd_saving_label}</span>}
      {!saving && saveError && (
        <span className="rd-saving-indicator rd-save-error" title={saveError}>
          {labels.rd_autosave_failed}
        </span>
      )}
      <button
        className="rd-ribbon-btn"
        onClick={onSave}
        disabled={saving || !canEdit}
        type="button"
        title={canEdit ? labels.rd_save_btn : editDeniedTitle}
      >
        <span className="rd-ribbon-btn-icon"><Save size={18} strokeWidth={SW} /></span>
        <span>{labels.rd_save_btn}</span>
      </button>
      <button className="rd-ribbon-btn rd-no-print" onClick={onPrint} type="button" title={labels.rd_print_btn}>
        <span className="rd-ribbon-btn-icon"><Printer size={18} strokeWidth={SW} /></span>
        <span>{labels.rd_print_btn}</span>
      </button>
    </div>
  );
}
