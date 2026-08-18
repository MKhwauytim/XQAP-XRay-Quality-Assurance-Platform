import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, Info, Search } from "lucide-react";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import type { NormalizedBiRow } from "../biData/biDataTypes";
import Pagination from "../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../utils/paginationUtils";
import { formatNumber } from "../../../../../utils/formatting";
import { useLabels } from "../../../../../data/labels/useLabels";
import {
  compareAccuracyAsync,
  displayForCol,
  severityOf,
  type AccuracyCompareResult,
  type ColStat,
} from "./dataAccuracyCompare";
import "./DataAccuracyReport.css";

// ── verdict card ──────────────────────────────────────────────────────────────

/**
 * The 300px "دقة البيانات الكلية" card of the 3b verdict row. Exported so
 * `PhaseTwoReportAndProcessing` can place it beside the processing-result card
 * in one `300px minmax(0,1fr)` grid; `DataAccuracyReport` renders it inline
 * itself when it is used standalone.
 */
export function AccuracyVerdictCard({ result }: { result: AccuracyCompareResult }) {
  const labels = useLabels();
  const mismatchCols = result.colStats.filter(c => c.mismatched > 0);
  const worst = mismatchCols.reduce<ColStat | null>(
    (acc, c) => (acc === null || c.accuracy < acc.accuracy ? c : acc),
    null,
  );

  const sentence = worst
    ? labels.p2_accuracy_worst_sentence
        .replace("{mismatched}", formatNumber(mismatchCols.length))
        .replace("{total}", formatNumber(result.colStats.length))
        .replace("{column}", worst.label)
        .replace("{accuracy}", formatNumber(worst.accuracy))
    : labels.p2_accuracy_all_match_sentence.replace("{total}", formatNumber(result.colStats.length));

  return (
    <div className={`dar-verdict ${result.overallAccuracy === 100 ? "is-perfect" : "is-degraded"}`}>
      <span className="dar-verdict-label">{labels.p2_accuracy_title}</span>
      <div className="dar-verdict-value-row">
        <strong className="dar-verdict-value">{formatNumber(result.overallAccuracy)}%</strong>
        <span className="dar-verdict-value-sub">
          {labels.p2_accuracy_comparisons.replace("{count}", formatNumber(result.totalComparisons))}
        </span>
      </div>
      <div className="dar-verdict-bar">
        <div className="dar-verdict-bar-fill" style={{ width: `${result.overallAccuracy}%` }} />
      </div>
      <p className="dar-verdict-sentence">{sentence}</p>
      <div className="dar-verdict-rows">
        <span className="dar-kpi">
          <span className="dar-kpi-label">{labels.p2_accuracy_matched_ids}</span>
          <strong className="dar-kpi-value">{formatNumber(result.matchedIds)}</strong>
        </span>
        <span className="dar-kpi">
          <span className="dar-kpi-label">{labels.p2_accuracy_only_in_risk}</span>
          <strong className="dar-kpi-value warn">{formatNumber(result.onlyInRisk)}</strong>
        </span>
        <span className="dar-kpi">
          <span className="dar-kpi-label">{labels.p2_accuracy_rows_with_mismatch}</span>
          <strong className="dar-kpi-value danger">{formatNumber(result.rowsWithMismatch)}</strong>
        </span>
      </div>
    </div>
  );
}

// ── column accuracy rows ──────────────────────────────────────────────────────

