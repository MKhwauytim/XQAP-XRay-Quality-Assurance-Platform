import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import type { NormalizedBiRow } from "../biData/biDataTypes";
import { makeBiMatchKey } from "../processing/populationProcessor";
import type { OrphanScanResult } from "../../../../../data/integrity/orphanScan";
import Pagination from "../../../../../components/Pagination/Pagination";
import { clampPage, pageSlice } from "../../../../../components/Pagination/paginationUtils";
import "./DataAccuracyReport.css";

// ── column mapping definition ─────────────────────────────────────────────────

type ColMapping = {
  key: string;
  label: string;
  getRisk: (r: NormalizedRiskRow) => string | null;
  getBi:   (b: NormalizedBiRow)   => string | null;
};

const COLUMN_MAPPINGS: ColMapping[] = [
  { key: "xrayEntryDate",          label: "تاريخ دخول الأشعة",        getRisk: r => r.xrayEntryDate,           getBi: b => b.xrayEntryDate },
  { key: "portCode",               label: "رمز المنفذ",               getRisk: r => r.portCode,                getBi: b => b.portCode },
  { key: "portName",               label: "اسم المنفذ",               getRisk: r => r.portName,                getBi: b => b.portName },
  { key: "portType",               label: "نوع المنفذ",               getRisk: r => r.portType,                getBi: b => b.portType },
  { key: "declarationNumber",      label: "رقم البيان",               getRisk: r => r.declarationNumber,       getBi: b => b.declarationNumber },
  { key: "declarationDate",        label: "تاريخ البيان",             getRisk: r => r.declarationDate,         getBi: b => b.declarationDate },
  { key: "declarationHijriDate",   label: "تاريخ البيان هجري",       getRisk: r => r.declarationHijriDate,    getBi: b => b.declarationHijriDate },
  { key: "plateOrContainerNumber", label: "رقم اللوحة/الحاوية",       getRisk: r => r.plateOrContainerNumber,  getBi: b => b.plateOrContainerNumber },
  { key: "chassisNumber",          label: "رقم الهيكل",               getRisk: r => r.chassisNumber,           getBi: b => b.chassisNumber },
  { key: "levelOneResult",         label: "نتيجة المستوى الأول",      getRisk: r => r.xrayLevelOneResult,      getBi: b => b.levelOneResult },
  { key: "levelTwoResult",         label: "نتيجة المستوى الثاني",     getRisk: r => r.xrayLevelTwoResult,      getBi: b => b.levelTwoResult },
  { key: "manualInspectionResult", label: "نتيجة التفتيش اليدوي",    getRisk: r => r.inspectorResult,         getBi: b => b.manualInspectionResult },
  { key: "oppositeInspectionResult",label:"نتيجة التفتيش المعاكس",   getRisk: r => r.oppositeInspectorResult, getBi: b => b.oppositeInspectionResult },
  { key: "liveMeansResult",        label: "نتيجة الوسائل الحية",     getRisk: r => r.liveMeansResult,         getBi: b => b.liveMeansResult },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function norm(val: string | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = val.toString().trim();
  // Normalize ISO-style dates: "2025-1-5" → "2025-01-05"
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2,"0")}-${iso[3].padStart(2,"0")}`;
  // Normalize DD/MM/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2,"0")}-${slash[1].padStart(2,"0")}`;
  return s.toLowerCase().replace(/\s+/g, " ");
}


// ── Result-value semantic normalization ───────────────────────────────────────
// Result columns (level-1/2, manual, opposite, live-means) store their values
// differently across the two source systems: the risk workbook may use numeric
// codes (1, 2) while the BI workbook stores full Arabic phrases — or the same
// concept is expressed with slightly different wording.  We map all known
// variants to a canonical Arabic label so they compare equal and are displayed
// with a readable explanation.

const RESULT_COLUMN_KEYS = new Set([
  "levelOneResult",
  "levelTwoResult",
  "manualInspectionResult",
  "oppositeInspectionResult",
  "liveMeansResult",
]);

