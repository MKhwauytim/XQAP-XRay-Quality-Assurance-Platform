import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import type { ProcessingSummary, RemovedPopulationRow } from "../processing/populationProcessingTypes";
import { formatNumber, formatPercentage } from "./helpers";
import Pagination from "../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../utils/paginationUtils";
import { formatStageLabel } from "../../../../../data/population/stageHelpers";
import type { StageAliasMappings } from "../../../../../data/population/populationConfig";
import { useLabels } from "../../../../../data/labels/useLabels";
import type { Labels } from "../../../../../data/labels/labelsStore";

/** The handful of preview-row fields this component's table actually renders —
 *  intentionally narrower than `PreparedPopulationRow` so both a live, freshly
 *  processed result AND a locked month's persisted aggregate (which only ever
 *  carries this stub, see `POPULATION_AGGREGATE_PREVIEW_FIELDS`) can feed it. */
export type PopulationReportPreviewRow = {
  xrayImageId: string;
  sourceRowNumber: number;
  portName: string | null;
  stage: string | null;
  xrayLevelOneResult: string;
  xrayLevelTwoResult: string;
  certScanStatus: string;
};

type PopulationProcessingReportProps = {
  summary: ProcessingSummary;
  previewRows: PopulationReportPreviewRow[];
  /** W-owner-2026-08-12b: active stage alias mappings (defaults + admin overrides)
   *  used to render `previewRows[].stage` as its Arabic label (e.g. "المستوى
   *  الثالث") instead of the raw stored enum (e.g. "THIRD_STAGE"). Optional so
   *  existing callers/tests that predate this fix keep compiling; when omitted,
   *  `formatStageLabel` falls back to its own default mappings. */
  stageMappings?: Partial<StageAliasMappings>;
  /** W8: per-row detail for excluded-during-processing rows, previously only
   *  reachable via the removed "تقرير المعالجة" HTML export (which never actually
   *  showed per-row detail — only aggregate counts). Sourced directly from the
   *  in-memory processing result, no extra reads. Undefined for a locked month
   *  rendered from `populationAggregate` (which never carries these lists) —
   *  the section renders nothing in that case. */
  removedRows?: RemovedPopulationRow[];
  duplicateRows?: RemovedPopulationRow[];
  invalidResultRows?: RemovedPopulationRow[];
};

const DROPPED_ROWS_DISPLAY_CAP = 50;

function droppedRowKey(droppedRow: RemovedPopulationRow, index: number): string {
  return `${droppedRow.xrayImageId ?? "—"}-${droppedRow.sourceRowNumber ?? index}-${index}`;
}

/** Reads back the `[L1]` / `[L2]` / `[L1+L2]` tag `populationProcessor.ts`'s
 *  `describeInvalidLevelReason` stamps on every dropped-for-invalid-level-result
 *  row. Keep this regex in sync with that function's tag format. */
const INVALID_LEVEL_REASON_TAG = /^Invalid level result \[(L1\+L2|L1|L2)\]:\s*(.*)$/;

const INVALID_LEVEL_CAUSE_LABELS: Record<"L1" | "L2" | "L1+L2", string> = {
  L1: "المستوى الأول فقط (غير صالح/غير موجود)",
  L2: "المستوى الثاني فقط (غير صالح/غير موجود)",
  "L1+L2": "المستوى الأول والثاني معاً (غير صالحين/غير موجودين)",
};

type InvalidLevelCauseSummary = {
  tag: "L1" | "L2" | "L1+L2";
  label: string;
  count: number;
  examples: string[];
};

/** W8-diag: groups the invalid-level-result drops by which field(s) actually
 *  failed, so a 100%-drop run (the real-world bug this was built for — see
 *  the 2026-08-12 edit log) tells the user "every row is missing المستوى
 *  الأول" instead of just a bare count. Falls back to an "other" bucket for
 *  any reason string that predates the tagged format (e.g. a locked month's
 *  persisted aggregate saved before this change shipped). */
