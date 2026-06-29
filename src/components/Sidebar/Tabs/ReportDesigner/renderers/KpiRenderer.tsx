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

function toLabel(v: unknown): string {
  if (v === true || v === "true") return "نعم";
  if (v === false || v === "false") return "لا";
  if (v == null) return "";
  return String(v);
}

type KpiResult =
  | { kind: "number"; value: number }
  | { kind: "tags"; values: string[] }
  | { kind: "breakdown"; rows: Array<{ label: string; count: number }>; total: number };

function computeResult(rows: Array<Record<string, unknown>>, config: KpiConfig): KpiResult {
  const field = config.valueField;
  const vals = rows.map((r) => r[field]);

  // Grouped breakdown: count of main field grouped by another dimension
  if (config.groupByField) {
    const groupBy = config.groupByField;
    const map = new Map<string, number>();
    for (const r of rows) {
      const gv = r[groupBy];
      if (gv == null) continue;
      const key = toLabel(gv);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
    return { kind: "breakdown", rows: sorted, total: rows.length };
  }

  switch (config.agg) {
    case "count":
      return { kind: "number", value: vals.filter((v) => v != null).length };
    case "distinctCount": {
      const unique = Array.from(new Set(vals.filter((v) => v != null).map(toLabel)));
      if (unique.length <= 8) return { kind: "tags", values: unique };
      return { kind: "number", value: unique.length };
    }
    case "sum":
      return { kind: "number", value: vals.reduce<number>((acc, v) => acc + (typeof v === "number" ? v : 0), 0) };
    case "avg": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return { kind: "number", value: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
    }
    case "min": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return { kind: "number", value: nums.length ? Math.min(...nums) : 0 };
    }
    case "max": {
      const nums = vals.filter((v) => v != null).map(Number).filter((n) => !isNaN(n));
      return { kind: "number", value: nums.length ? Math.max(...nums) : 0 };
    }
    default:
      return { kind: "number", value: 0 };
  }
}

function usePopulationData(): Array<Record<string, unknown>> | null {
  const { directoryHandle } = useWorkspace();
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);

  useEffect(() => {
    if (!directoryHandle) return;
    let cancelled = false;
    async function load() {
      const months = await listMonthFolders(directoryHandle!);
      if (months.length === 0 || cancelled) return;
      const latest = months[months.length - 1];
      const pop = await loadMonthPopulationFinal(directoryHandle!, latest.folderName);
      if (!cancelled) setRows(pop ? pop.rows : null);
    }
    void load();
    return () => { cancelled = true; };
  }, [directoryHandle]);

  return rows;
}

interface KpiRendererProps {
  element: Element;
}

export default function KpiRenderer({ element }: KpiRendererProps) {
  const config = element.config as KpiConfig;
  const s = element.style;
  const rows = usePopulationData();

  const result: KpiResult = rows ? computeResult(rows, config) : { kind: "number", value: -1 };
  const isLoading = rows === null;
  const accentColor = s.borderColor ?? "#0078d4";

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px",
    background: s.fill ?? "#f3f2f1",
    border: `${s.borderWidth ?? 1}px solid ${accentColor}`,
    borderRadius: 4,
    overflow: "hidden",
    direction: "rtl",
    gap: 4,
  };

  return (
    <div style={containerStyle}>
      {/* Field name + optional groupBy label */}
      <div style={{ fontSize: 11, color: "#605e5c", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
        {element.name}
        {config.groupByLabel && (
          <span style={{ color: accentColor, marginRight: 4 }}>÷ {config.groupByLabel}</span>
        )}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>

        {isLoading && (
          <span style={{ fontSize: 20, color: "#a19f9d" }}>—</span>
        )}

        {!isLoading && result.kind === "number" && (
          <span style={{ fontSize: 26, fontWeight: 700, color: s.color ?? "#201f1e", lineHeight: 1 }}>
            {result.value.toLocaleString("ar-SA")}
          </span>
        )}

        {/* distinctCount: show unique values as colored chips when ≤ 8 */}
        {!isLoading && result.kind === "tags" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {result.values.map((v) => (
              <span key={v} style={{
                fontSize: 11, fontWeight: 600,
                background: accentColor + "22",
                color: accentColor,
                borderRadius: 3,
                padding: "2px 6px",
                border: `1px solid ${accentColor}55`,
              }}>
                {v}
              </span>
            ))}
          </div>
        )}

        {/* groupBy breakdown: mini bar list */}
        {!isLoading && result.kind === "breakdown" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
            {result.rows.slice(0, 5).map(({ label, count }) => {
              const pct = result.total > 0 ? (count / result.total) * 100 : 0;
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 10, color: "#605e5c", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </span>
                  <div style={{ width: 36, height: 4, background: accentColor + "22", borderRadius: 2, flexShrink: 0 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: accentColor, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: accentColor, flexShrink: 0, minWidth: 16, textAlign: "left" }}>
                    {count.toLocaleString("ar-SA")}
                  </span>
                </div>
              );
            })}
            {result.rows.length > 5 && (
              <span style={{ fontSize: 9, color: "#a19f9d" }}>+{result.rows.length - 5} أخرى</span>
            )}
          </div>
        )}
      </div>

      {/* Aggregation badge */}
      <div style={{ fontSize: 10, fontWeight: 600, color: accentColor, flexShrink: 0 }}>
        {AGG_LABELS[config.agg] ?? config.agg}
      </div>
    </div>
  );
}
