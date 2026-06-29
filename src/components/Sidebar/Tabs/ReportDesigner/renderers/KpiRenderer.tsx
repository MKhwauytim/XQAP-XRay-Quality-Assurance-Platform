import type { CSSProperties } from "react";
import type { Element, KpiConfig } from "../../../../../data/reportDesigner/reportTypes";

const AGG_LABELS: Record<string, string> = {
  count: "عدد",
  distinctCount: "عدد مميز",
  sum: "مجموع",
  avg: "متوسط",
  min: "أدنى",
  max: "أقصى",
  percentOfTotal: "نسبة",
};

interface KpiRendererProps {
  element: Element;
}

export default function KpiRenderer({ element }: KpiRendererProps) {
  const config = element.config as KpiConfig;
  const s = element.style;

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px",
    background: s.fill ?? "#f3f2f1",
    border: `${s.borderWidth ?? 1}px solid ${s.borderColor ?? "#d0d7de"}`,
    borderRadius: 4,
    overflow: "hidden",
    direction: "rtl",
    gap: 4,
  };

  return (
    <div style={containerStyle}>
      {/* Field display name — stored in element.name */}
      <div style={{
        fontSize: 11,
        color: "#605e5c",
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}>
        {element.name}
      </div>

      {/* Placeholder value — will be replaced by live data in Phase 2 */}
      <div style={{
        fontSize: 26,
        fontWeight: 700,
        color: s.color ?? "#201f1e",
        lineHeight: 1,
        flex: 1,
        display: "flex",
        alignItems: "center",
      }}>
        —
      </div>

      {/* Aggregation badge */}
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: s.borderColor ?? "#605e5c",
        flexShrink: 0,
      }}>
        {AGG_LABELS[config.agg] ?? config.agg}
      </div>
    </div>
  );
}
