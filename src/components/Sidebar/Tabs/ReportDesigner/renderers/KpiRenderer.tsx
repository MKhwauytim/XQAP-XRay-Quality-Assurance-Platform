import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Element, KpiConfig } from "../../../../../data/reportDesigner/reportTypes";
import { useWorkspace } from "../../../../../data/workspace/useWorkspace";
import { listMonthFolders, loadMonthPopulationFinal } from "../../../../../data/population/populationStorage";

const AGG_LABELS: Record<string, string> = {
  count: "عدد",
  distinctCount: "عدد مميز",
  sum: "مجموع",
  avg: "متوسط",
  min: "أدنى",
  max: "أقصى",
  percentOfTotal: "نسبة",
};

function computeAgg(rows: Array<Record<string, unknown>>, field: string, agg: string): number | null {
  const vals = rows.map((r) => r[field]);
  switch (agg) {
    case "count":
      return vals.filter((v) => v != null).length;
    case "distinctCount":
      return new Set(vals.filter((v) => v != null).map(String)).size;
    case "sum":
      return vals.reduce<number>((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
    case "avg": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    case "min": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return nums.length ? Math.min(...nums) : null;
    }
    case "max": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return nums.length ? Math.max(...nums) : null;
    }
    default:
      return null;
  }
}

function useKpiValue(config: KpiConfig): string {
  const { directoryHandle } = useWorkspace();
  const [display, setDisplay] = useState<string>("—");

  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;

    async function load() {
      const months = await listMonthFolders(directoryHandle!);
      if (months.length === 0 || cancelled) return;
      const latest = months[months.length - 1];
      const data = await loadMonthPopulationFinal(directoryHandle!, latest.folderName);
      if (!data || cancelled) return;
      const result = computeAgg(data.rows, config.valueField, config.agg);
      if (!cancelled) {
        setDisplay(result != null ? result.toLocaleString("ar-SA") : "—");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [directoryHandle, config.valueField, config.agg]);

  return display;
}

interface KpiRendererProps {
  element: Element;
}

export default function KpiRenderer({ element }: KpiRendererProps) {
  const config = element.config as KpiConfig;
  const s = element.style;
  const value = useKpiValue(config);

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
      {/* Field display name */}
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

      {/* Live aggregated value from population data */}
      <div style={{
        fontSize: 26,
        fontWeight: 700,
        color: s.color ?? "#201f1e",
        lineHeight: 1,
        flex: 1,
        display: "flex",
        alignItems: "center",
      }}>
        {value}
      </div>

      {/* Aggregation label */}
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
