import type { PageSizePreset, ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

interface RibbonProps {
  doc: ReportDocument;
  saving: boolean;
  showFields: boolean;
  showFormat: boolean;
  onToggleFields: () => void;
  onToggleFormat: () => void;
  onSave: () => void;
  onPrint: () => void;
  onPageSizeChange: (preset: PageSizePreset) => void;
  onBack: () => void;
}

const PAGE_SIZE_LABELS: Record<PageSizePreset, string> = {
  "A4": "A4 طولي",
  "Letter": "Letter طولي",
  "16:9": "شاشة عريضة 16:9",
  "4:3": "قياسي 4:3",
  "16:9-fhd": "Full HD 16:9",
  "custom": "مخصص",
};

export default function Ribbon({
  doc, saving, showFields, showFormat,
  onToggleFields, onToggleFormat,
  onSave, onPrint, onPageSizeChange, onBack,
}: RibbonProps) {
  return (
    <div className="rd-ribbon" dir="rtl">
      <button className="rd-ribbon-btn" onClick={onBack} type="button" title="العودة للقائمة">
        <span className="rd-ribbon-btn-icon">←</span>
        <span>رجوع</span>
      </button>
      <div className="rd-ribbon-separator" />

      <div className="rd-ribbon-group">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 8px", gap: "2px" }}>
          <select
            value={doc.pageSetup.size}
            onChange={(e) => onPageSizeChange(e.target.value as PageSizePreset)}
            style={{
              fontSize: "12px",
              border: "1px solid var(--rd-ribbon-border)",
              borderRadius: "4px",
              padding: "2px 6px",
              background: "#fff",
              direction: "rtl",
              cursor: "pointer",
            }}
            title="حجم الصفحة"
            aria-label="حجم الصفحة"
          >
            {(Object.keys(PAGE_SIZE_LABELS) as PageSizePreset[]).map((key) => (
              <option key={key} value={key}>{PAGE_SIZE_LABELS[key]}</option>
            ))}
          </select>
          <span style={{ fontSize: "10px", color: "var(--rd-text-secondary)" }}>الصفحة</span>
        </div>
      </div>
      <div className="rd-ribbon-separator" />

      <button
        className={`rd-ribbon-btn${showFields ? " rd-ribbon-btn--active" : ""}`}
        onClick={onToggleFields}
        type="button"
        title="إظهار/إخفاء لوحة الحقول"
      >
        <span className="rd-ribbon-btn-icon">📋</span>
        <span>الحقول</span>
      </button>
      <button
        className={`rd-ribbon-btn${showFormat ? " rd-ribbon-btn--active" : ""}`}
        onClick={onToggleFormat}
        type="button"
        title="إظهار/إخفاء لوحة التنسيق"
      >
        <span className="rd-ribbon-btn-icon">🎨</span>
        <span>التنسيق</span>
      </button>
      <div className="rd-ribbon-separator" />

      <span className="rd-ribbon-doc-name" title={doc.reportName}>{doc.reportName}</span>
      <div style={{ flex: 1 }} />

      {saving && <span className="rd-saving-indicator">جاري الحفظ...</span>}
      <button className="rd-ribbon-btn" onClick={onSave} disabled={saving} type="button" title="حفظ">
        <span className="rd-ribbon-btn-icon">💾</span>
        <span>حفظ</span>
      </button>
      <button className="rd-ribbon-btn rd-no-print" onClick={onPrint} type="button" title="طباعة">
        <span className="rd-ribbon-btn-icon">🖨️</span>
        <span>طباعة</span>
      </button>
    </div>
  );
}