function canonicalizeResult(normed: string): string {
  // Numeric codes used by the risk workbook
  if (normed === "1") return "سليمة";
  if (normed === "2") return "اشتباه";
  // Normalize Arabic letters for soft-matching (ة→ه, أإآ→ا, ى→ي)
  const ar = normed
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ةه]/g, "ه");
  if (ar.startsWith("سليم") || ar.includes("يمكن فسحها") || ar.includes("مبدئ")) return "سليمة";
  if (ar.startsWith("اشتباه") || ar.startsWith("مشتبه")) return "اشتباه";
  return normed;
}

/** Comparison normalizer for result columns: apply base norm then canonicalize. */
function normResult(val: string | null | undefined): string {
  return canonicalizeResult(norm(val));
}

/** Picks the right normalizer based on whether the column is a result column. */
function normForCol(val: string | null | undefined, colKey: string): string {
  return RESULT_COLUMN_KEYS.has(colKey) ? normResult(val) : norm(val);
}

/**
 * Display helper for result columns.
 * When the raw value differs from its canonical label, shows "raw (canonical)"
 * so the reviewer immediately understands what the code means.
 */
function displayForCol(val: string | null | undefined, colKey: string): string {
  if (val === null || val === undefined || val === "") return "—";
  if (!RESULT_COLUMN_KEYS.has(colKey)) return val;
  const canonical = canonicalizeResult(norm(val));
  const raw = val.trim();
  // Only annotate when the raw text doesn't already match the canonical label
  if (canonical !== norm(raw) && canonical !== raw) return `${raw} (${canonical})`;
  return raw;
}

function accColor(pct: number): string {
  if (pct === 100) return "#059669";
  if (pct >= 85)   return "#d97706";
  return "#dc2626";
}

// ── types ─────────────────────────────────────────────────────────────────────

type Mismatch = {
  xrayImageId: string;
  colKey:      string;
  colLabel:    string;
  riskValue:   string | null;
  biValue:     string | null;
};

type ColStat = {
  key:       string;
  label:     string;
  matched:   number;
  mismatched: number;
  accuracy:  number;
};

type CompareResult = {
  totalRiskRows:     number;
  matchedIds:        number;
  onlyInRisk:        number;
  onlyInBi:          number;
  rowsWithMismatch:  number;
  totalComparisons:  number;
  totalMismatches:   number;
  overallAccuracy:   number;
  colStats:          ColStat[];
  mismatches:        Mismatch[];
};

// ── computation ───────────────────────────────────────────────────────────────

function compare(riskRows: NormalizedRiskRow[], biRows: NormalizedBiRow[]): CompareResult {
  // Match on the SAME normalized ID+port key the population processor uses
  // (makeBiMatchKey) so this accuracy report reflects the real BI→risk join —
  // a bare `xrayImageId.trim()` key silently over- or under-counted matches.
  const biMap = new Map<string, NormalizedBiRow>();
  for (const b of biRows) {
    if (b.xrayImageId) biMap.set(makeBiMatchKey(b.xrayImageId, b.portName), b);
  }

  const colCounters: Record<string, { matched: number; mismatched: number }> = {};
  for (const col of COLUMN_MAPPINGS) colCounters[col.key] = { matched: 0, mismatched: 0 };

  const mismatches: Mismatch[] = [];
  let matchedIds       = 0;
  let onlyInRisk       = 0;
  let rowsWithMismatch = 0;

  for (const r of riskRows) {
    if (!r.xrayImageId) continue;
    const b = biMap.get(makeBiMatchKey(r.xrayImageId, r.portName));
    if (!b) { onlyInRisk++; continue; }
    matchedIds++;

    let rowHasMismatch = false;
    for (const col of COLUMN_MAPPINGS) {
      const rv = normForCol(col.getRisk(r), col.key);
      const bv = normForCol(col.getBi(b), col.key);
      if (rv !== bv) {
        colCounters[col.key].mismatched++;
        mismatches.push({
          xrayImageId: r.xrayImageId,
          colKey:      col.key,
          colLabel:    col.label,
          riskValue:   col.getRisk(r),
          biValue:     col.getBi(b),
        });
        rowHasMismatch = true;
      } else {
        colCounters[col.key].matched++;
      }
    }
    if (rowHasMismatch) rowsWithMismatch++;
  }

  const riskKeys = new Set(
    riskRows.filter(r => r.xrayImageId).map(r => makeBiMatchKey(r.xrayImageId, r.portName))
  );
  let onlyInBi = 0;
  for (const b of biRows) {
    if (b.xrayImageId && !riskKeys.has(makeBiMatchKey(b.xrayImageId, b.portName))) onlyInBi++;
  }

  const totalComparisons = matchedIds * COLUMN_MAPPINGS.length;
  const totalMismatches  = mismatches.length;
  const overallAccuracy  = totalComparisons > 0
    ? Math.round(((totalComparisons - totalMismatches) / totalComparisons) * 100)
    : 100;

  const colStats: ColStat[] = COLUMN_MAPPINGS.map(col => {
    const { matched, mismatched } = colCounters[col.key];
    const total = matched + mismatched;
    return {
      key:       col.key,
      label:     col.label,
      matched,
      mismatched,
      accuracy:  total > 0 ? Math.round((matched / total) * 100) : 100,
    };
  });

  return {
    totalRiskRows:   riskRows.filter(r => r.xrayImageId).length,
    matchedIds,
    onlyInRisk,
    onlyInBi,
    rowsWithMismatch,
    totalComparisons,
    totalMismatches,
    overallAccuracy,
    colStats,
    mismatches,
  };
}

