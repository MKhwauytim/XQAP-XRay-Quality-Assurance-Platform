import { useRef } from "react";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";
import Inspector from "./Inspector";

interface VizPanelProps {
  selectedElement: Element | null;
  onAddElement: (type: "text" | "shape") => void;
  onImageSelected: (dataUrl: string) => void;
  onUpdate: (id: string, patch: Partial<Element>) => void;
}

const VIZ_TYPES = [
  { label: "نص", icon: "T", disabled: false, key: "text" as const },
  { label: "شكل", icon: "◻", disabled: false, key: "shape" as const },
  { label: "صورة", icon: "🖼️", disabled: false, key: "image" as const },
  { label: "جدول", icon: "⊞", disabled: true, key: "table" as const },
  { label: "مخطط", icon: "📊", disabled: true, key: "chart" as const },
  { label: "KPI", icon: "🔷", disabled: true, key: "kpi" as const },
  { label: "خط", icon: "―", disabled: false, key: "line" as const },
  { label: "قسم", icon: "⬚", disabled: true, key: "section" as const },
];

export default function VizPanel({ selectedElement, onAddElement, onImageSelected, onUpdate }: VizPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") onImageSelected(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleTypeClick(key: string) {
    if (key === "image") { fileInputRef.current?.click(); return; }
    if (key === "text" || key === "shape" || key === "line") onAddElement(key === "line" ? "shape" : key);
  }

  // Bridge: Inspector expects (updated: Element) → convert to (id, patch)
  function handleInspectorUpdate(updated: Element) {
    onUpdate(updated.elementId, updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="rd-panel-header">
        <span>التصورات</span>
      </div>
      <div className="rd-viz-grid">
        {VIZ_TYPES.map((t) => (
          <button
            key={t.key}
            className="rd-viz-icon-btn"
            title={t.label}
            disabled={t.disabled}
            onClick={() => handleTypeClick(t.key)}
            type="button"
            aria-label={t.label}
          >
            <span className="rd-viz-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageFileChange}
        aria-hidden="true"
      />
      <div className="rd-format-section">
        <div className="rd-panel-header">
          <span>التنسيق</span>
        </div>
        <Inspector element={selectedElement} onUpdate={handleInspectorUpdate} />
      </div>
    </div>
  );
}