function summarizeInvalidLevelCauses(rows: RemovedPopulationRow[]): InvalidLevelCauseSummary[] {
  const buckets = new Map<string, { count: number; examples: string[] }>();

  // Deliberately NOT named `row`: populationAggregate.contract.test.ts scans
  // this file for `row.<field>` accesses and requires every one to exist on
  // POPULATION_AGGREGATE_PREVIEW_FIELDS (a Pick of PreparedPopulationRow).
  // These are RemovedPopulationRow, a different type — `reason` is not and
  // cannot be a preview field. Renaming keeps that contract strict rather than
  // giving it an exclusion list that would silently rot.
  for (const removed of rows) {
    const match = removed.reason.match(INVALID_LEVEL_REASON_TAG);
    const tag = (match?.[1] as "L1" | "L2" | "L1+L2" | undefined) ?? "other";
    const detail = match?.[2] ?? removed.reason;

    const bucket = buckets.get(tag) ?? { count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 3 && detail) {
      bucket.examples.push(detail);
    }
    buckets.set(tag, bucket);
  }

  const known: InvalidLevelCauseSummary[] = (["L1", "L2", "L1+L2"] as const)
    .filter((tag) => buckets.has(tag))
    .map((tag) => ({
      tag,
      label: INVALID_LEVEL_CAUSE_LABELS[tag],
      count: buckets.get(tag)!.count,
      examples: buckets.get(tag)!.examples,
    }));

  const other = buckets.get("other");
  if (other) {
    known.push({
      tag: "L1+L2",
      label: "سبب آخر (تنسيق قديم)",
      count: other.count,
      examples: other.examples,
    });
  }

  return known.sort((a, b) => b.count - a.count);
}

/** Renders the top invalid-level-result causes above the per-row drill-down —
 *  this is the "what's the single most common reason" answer a raw dropped-row
 *  table can't give at a glance. Renders nothing when there's nothing to
 *  summarize. Always visible (never behind a disclosure) per the 3b handoff. */
