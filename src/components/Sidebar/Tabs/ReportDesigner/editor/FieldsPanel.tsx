import { useState } from "react";
import { Hash, Tag } from "lucide-react";
import { FACT_FIELDS } from "../../../../../data/reportDesigner/query/fieldCatalog";

export default function FieldsPanel() {
  const [search, setSearch] = useState("");
  const [dimOpen, setDimOpen] = useState(true);
  const [measOpen, setMeasOpen] = useState(true);

  const q = search.trim().toLowerCase();
  const dims = FACT_FIELDS.filter(
    (f) => f.role === "dimension" && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q))
  );
  const meas = FACT_FIELDS.filter(
    (f) => f.role === "measure" && (!q || f.label.includes(q) || f.field.toLowerCase().includes(q))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>الحقول</span>
      </div>
      <input
        className="rd-fields-search"
        type="search"
        placeholder="بحث في الحقول..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        dir="rtl"
        aria-label="بحث في الحقول"
      />
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div className="rd-fields-group">
          <div
            className="rd-fields-group-header"
            onClick={() => setDimOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDimOpen((v) => !v); }}
            aria-expanded={dimOpen}
          >
            <span>{dimOpen ? "▾" : "▸"}</span>
            <span>أبعاد ({dims.length})</span>
          </div>
          {dimOpen &&
            dims.map((f) => (
              <div
                key={f.field}
                className="rd-field-item"
                title={f.field}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(
                    "application/x-rd-field",
                    JSON.stringify({ field: f.field, label: f.label, role: f.role })
                  );
                }}
              >
                <Tag size={12} strokeWidth={1.8} className="rd-field-icon" />
                <span className="rd-field-label">{f.label}</span>
              </div>
            ))}
        </div>
        <div className="rd-fields-group">
          <div
            className="rd-fields-group-header"
            onClick={() => setMeasOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMeasOpen((v) => !v); }}
            aria-expanded={measOpen}
          >
            <span>{measOpen ? "▾" : "▸"}</span>
            <span>مقاييس ({meas.length})</span>
          </div>
          {measOpen &&
            meas.map((f) => (
              <div
                key={f.field}
                className="rd-field-item"
                title={f.field}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData(
                    "application/x-rd-field",
                    JSON.stringify({ field: f.field, label: f.label, role: f.role })
                  );
                }}
              >
                <Hash size={12} strokeWidth={1.8} className="rd-field-icon" />
                <span className="rd-field-label">{f.label}</span>
              </div>
            ))}
        </div>
        {dims.length === 0 && meas.length === 0 && (
          <p style={{ padding: "12px", color: "var(--rd-text-secondary)", fontSize: "13px" }}>
            لا توجد حقول مطابقة
          </p>
        )}
      </div>
    </div>
  );
}
