import type { CSSProperties } from "react";
import type { Element, KpiConfig } from "../../../../../data/reportDesigner/reportTypes";
import { aggregateOrNull } from "../../../../../data/reportDesigner/query/aggregations";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { Labels } from "../../../../../data/labels/labelsStore";
import { useExecutiveRows, type ExecutiveRow } from "./executiveRowsContext";

function aggBadgeLabels(labels: Labels): Record<string, string> {
  return {
    count: labels.rd_agg_count,
    distinctCount: labels.rd_agg_distinct_count,
    sum: labels.rd_agg_sum,
    avg: labels.rd_agg_avg,
    min: labels.rd_agg_badge_min,
    max: labels.rd_agg_badge_max,
    percentOfTotal: labels.rd_agg_badge_percent,
  };
}

function toLabel(v: unknown, labels: Labels): string {
  if (v === true || v === "true") return labels.rd_bool_yes;
  if (v === false || v === "false") return labels.rd_bool_no;
  if (v == null) return "";
  return String(v);
}

type KpiResult =
  | { kind: "number"; value: number }
  | { kind: "tags"; values: string[] }
  | { kind: "breakdown"; rows: Array<{ label: string; count: number }>; total: number };

/**
 * The tile's value, or `null` when there is nothing honest to show: no groups, no
 * distinct values, or an aggregation with no denominator (see `aggregateOrNull`).
 * `null` renders as «—», the same neutral marker the rest of the app's KPI surfaces
 * use — never a 0 that reads as a measured result.
 *
 * `rows` is non-empty by construction: the caller only reaches here in the `loaded`
 * state, and `loaded` guarantees at least one row.
 */
function computeResult(rows: ExecutiveRow[], config: KpiConfig, labels: Labels): KpiResult | null {
  const field = config.valueField;
  const vals = rows.map((r) => r[field]);

  // Grouped breakdown: count of main field grouped by another dimension
  if (config.groupByField) {
    const groupBy = config.groupByField;
    const map = new Map<string, number>();
    for (const r of rows) {
      const gv = r[groupBy];
      if (gv == null) continue;
      const key = toLabel(gv, labels);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
    // Every row's groupBy value was null/absent → no breakdown to draw. Previously
    // this rendered an empty box; «—» says "nothing to show" out loud.
    if (sorted.length === 0) return null;
    return { kind: "breakdown", rows: sorted, total: rows.length };
  }

  // distinctCount with small cardinality → render the distinct values as chips.
  if (config.agg === "distinctCount") {
    const unique = Array.from(new Set(vals.filter((v) => v != null).map((v) => toLabel(v, labels))));
    if (unique.length === 0) return null;
    if (unique.length <= 8) return { kind: "tags", values: unique };
    return { kind: "number", value: unique.length };
  }

  // All other aggregations delegate to the shared report-designer aggregator so
  // KPI cards match the rest of the report engine exactly. «نسبة من الإجمالي»
  // (percentOfTotal) needs an explicit denominator — the total row count, since a KPI
  // tile always spans the whole fact row set — otherwise it short-circuits to 0 and
  // the tile shows a fabricated zero instead of the share.
  const value = aggregateOrNull(config.agg, vals, rows.length);
  return value === null ? null : { kind: "number", value };
}

interface KpiRendererProps {
  element: Element;
}

export default function KpiRenderer({ element }: KpiRendererProps) {
  const labels = useLabels();
  const config = element.config as KpiConfig;
  const s = element.style;
  const rows = useExecutiveRows();

  // Three-state read (see executiveRowsContext): only `loaded` — which guarantees at
  // least one fact row — can produce a number. `loading` and `loaded-empty` both fall
  // through to the «—» marker below, rather than a fabricated 0 for a month whose data
  // has not arrived, is empty, or failed to load.
  const result: KpiResult | null = rows.status === "loaded" ? computeResult(rows.rows, config, labels) : null;
  const AGG_LABELS = aggBadgeLabels(labels);
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

        {result === null && (
          <span style={{ fontSize: 20, color: "#a19f9d" }}>—</span>
        )}

        {result !== null && result.kind === "number" && (
          <span style={{ fontSize: 26, fontWeight: 700, color: s.color ?? "#201f1e", lineHeight: 1 }}>
            {/* App standard is Latin (Western) digits — "ar-SA-u-nu-latn" — not the
                Arabic-Indic digits plain "ar-SA" yields (audit C-10 / B6). */}
            {result.value.toLocaleString("ar-SA-u-nu-latn")}
          </span>
        )}

        {/* distinctCount: show unique values as colored chips when ≤ 8 */}
        {result !== null && result.kind === "tags" && (
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
        {result !== null && result.kind === "breakdown" && (
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
                    {count.toLocaleString("ar-SA-u-nu-latn")}
                  </span>
                </div>
              );
            })}
            {result.rows.length > 5 && (
              <span style={{ fontSize: 9, color: "#a19f9d" }}>+{result.rows.length - 5} {labels.rd_more_suffix}</span>
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