function InvalidLevelCauseSummarySection({ rows, labels }: { rows: RemovedPopulationRow[]; labels: Labels }) {
  if (rows.length === 0) return null;
  const causes = summarizeInvalidLevelCauses(rows);
  if (causes.length === 0) return null;

  return (
    <div className="p2-top-reasons">
      <strong className="p2-top-reasons-title">{labels.p2_excluded_top_reasons_title}</strong>
      <ul>
        {causes.map((cause) => (
          <li key={cause.tag + cause.label}>
            <span className="p2-top-reasons-label">{cause.label}</span>
            <strong className="p2-top-reasons-count">{formatNumber(cause.count)}</strong>
            {cause.examples.length > 0 && (
              <span className="p2-top-reasons-examples">
                {labels.p2_excluded_examples.replace("{examples}", cause.examples.join(" — "))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** W8: collapsible per-row drill-down for one exclusion category (invalid ID,
 *  duplicate, invalid level result). Renders nothing when there are no rows. */
function DroppedRowsCategory({ title, rows, labels }: { title: string; rows: RemovedPopulationRow[]; labels: Labels }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, DROPPED_ROWS_DISPLAY_CAP);
  const extra = rows.length - shown.length;
  return (
    <div className="dropped-rows-category">
      <button
        type="button"
        className="dropped-rows-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="dropped-rows-title">{title}</span>
        <span className="dropped-rows-count">{formatNumber(rows.length)}</span>
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div className="dropped-rows-table" role="table">
          <div className="dropped-rows-row dropped-rows-header" role="row">
            <span>{labels.p2_excluded_header_id}</span>
            <span>{labels.p2_excluded_header_port}</span>
            <span>{labels.p2_excluded_header_source_row}</span>
            <span>{labels.p2_excluded_header_source_sheet}</span>
            <span>{labels.p2_excluded_header_reason}</span>
          </div>
          {shown.map((droppedRow, index) => (
            <div key={droppedRowKey(droppedRow, index)} className="dropped-rows-row" role="row">
              <span>{droppedRow.xrayImageId ?? "—"}</span>
              <span>{droppedRow.portName ?? "—"}</span>
              <span>{droppedRow.sourceRowNumber ?? "—"}</span>
              <span>{droppedRow.sourceSheetName ?? "—"}</span>
              <span>{droppedRow.reason}</span>
            </div>
          ))}
          {extra > 0 && (
            <p className="dropped-rows-more">{labels.p2_excluded_more_rows.replace("{count}", formatNumber(extra))}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** W8: wraps the three exclusion categories; renders nothing when nothing was excluded. */
function DroppedRowsSection({
  summary,
  removedRows,
  duplicateRows,
  invalidResultRows,
  labels,
}: {
  summary: ProcessingSummary;
  removedRows?: RemovedPopulationRow[];
  duplicateRows?: RemovedPopulationRow[];
  invalidResultRows?: RemovedPopulationRow[];
  labels: Labels;
}) {
  const hasAny =
    (removedRows?.length ?? 0) + (duplicateRows?.length ?? 0) + (invalidResultRows?.length ?? 0) > 0;
  if (!hasAny) return null;
  const total =
    summary.duplicateRiskIdRows + summary.removedInvalidResultRows + summary.invalidRiskIdRows;
  return (
    <div className="dropped-rows-section p2-panel p2-panel-padded">
      <div className="p2-panel-head p2-panel-head-flush">
        <h4>{labels.p2_excluded_title}</h4>
        <span className="p2-danger-badge">{formatNumber(total)}</span>
      </div>
      <DroppedRowsCategory title={labels.p2_excluded_duplicates} rows={duplicateRows ?? []} labels={labels} />
      <DroppedRowsCategory title={labels.p2_excluded_invalid_results} rows={invalidResultRows ?? []} labels={labels} />
      <DroppedRowsCategory title={labels.p2_excluded_invalid_ids} rows={removedRows ?? []} labels={labels} />
      <InvalidLevelCauseSummarySection rows={invalidResultRows ?? []} labels={labels} />
    </div>
  );
}

/** "تعبئة الخانات من BI" — the per-column BI fill table (3b left panel). */
function BiFillPanel({ summary, labels }: { summary: ProcessingSummary; labels: Labels }) {
  return (
    <div className="bi-fill-summary-section p2-panel">
      <div className="p2-panel-head">
        <h4>{labels.p2_bi_fill_title}</h4>
        <span className="p2-panel-head-meta">
          {labels.p2_bi_fill_total.replace("{count}", formatNumber(summary.totalBiFilledFields))}
        </span>
      </div>

      {summary.biFieldFillSummary.length === 0 ? (
        <p className="p2-panel-empty">{labels.p2_bi_fill_empty}</p>
      ) : (
        <div className="bi-fill-summary-table">
          <div className="bi-fill-summary-header">
            <span>{labels.p2_bi_fill_header_column}</span>
            <span className="p2-center">{labels.p2_bi_fill_header_empty_before}</span>
            <span className="p2-center">{labels.p2_bi_fill_header_filled}</span>
            <span>{labels.p2_bi_fill_header_percent}</span>
          </div>

          {summary.biFieldFillSummary.map((field) => (
            <div key={field.fieldName} className="bi-fill-summary-row">
              <span className="bi-fill-field">{field.fieldName}</span>
              <span className="p2-center p2-num">{formatNumber(field.riskEmptyBefore)}</span>
              <span className="p2-center p2-num p2-filled">{formatNumber(field.filledFromBi)}</span>
              <span className="bi-fill-bar-cell">
                <span className="bi-fill-bar-bg">
                  <span
                    className="bi-fill-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, field.fillPercentage))}%` }}
                  />
                </span>
                <span className="p2-num">{formatPercentage(field.fillPercentage)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PREVIEW_PAGE_SIZE = 10;

/**
 * Compact "معاينة المجتمع النهائي" preview (owner requirement, 2026-08-12):
 * a small summary strip reusing already-computed `ProcessingSummary` figures
 * (no new statistics) plus 10 example rows at a time, paged with the shared
 * `Pagination` component. Renders nothing when there are no preview rows —
 * a locked month whose aggregate predates this feature, or a freshly
 * processed month with zero final rows, both fall through here silently.
 *
 * 3b handoff: the whole table is now behind a disclosure that is COLLAPSED on
 * mount and remembers nothing across mounts (a plain `useState`, deliberately
 * not persisted).
 */
function PreparedPopulationPreviewSection({
  summary,
  previewRows,
  stageMappings,
  labels,
}: {
  summary: ProcessingSummary;
  previewRows: PopulationReportPreviewRow[];
  stageMappings?: Partial<StageAliasMappings>;
  labels: Labels;
}) {
  const [finalPreviewOpen, setFinalPreviewOpen] = useState(false);
  const [page, setPage] = useState(1);
  if (previewRows.length === 0) return null;

  const safePage = clampPage(page, previewRows.length, PREVIEW_PAGE_SIZE);
  const shown = pageSlice(previewRows, safePage, PREVIEW_PAGE_SIZE);

  const summaryLine = labels.p2_preview_summary
    .replace("{rows}", formatNumber(summary.finalPreparedPopulationRows))
    .replace("{certScan}", formatNumber(summary.certScanRows))
    .replace("{nonCertScan}", formatNumber(summary.nonCertScanRows));

  return (
    <div className="prepared-preview-section p2-panel">
      <button
        type="button"
        className="prepared-preview-toggle"
        aria-expanded={finalPreviewOpen}
        onClick={() => setFinalPreviewOpen((open) => !open)}
      >
        <span className="prepared-preview-chevron" aria-hidden="true">
          {finalPreviewOpen ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}
        </span>
        <h4>{labels.p2_preview_title}</h4>
        <span className="prepared-preview-summary">{summaryLine}</span>
        <span className="prepared-preview-hint">
          {finalPreviewOpen ? labels.p2_preview_collapse_hint : labels.p2_preview_expand_hint}
        </span>
      </button>

      {finalPreviewOpen && (
        <>
          <div className="prepared-preview-table">
            <div className="prepared-preview-header">
              <span>{labels.p2_preview_header_id}</span>
              <span>{labels.p2_preview_header_port}</span>
              <span>{labels.p2_preview_header_stage}</span>
              <span>{labels.p2_preview_header_level_one}</span>
              <span>{labels.p2_preview_header_level_two}</span>
              <span>{labels.p2_preview_header_certscan}</span>
            </div>

            {shown.map((row) => (
              <div key={`${row.xrayImageId}-${row.sourceRowNumber}`} className="prepared-preview-row">
                <span className="prepared-preview-id">{row.xrayImageId}</span>
                <span>{row.portName ?? ""}</span>
                <span>{formatStageLabel(row.stage, stageMappings)}</span>
                <span>{row.xrayLevelOneResult}</span>
                <span>{row.xrayLevelTwoResult}</span>
                <span>{row.certScanStatus}</span>
              </div>
            ))}
          </div>

          <Pagination
            page={safePage}
            totalItems={previewRows.length}
            onPageChange={setPage}
            pageSize={PREVIEW_PAGE_SIZE}
            itemLabel="صف"
          />
        </>
      )}
    </div>
  );
}

export default function PopulationProcessingReport({
  summary,
  previewRows,
  stageMappings,
  removedRows,
  duplicateRows,
  invalidResultRows,
}: PopulationProcessingReportProps) {
  const labels = useLabels();

  return (
    <section className="population-processing-result">
      <div className="p2-fill-exclusion-row">
        <BiFillPanel summary={summary} labels={labels} />
        <DroppedRowsSection
          summary={summary}
          removedRows={removedRows}
          duplicateRows={duplicateRows}
          invalidResultRows={invalidResultRows}
          labels={labels}
        />
      </div>

      <PreparedPopulationPreviewSection
        summary={summary}
        previewRows={previewRows}
        stageMappings={stageMappings}
        labels={labels}
      />
    </section>
  );
}