function ColumnAccuracyRow({
  col,
  onInspect,
}: {
  col: ColStat;
  onInspect?: (colKey: string) => void;
}) {
  const labels = useLabels();
  const severity = severityOf(col.accuracy);
  return (
    <div className={`dar-col-row sev-${severity}`}>
      <span className="dar-col-name">
        <span className="dar-col-dot" aria-hidden="true" />
        {col.label}
      </span>
      <span className="dar-col-num">{formatNumber(col.matched)}</span>
      <span className="dar-miss-num">{formatNumber(col.mismatched)}</span>
      <span className="dar-acc-pct">{formatNumber(col.accuracy)}%</span>
      <span className="dar-acc-bar-wrap">
        <span className="dar-acc-bar-bg">
          <span className="dar-acc-bar-fill" style={{ width: `${col.accuracy}%` }} />
        </span>
        {onInspect && col.mismatched > 0 && (
          <button type="button" className="dar-inspect-link" onClick={() => onInspect(col.key)}>
            {labels.p2_col_inspect}
          </button>
        )}
      </span>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

const EMPTY_ACCURACY_RESULT: AccuracyCompareResult = {
  totalRiskRows: 0,
  matchedIds: 0,
  onlyInRisk: 0,
  onlyInBi: 0,
  rowsWithMismatch: 0,
  totalComparisons: 0,
  totalMismatches: 0,
  overallAccuracy: 100,
  colStats: [],
  mismatches: [],
};

export default function DataAccuracyReport({
  riskRows,
  biRows,
  result: precomputed,
  verdictHoisted = false,
}: {
  riskRows: NormalizedRiskRow[];
  biRows:   NormalizedBiRow[];
  /** Comparison already computed by the parent (PhaseTwo hoists it so the
   *  verdict card and this report share one pass over the rows). */
  result?:  AccuracyCompareResult;
  /** True when the parent renders `AccuracyVerdictCard` itself. */
  verdictHoisted?: boolean;
}) {
  const labels = useLabels();

  // Fix (population, 2026-08-18): the production caller (PhaseTwoReportAndProcessing)
  // always hoists `precomputed`, so this fallback normally never runs -- but it used
  // to run the comparison fully synchronously, which is exactly the "app freezes
  // after a Phase 1 upload" bug for any caller that DOESN'T hoist. Runs the same
  // chunked async comparison PhaseTwoReportAndProcessing now uses, so a future or
  // untested call site can't reintroduce the freeze. `computedFallback` starts as
  // an all-zero placeholder (not null) so every hook below it keeps operating on a
  // real AccuracyCompareResult shape while the async pass is in flight.
  const [fallback, setFallback] = useState<{
    risk: NormalizedRiskRow[];
    bi: NormalizedBiRow[];
    result: AccuracyCompareResult;
  } | null>(null);
  // Stored WITH the rows it was computed from and read back only when those
  // still match, so "inputs changed, result not in yet" is derived rather than
  // set — no stale comparison for even one render, and no synchronous setState
  // inside the effect.
  const fallbackResult =
    fallback && fallback.risk === riskRows && fallback.bi === biRows ? fallback.result : null;
  const isComputingFallback = !precomputed && fallbackResult === null;

  useEffect(() => {
    if (precomputed) return;
    let cancelled = false;
    compareAccuracyAsync(riskRows, biRows).then((result) => {
      if (cancelled) return;
      setFallback({ risk: riskRows, bi: biRows, result });
    });
    return () => { cancelled = true; };
  }, [precomputed, riskRows, biRows]);

  const result = precomputed ?? fallbackResult ?? EMPTY_ACCURACY_RESULT;

  const [search, setSearch] = useState("");
  const [activeMismatchColumn, setActiveMismatchColumn] = useState<string>("all");
  const [showMatchedColumns, setShowMatchedColumns] = useState(false);
  // Owner request (2026-08-18): collapsed by default, same disclosure pattern
  // as the final-population preview at the end of the page. Remembers nothing.
  const [detailOpen, setDetailOpen] = useState(false);

  const mismatchCols = useMemo(
    () => result.colStats.filter(c => c.mismatched > 0).sort((a, b) => a.accuracy - b.accuracy),
    [result.colStats],
  );
  const matchedCols = useMemo(() => result.colStats.filter(c => c.mismatched === 0), [result.colStats]);

  // Fix (population, 2026-08-18): `activeMismatchColumn` used to be read raw,
  // so a chip picked on one month's data (e.g. a column that only mismatches
  // this month) silently pointed at nothing after a month switch or a
  // reprocess -- the table would show "no rows match" with no visible sign a
  // filter was even active, easy to mistake for genuinely clean data. Same
  // stale-selection shape `pageState`/`resultPageKey` below already guards
  // against for pagination; this falls back to "all" the same way once the
  // selected column no longer appears in the current mismatch set.
  const effectiveMismatchColumn = useMemo(
    () =>
      activeMismatchColumn === "all" || mismatchCols.some(c => c.key === activeMismatchColumn)
        ? activeMismatchColumn
        : "all",
    [activeMismatchColumn, mismatchCols],
  );

  const resultPageKey = `${result.mismatches.length}:${result.mismatches[0]?.xrayImageId ?? ""}:${result.mismatches.at(-1)?.xrayImageId ?? ""}`;
  const [pageState, setPageState] = useState<{ resultKey: string; page: number }>(() => ({ resultKey: resultPageKey, page: 1 }));

  const filtered = useMemo(() => {
    let rows = result.mismatches;
    if (effectiveMismatchColumn !== "all") rows = rows.filter(m => m.colKey === effectiveMismatchColumn);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(m =>
        m.xrayImageId.toLowerCase().includes(q) ||
        (m.riskValue ?? "").toLowerCase().includes(q) ||
        (m.biValue ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [result.mismatches, effectiveMismatchColumn, search]);

  const page = clampPage(pageState.resultKey === resultPageKey ? pageState.page : 1, filtered.length);
  const paginated = pageSlice(filtered, page);

  function handleSearch(v: string) { setSearch(v); setPageState({ resultKey: resultPageKey, page: 1 }); }
  function handleColumnChip(colKey: string) {
    setActiveMismatchColumn(colKey);
    setPageState({ resultKey: resultPageKey, page: 1 });
  }

  return (
    <div className="dar-root">

      {isComputingFallback && (
        <div className="upload-warning" role="status">{labels.p2_accuracy_computing}</div>
      )}

      {!verdictHoisted && <AccuracyVerdictCard result={result} />}

      {/* ── Columns with a mismatch (matched columns behind a toggle) ── */}
      <div className="dar-col-table">
        <div className="dar-col-table-head">
          <h3 className="dar-col-table-title">{labels.p2_mismatch_columns_title}</h3>
          <span className="dar-col-table-badge">
            {labels.p2_mismatch_columns_badge
              .replace("{mismatched}", formatNumber(mismatchCols.length))
              .replace("{total}", formatNumber(result.colStats.length))}
          </span>
          {matchedCols.length > 0 && (
            <button
              type="button"
              className="dar-matched-toggle"
              aria-expanded={showMatchedColumns}
              onClick={() => setShowMatchedColumns(v => !v)}
            >
              {showMatchedColumns
                ? labels.p2_mismatch_columns_hide_matched
                : labels.p2_mismatch_columns_show_matched.replace("{count}", formatNumber(matchedCols.length))}
              {showMatchedColumns ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          )}
        </div>

        <div className="dar-col-header">
          <span>{labels.p2_col_header_column}</span>
          <span className="dar-col-center">{labels.p2_col_header_matched}</span>
          <span className="dar-col-center">{labels.p2_col_header_mismatched}</span>
          <span className="dar-col-center">{labels.p2_col_header_accuracy}</span>
          <span />
        </div>

        {mismatchCols.length === 0 ? (
          <div className="dar-empty">{labels.p2_mismatch_columns_none}</div>
        ) : (
          mismatchCols.map(col => (
            <ColumnAccuracyRow key={col.key} col={col} onInspect={handleColumnChip} />
          ))
        )}

        {showMatchedColumns && matchedCols.map(col => (
          <ColumnAccuracyRow key={col.key} col={col} />
        ))}
      </div>

      {/* ── Mismatch detail table — a disclosure, collapsed on mount ── */}
      <div className="dar-detail">
        <button
          type="button"
          className="dar-detail-disclosure"
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((open) => !open)}
        >
          <span className="dar-detail-chevron" aria-hidden="true">
            {detailOpen ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
          </span>
          <h3 className="dar-detail-title">{labels.p2_details_title}</h3>
          <span className="dar-detail-summary">
            {labels.p2_details_summary.replace("{count}", formatNumber(result.totalMismatches))}
          </span>
          <span className="dar-detail-hint">
            {detailOpen ? labels.p2_preview_collapse_hint : labels.p2_preview_expand_hint}
          </span>
        </button>

        {detailOpen && (<>
        <div className="dar-detail-toolbar">
          <span className="dar-count-chip">{formatNumber(filtered.length)}</span>
          <label className="dar-search-field">
            <Search size={14} aria-hidden="true" />
            <input
              type="text"
              className="dar-search-input"
              aria-label={labels.p2_details_search_aria}
              placeholder={labels.p2_details_search_placeholder}
              value={search}
              onChange={e => handleSearch(e.target.value)}
              dir="rtl"
            />
          </label>
          <div className="dar-chip-row" role="group" aria-label={labels.p2_details_chips_aria}>
            <button
              type="button"
              className={`dar-chip${effectiveMismatchColumn === "all" ? " active" : ""}`}
              aria-pressed={effectiveMismatchColumn === "all"}
              onClick={() => handleColumnChip("all")}
            >
              {labels.p2_details_chip_all}
            </button>
            {mismatchCols.map(col => (
              <button
                key={col.key}
                type="button"
                className={`dar-chip${effectiveMismatchColumn === col.key ? " active" : ""}`}
                aria-pressed={effectiveMismatchColumn === col.key}
                onClick={() => handleColumnChip(col.key)}
              >
                {col.label} <span className="dar-chip-count">{formatNumber(col.mismatched)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dar-normalization-note">
          <Info size={14} aria-hidden="true" />
          <span>{labels.p2_details_normalization_note}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="dar-empty">
            {result.mismatches.length === 0
              ? <><CheckCircle2 size={16} className="dar-empty-icon" aria-hidden="true" /> {labels.p2_details_empty_all_match}</>
              : labels.p2_details_empty_filtered}
          </div>
        ) : (
          <>
            <div className="dar-detail-header">
              <span>{labels.p2_details_header_id}</span>
              <span>{labels.p2_details_header_column}</span>
              <span>{labels.p2_details_header_risk}</span>
              <span>{labels.p2_details_header_bi}</span>
            </div>
            {paginated.map((m, i) => {
              const riskDisplay = displayForCol(m.riskValue, m.colKey, "risk");
              const biDisplay = displayForCol(m.biValue, m.colKey, "bi");
              return (
                <div key={`${m.xrayImageId}-${m.colKey}-${i}`} className="dar-detail-row">
                  <span className="dar-id">{m.xrayImageId}</span>
                  <span className="dar-col">{m.colLabel}</span>
                  <span className={`dar-val tone-${riskDisplay.tone}`}>{riskDisplay.text}</span>
                  <span className={`dar-val tone-${biDisplay.tone}`}>{biDisplay.text}</span>
                </div>
              );
            })}
            <Pagination page={page} totalItems={filtered.length} onPageChange={(nextPage) => setPageState({ resultKey: resultPageKey, page: nextPage })} itemLabel="اختلاف" />
          </>
        )}
        </>)}
      </div>
    </div>
  );
}
