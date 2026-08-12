import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ProcessingSummary, RemovedPopulationRow } from "../processing/populationProcessingTypes";
import { formatNumber, formatPercentage } from "./helpers";
import SummaryCard from "./SummaryCard";
import Pagination from "../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../utils/paginationUtils";

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
 *  summarize. */
function InvalidLevelCauseSummarySection({ rows }: { rows: RemovedPopulationRow[] }) {
  if (rows.length === 0) return null;
  const causes = summarizeInvalidLevelCauses(rows);
  if (causes.length === 0) return null;

  return (
    <div className="invalid-level-cause-summary">
      <h5>أكثر أسباب استبعاد نتائج المستوى شيوعاً</h5>
      <ul>
        {causes.map((cause) => (
          <li key={cause.tag + cause.label}>
            <span className="invalid-level-cause-label">{cause.label}</span>
            <span className="invalid-level-cause-count">{formatNumber(cause.count)} صف</span>
            {cause.examples.length > 0 && (
              <span className="invalid-level-cause-examples">
                أمثلة: {cause.examples.join(" — ")}
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
function DroppedRowsCategory({ title, rows }: { title: string; rows: RemovedPopulationRow[] }) {
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
        <span>{title}</span>
        <span className="dropped-rows-count">{formatNumber(rows.length)}</span>
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div className="dropped-rows-table" role="table">
          <div className="dropped-rows-row dropped-rows-header" role="row">
            <span>معرف الأشعة</span>
            <span>اسم المنفذ</span>
            <span>رقم الصف المصدر</span>
            <span>الورقة المصدر</span>
            <span>السبب</span>
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
            <p className="dropped-rows-more">+{formatNumber(extra)} صفاً إضافياً — التصدير الكامل متاح عبر زر تصدير Excel أعلاه.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** W8: wraps the three exclusion categories; renders nothing when nothing was excluded. */
function DroppedRowsSection({
  removedRows,
  duplicateRows,
  invalidResultRows,
}: {
  removedRows?: RemovedPopulationRow[];
  duplicateRows?: RemovedPopulationRow[];
  invalidResultRows?: RemovedPopulationRow[];
}) {
  const hasAny =
    (removedRows?.length ?? 0) + (duplicateRows?.length ?? 0) + (invalidResultRows?.length ?? 0) > 0;
  if (!hasAny) return null;
  return (
    <div className="dropped-rows-section">
      <h4>تفاصيل الصفوف المستبعدة</h4>
      <DroppedRowsCategory title="معرفات غير صالحة" rows={removedRows ?? []} />
      <DroppedRowsCategory title="مكررات مستبعدة" rows={duplicateRows ?? []} />
      <InvalidLevelCauseSummarySection rows={invalidResultRows ?? []} />
      <DroppedRowsCategory title="نتائج مستوى غير صالحة" rows={invalidResultRows ?? []} />
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
 */
function PreparedPopulationPreviewSection({
  summary,
  previewRows,
}: {
  summary: ProcessingSummary;
  previewRows: PopulationReportPreviewRow[];
}) {
  const [page, setPage] = useState(1);
  if (previewRows.length === 0) return null;

  const safePage = clampPage(page, previewRows.length, PREVIEW_PAGE_SIZE);
  const shown = pageSlice(previewRows, safePage, PREVIEW_PAGE_SIZE);

  return (
    <div className="prepared-preview-section">
      <h4>معاينة المجتمع النهائي</h4>

      <div className="processing-summary-grid prepared-preview-stats">
        <SummaryCard label="المجتمع النهائي" value={summary.finalPreparedPopulationRows} />
        <SummaryCard label="CertScan" value={summary.certScanRows} />
        <SummaryCard label="NonCertScan" value={summary.nonCertScanRows} />
      </div>

      <div className="prepared-preview-table">
        <div className="prepared-preview-header">
          <span>معرف الأشعة</span>
          <span>اسم المنفذ</span>
          <span>المستوى</span>
          <span>المستوى الأول</span>
          <span>المستوى الثاني</span>
          <span>CertScan</span>
        </div>

        {shown.map((row) => (
          <div key={`${row.xrayImageId}-${row.sourceRowNumber}`} className="prepared-preview-row">
            <span>{row.xrayImageId}</span>
            <span>{row.portName ?? ""}</span>
            <span>{row.stage ?? ""}</span>
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
    </div>
  );
}

export default function PopulationProcessingReport({
  summary,
  previewRows,
  removedRows,
  duplicateRows,
  invalidResultRows,
}: PopulationProcessingReportProps) {

  const totalExcludedAfterProcessing =
    summary.duplicateRiskIdRows +
    summary.removedInvalidResultRows +
    summary.invalidRiskIdRows;

  return (
    <section className="population-processing-result">
      <div className="processing-summary-grid">
        <SummaryCard
          label="المجتمع النهائي"
          value={summary.finalPreparedPopulationRows}
        />

        <SummaryCard
          label="إجمالي المستبعد بعد المعالجة"
          value={totalExcludedAfterProcessing}
        />

        <SummaryCard
          label="المكررات المستبعدة"
          value={summary.duplicateRiskIdRows}
        />

        <SummaryCard
          label="نتائج غير صالحة"
          value={summary.removedInvalidResultRows}
        />

        <SummaryCard label="CertScan" value={summary.certScanRows} />
        <SummaryCard label="NonCertScan" value={summary.nonCertScanRows} />
        <SummaryCard label="مطابقة BI" value={summary.biMatchedRows} />
        <SummaryCard label="تعبئة من BI" value={summary.totalBiFilledFields} />

        <SummaryCard
          label="معرفات غير صالحة"
          value={summary.invalidRiskIdRows}
        />
      </div>

      <div className="processing-detail-grid">
        <article className="processing-detail-card">
          <h4>نسب CertScan</h4>
          <p>CertScan: {formatPercentage(summary.certScanPercentage)}</p>
          <p>NonCertScan: {formatPercentage(summary.nonCertScanPercentage)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>مطابقة ذكاء الأعمال</h4>
          <p>تم رفع BI: {summary.biProvided ? "نعم" : "لا"}</p>
          <p>نسبة المطابقة: {formatPercentage(summary.biMatchPercentage)}</p>
          <p>غير مطابق: {formatNumber(summary.biUnmatchedRows)}</p>
        </article>

        <article className="processing-detail-card">
          <h4>تنظيف بيانات وكالة المخاطر</h4>
          <p>الأصلية: {formatNumber(summary.riskOriginalRows)}</p>
          <p>بعد حذف المكررات: {formatNumber(summary.rowsAfterDeduplication)}</p>
          <p>النهائية: {formatNumber(summary.finalPreparedPopulationRows)}</p>
        </article>
      </div>

      <div className="bi-fill-summary-section">
        <h4>ملخص تعبئة الخانات من BI</h4>

        <div className="bi-fill-summary-table">
          <div className="bi-fill-summary-header">
            <span>العمود</span>
            <span>فارغ قبل BI</span>
            <span>تمت تعبئته</span>
            <span>بقي فارغاً</span>
            <span>نسبة التعبئة</span>
          </div>

          {summary.biFieldFillSummary.map((field) => (
            <div key={field.fieldName} className="bi-fill-summary-row">
              <span>{field.fieldName}</span>
              <span>{formatNumber(field.riskEmptyBefore)}</span>
              <span>{formatNumber(field.filledFromBi)}</span>
              <span>{formatNumber(field.stillEmptyAfter)}</span>
              <span>{formatPercentage(field.fillPercentage)}</span>
            </div>
          ))}
        </div>
      </div>

      <PreparedPopulationPreviewSection summary={summary} previewRows={previewRows} />

      <DroppedRowsSection
        removedRows={removedRows}
        duplicateRows={duplicateRows}
        invalidResultRows={invalidResultRows}
      />
    </section>
  );
}