// ── Referential-integrity (orphan scan) section (B3) ───────────────────────────

const ORPHAN_DISPLAY_CAP = 50;

/** One orphan category: count + capped, expandable id list. */
function OrphanCategory({ title, description, ids }: { title: string; description: string; ids: string[] }) {
  const [open, setOpen] = useState(false);
  const hasOrphans = ids.length > 0;
  const shown = ids.slice(0, ORPHAN_DISPLAY_CAP);
  const extra = ids.length - shown.length;
  return (
    <div className={`orphan-category${hasOrphans ? " has-orphans" : ""}`}>
      <button
        type="button"
        className="orphan-category-head"
        onClick={() => hasOrphans && setOpen((o) => !o)}
        disabled={!hasOrphans}
        aria-expanded={open}
      >
        <span className="orphan-cat-icon" aria-hidden>
          {hasOrphans ? <AlertTriangle size={15} color="#dc2626" /> : <CheckCircle2 size={15} color="#16a34a" />}
        </span>
        <span className="orphan-cat-title">{title}</span>
        <span className="orphan-cat-count" style={{ color: hasOrphans ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
          {ids.length.toLocaleString("ar-SA-u-nu-latn")}
        </span>
        {hasOrphans ? <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined }} /> : null}
      </button>
      <p className="orphan-cat-desc">{description}</p>
      {open && hasOrphans ? (
        <div className="orphan-cat-ids" dir="ltr">
          {shown.map((id) => (
            <code key={id} className="orphan-id-chip">{id}</code>
          ))}
          {extra > 0 ? (
            <span className="orphan-id-more" dir="rtl">+{extra.toLocaleString("ar-SA-u-nu-latn")} أخرى</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Referential-integrity orphan scan (B3). Renders nothing when `scan` is null. */
export function OrphanScanSection({ scan }: { scan: OrphanScanResult | null }) {
  if (!scan) return null;
  return (
    <div className="orphan-scan" aria-label="فحص السلامة المرجعية">
      <div className="orphan-scan-head">
        <h3 className="dar-col-table-title">فحص السلامة المرجعية (الصفوف اليتيمة)</h3>
        {scan.clean ? (
          <span className="orphan-scan-clean" style={{ color: "#16a34a", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <CheckCircle2 size={15} /> لا توجد صفوف يتيمة — السلاسل المرجعية سليمة
          </span>
        ) : null}
      </div>
      <div className="orphan-scan-grid">
        <OrphanCategory
          title="إجابات دون توزيع"
          description="معرّفات لها إجابات محفوظة لكنها غير موجودة في لقطة التوزيع الحالية."
          ids={scan.answersOrphans}
        />
        <OrphanCategory
          title="طلبات اعتماد دون توزيع"
          description="معرّفات مشار إليها في طلبات الإحالة/الاستبدال لكنها غير موجودة في لقطة التوزيع الحالية."
          ids={scan.approvalsOrphans}
        />
        <OrphanCategory
          title="عينة دون مجتمع"
          description="صفوف في العينة المسحوبة لا يقابلها معرّف في المجتمع النهائي."
          ids={scan.sampleOrphans}
        />
      </div>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DataAccuracyReport({
  riskRows,
  biRows,
}: {
  riskRows: NormalizedRiskRow[];
  biRows:   NormalizedBiRow[];
}) {
  const result = useMemo(() => compare(riskRows, biRows), [riskRows, biRows]);

  const [search,    setSearch]    = useState("");
  const [colFilter, setColFilter] = useState("__all__");
  const resultPageKey = `${result.mismatches.length}:${result.mismatches[0]?.xrayImageId ?? ""}:${result.mismatches.at(-1)?.xrayImageId ?? ""}`;
  const [pageState, setPageState] = useState<{ resultKey: string; page: number }>(() => ({ resultKey: resultPageKey, page: 1 }));

  const filtered = useMemo(() => {
    let rows = result.mismatches;
    if (colFilter !== "__all__") rows = rows.filter(m => m.colKey === colFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(m =>
        m.xrayImageId.toLowerCase().includes(q) ||
        (m.riskValue ?? "").toLowerCase().includes(q) ||
        (m.biValue ?? "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [result.mismatches, colFilter, search]);

  const page = clampPage(pageState.resultKey === resultPageKey ? pageState.page : 1, filtered.length);
  const paginated = pageSlice(filtered, page);

  function handleSearch(v: string) { setSearch(v);    setPageState({ resultKey: resultPageKey, page: 1 }); }
  function handleFilter(v: string) { setColFilter(v); setPageState({ resultKey: resultPageKey, page: 1 }); }

  function handleExportExcel() {
    // Sheet 1: column accuracy summary
    const summaryRows = result.colStats.map(col => ({
      "العمود":        col.label,
      "متطابق":        col.matched,
      "مختلف":         col.mismatched,
      "دقة (%)":       col.accuracy,
    }));

    // Sheet 2: all mismatches (full, not paginated)
    const detailRows = result.mismatches.map(m => ({
      "معرف الأشعة":         m.xrayImageId,
      "العمود":              m.colLabel,
      "قيمة وكالة المخاطر":  m.riskValue ?? "",
      "قيمة BI":             m.biValue ?? "",
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "دقة الأعمدة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows),  "تفاصيل الاختلافات");
    XLSX.writeFile(wb, "تقرير_دقة_البيانات.xlsx");
  }

  const accColor100 = accColor(result.overallAccuracy);

  return (
    <div className="dar-root">

      {/* ── KPI strip ── */}
      <div className="dar-kpi-strip">
        <div className="dar-kpi">
          <span className="dar-kpi-label">معرّفات المقارنة</span>
          <strong className="dar-kpi-value" style={{ color: "#17365d" }}>
            {result.matchedIds.toLocaleString("ar-SA-u-nu-latn")}
          </strong>
          <span className="dar-kpi-sub">من أصل {result.totalRiskRows.toLocaleString("ar-SA-u-nu-latn")} في المخاطر</span>
        </div>
        <div className="dar-kpi">
          <span className="dar-kpi-label">فقط في المخاطر</span>
          <strong className="dar-kpi-value" style={{ color: result.onlyInRisk > 0 ? "#d97706" : "#059669" }}>
            {result.onlyInRisk.toLocaleString("ar-SA-u-nu-latn")}
          </strong>
          <span className="dar-kpi-sub">لا يقابلها معرّف في BI</span>
        </div>
        <div className="dar-kpi">
          <span className="dar-kpi-label">سجلات بها اختلاف</span>
          <strong className="dar-kpi-value" style={{ color: result.rowsWithMismatch > 0 ? "#dc2626" : "#059669" }}>
            {result.rowsWithMismatch.toLocaleString("ar-SA-u-nu-latn")}
          </strong>
          <span className="dar-kpi-sub">من {result.matchedIds.toLocaleString("ar-SA-u-nu-latn")} سجل متطابق الهوية</span>
        </div>
        <div className="dar-kpi">
          <span className="dar-kpi-label">إجمالي الاختلافات</span>
          <strong className="dar-kpi-value" style={{ color: result.totalMismatches > 0 ? "#dc2626" : "#059669" }}>
            {result.totalMismatches.toLocaleString("ar-SA-u-nu-latn")}
          </strong>
          <span className="dar-kpi-sub">عبر {COLUMN_MAPPINGS.length} أعمدة مقارنة</span>
        </div>
        <div className="dar-kpi">
          <span className="dar-kpi-label">دقة البيانات الكلية</span>
          <strong className="dar-kpi-value" style={{ color: accColor100 }}>
            {result.overallAccuracy}%
          </strong>
          <span className="dar-kpi-sub">{result.totalComparisons.toLocaleString("ar-SA-u-nu-latn")} مقارنة إجمالية</span>
        </div>
      </div>

      {/* ── Column accuracy table ── */}
      <div className="dar-col-table">
        <h3 className="dar-col-table-title">دقة كل عمود</h3>
        <div className="dar-col-header">
          <span>العمود</span>
          <span style={{ textAlign: "center" }}>متطابق</span>
          <span style={{ textAlign: "center" }}>مختلف</span>
          <span style={{ textAlign: "center" }}>دقة</span>
          <span>الشريط</span>
        </div>
        {result.colStats.map(col => {
          const cls = col.accuracy === 100 ? "perfect" : col.accuracy >= 85 ? "" : col.accuracy >= 60 ? "low" : "critical";
          const fillColor = accColor(col.accuracy);
          return (
            <div key={col.key} className={`dar-col-row ${cls}`}>
              <span className="dar-col-name">{col.label}</span>
              <span className="dar-col-num">{col.matched.toLocaleString("ar-SA-u-nu-latn")}</span>
              <span className="dar-miss-num" style={{ color: col.mismatched > 0 ? "#dc2626" : "#059669", fontWeight: col.mismatched > 0 ? 700 : 400 }}>
                {col.mismatched.toLocaleString("ar-SA-u-nu-latn")}
              </span>
              <span className="dar-acc-pct" style={{ color: fillColor }}>{col.accuracy}%</span>
              <div className="dar-acc-bar-wrap">
                <div className="dar-acc-bar-bg">
                  <div className="dar-acc-bar-fill" style={{ width: `${col.accuracy}%`, background: fillColor }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Mismatch detail table ── */}
      <div className="dar-detail">
        <div className="dar-detail-toolbar">
          <h3 className="dar-detail-title">تفاصيل الاختلافات</h3>
          <input
            type="text"
            className="dar-search-input"
            placeholder="بحث بمعرف الأشعة أو القيمة..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            dir="rtl"
          />
          <select
            className="dar-col-filter"
            value={colFilter}
            onChange={e => handleFilter(e.target.value)}
          >
            <option value="__all__">كل الأعمدة</option>
            {COLUMN_MAPPINGS.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <span className="dar-count-chip">{filtered.length.toLocaleString("ar-SA-u-nu-latn")} اختلاف</span>
          <button
            type="button"
            className="dar-export-btn"
            onClick={handleExportExcel}
            title="تصدير كل البيانات إلى Excel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            تصدير Excel
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="dar-empty">
            {result.mismatches.length === 0
              ? <><CheckCircle2 size={16} style={{ verticalAlign: "middle", marginInlineEnd: 4, color: "#16a34a" }} /> لا توجد اختلافات — البيانات متطابقة بالكامل</>

              : "لا توجد نتائج تطابق الفلتر المحدد"}
          </div>
        ) : (
          <>
            <div className="dar-detail-header">
              <span>معرف الأشعة</span>
              <span>العمود</span>
              <span>قيمة وكالة المخاطر</span>
              <span>قيمة BI</span>
            </div>
            {paginated.map((m, i) => (
              <div key={i} className="dar-detail-row">
                <span className="dar-id">{m.xrayImageId}</span>
                <span className="dar-col">{m.colLabel}</span>
                <span className={`dar-risk-val${!m.riskValue ? " dar-null" : ""}`}>
                  {displayForCol(m.riskValue, m.colKey)}
                </span>
                <span className={`dar-bi-val${!m.biValue ? " dar-null" : ""}`}>
                  {displayForCol(m.biValue, m.colKey)}
                </span>
              </div>
            ))}
            <Pagination page={page} totalItems={filtered.length} onPageChange={(nextPage) => setPageState({ resultKey: resultPageKey, page: nextPage })} itemLabel="اختلاف" />
          </>
        )}
      </div>
    </div>
  );
}
