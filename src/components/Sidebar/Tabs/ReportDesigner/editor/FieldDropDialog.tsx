import { useState } from "react";
import type { FieldRole } from "../../../../../data/reportDesigner/query/fieldCatalog";
import type { Aggregation } from "../../../../../data/reportDesigner/reportTypes";

export type AggChoice = Aggregation | "none";

interface FieldDropDialogProps {
  fieldLabel: string;
  fieldName: string;
  role: FieldRole;
  screenX: number;
  screenY: number;
  onConfirm: (agg: AggChoice) => void;
  onCancel: () => void;
}

const DIMENSION_OPTIONS: Array<{ value: AggChoice; label: string }> = [
  { value: "none",          label: "بدون تجميع" },
  { value: "count",         label: "عدد" },
  { value: "distinctCount", label: "عدد مميز" },
];

const MEASURE_OPTIONS: Array<{ value: AggChoice; label: string }> = [
  { value: "sum",            label: "مجموع" },
  { value: "avg",            label: "متوسط" },
  { value: "count",          label: "عدد" },
  { value: "min",            label: "أدنى قيمة" },
  { value: "max",            label: "أقصى قيمة" },
  { value: "percentOfTotal", label: "نسبة من الإجمالي" },
];

const DIALOG_W = 228;
const DIALOG_H = 300;

export default function FieldDropDialog({
  fieldLabel,
  fieldName,
  role,
  screenX,
  screenY,
  onConfirm,
  onCancel,
}: FieldDropDialogProps) {
  const isDimension = role === "dimension";
  const options = isDimension ? DIMENSION_OPTIONS : MEASURE_OPTIONS;
  const defaultAgg: AggChoice = isDimension ? "none" : "sum";
  const [selected, setSelected] = useState<AggChoice>(defaultAgg);

  // Keep dialog fully inside the viewport
  const left = Math.min(screenX + 12, window.innerWidth  - DIALOG_W - 12);
  const top  = Math.min(screenY + 12, window.innerHeight - DIALOG_H - 12);

  return (
    /* backdrop – click outside to cancel */
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000 }}
      onMouseDown={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`إعدادات الحقل: ${fieldLabel}`}
        style={{
          position: "fixed",
          top,
          left,
          width: DIALOG_W,
          background: "#ffffff",
          border: "1px solid #e1dfdd",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          padding: "14px 16px",
          zIndex: 10001,
          direction: "rtl",
          fontFamily: "inherit",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#201f1e", marginBottom: 3 }}>
            {fieldLabel}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              color: isDimension ? "#0078d4" : "#107c10",
              background: isDimension ? "#dce6f1" : "#dff6dd",
              borderRadius: 4,
              padding: "2px 7px",
            }}
          >
            {isDimension ? "بُعد" : "مقياس"}
          </div>
          <div style={{ fontSize: 11, color: "#605e5c", marginTop: 4 }}>{fieldName}</div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid #edebe9", marginBottom: 10 }} />

        {/* Aggregation options */}
        <div style={{ fontSize: 12, fontWeight: 600, color: "#605e5c", marginBottom: 6 }}>
          التجميع
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
          {options.map((o) => (
            <label
              key={o.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 4,
                background: selected === o.value ? "#dce6f1" : "transparent",
                color: selected === o.value ? "#0078d4" : "#201f1e",
                fontWeight: selected === o.value ? 600 : 400,
                transition: "background 0.1s",
              }}
            >
              <input
                type="radio"
                name="rd-field-agg"
                value={o.value}
                checked={selected === o.value}
                onChange={() => setSelected(o.value)}
                style={{ accentColor: "#0078d4" }}
              />
              {o.label}
            </label>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            style={{
              flex: 1,
              padding: "6px 0",
              borderRadius: 4,
              border: "none",
              background: "#0078d4",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
            onClick={() => onConfirm(selected)}
          >
            إضافة
          </button>
          <button
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #e1dfdd",
              background: "#f3f2f1",
              color: "#201f1e",
              fontSize: 13,
              cursor: "pointer",
            }}
            onClick={onCancel}
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
