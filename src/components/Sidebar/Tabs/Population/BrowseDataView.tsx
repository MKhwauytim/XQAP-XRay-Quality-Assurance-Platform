import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { yieldToMain } from "../../../../data/storage/yieldToMain";
import * as XLSX from "xlsx";
import { Database, Settings2, ChevronUp, ChevronDown } from "lucide-react";

import { readSession } from "../../../../auth/authSession";
import {
  loadBrowseRows,
  loadMonthPopulationFinalRawText,
  type BrowseDatasetKind,
  type BrowseRow
} from "../../../../data/population/populationStorage";
import { formatMonthFolderShortLabel } from "../../../../data/population/monthFolder";
import {
  DEFAULT_MAPPING_TEMPLATE,
  DEFAULT_SYSTEM_FIELDS,
  type PopulationConfig
} from "../../../../data/population/populationConfig";
import {
  loadAdminBrowsePreset,
  loadUserBrowsePreset,
  saveAdminBrowseDatasetPreset,
  saveUserBrowseDatasetPreset,
  type BrowseDatasetPreset,
  type UserBrowsePresetFile
} from "../../../../data/preferences/browsePresetStorage";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import { useLabels } from "../../../../data/labels/useLabels";
import { useFocusTrap } from "../../../../hooks/useFocusTrap";
import { logError } from "../../../../data/storage/errorLogger";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../../../components/StateViews/StateViews";
import Pagination from "../../../../components/Pagination/Pagination";
import { DATA_PAGE_SIZE } from "../../../../utils/paginationUtils";
import { formatStageLabel } from "./components/helpers";
import { buildBrowseFilterOptionPreview } from "./browseFilterOptions";
import {
  runPopulationQuery,
  type PopulationQueryParams,
  type PopulationQuerySort,
  type PopulationQueryResult
} from "../../../../data/population/populationQuery";
import {
  usePopulationBrowseWorker,
  type PopulationQueryLane
} from "./usePopulationBrowseWorker";

// ── Query lanes ───────────────────────────────────────────────────────────────
// This view asks the ONE query worker three simultaneously-valid questions, each
// with its own independent "latest request wins" lifetime. They must not share a
// staleness lane: they can (and routinely do) fire in the same React commit —
// toggling a filter checkbox changes `columnFilters`, a dependency of both the
// main query effect and the filter-preview effect — and a shared "latest wins"
// slot then lets whichever posted last silently invalidate the other's answer.
// That is exactly the bug that made filtering appear to do nothing: the preview's
// later request made the main table's own result look stale, so it was dropped.
// See usePopulationBrowseWorker's doc comment for the full model.
const MAIN_QUERY_LANE: PopulationQueryLane = "browse-main";
const FILTER_PREVIEW_QUERY_LANE: PopulationQueryLane = "browse-filter-preview";
// Export walks every page of ITS OWN captured params; it must neither be
// interrupted by, nor interrupt, the live table/dropdown the user keeps using
// while the export runs.
const EXPORT_QUERY_LANE: PopulationQueryLane = "browse-export";

// ── Browse sub-tab ────────────────────────────────────────────────────────────
const BROWSE_COLUMNS: { key: string; label: string; default: boolean }[] = [
  { key: "stage",                 label: "المستوى",              default: true  },
  { key: "xrayImageId",           label: "معرف الأشعة",          default: true  },
  { key: "xrayEntryDate",         label: "تاريخ الدخول",         default: true  },
  { key: "portType",              label: "نوع المنفذ",           default: true  },
  { key: "portName",              label: "المنفذ",               default: true  },
  { key: "xrayLevelOneResult",    label: "نتيجة المستوى 1",      default: true  },
  { key: "xrayLevelTwoResult",    label: "نتيجة المستوى 2",      default: true  },
  { key: "plateOrContainerNumber",label: "رقم اللوحة/الحاوية",   default: true  },
  { key: "certScanStatus",        label: "CertScan",             default: false },
  { key: "declarationNumber",     label: "رقم البيان",           default: false },
  { key: "movementType",          label: "نوع الحركة",           default: false },
  { key: "biEnrichmentStatus",    label: "حالة BI",              default: false },
  { key: "_monthFolder",          label: "الشهر المصدر",         default: false },
];

// Curated defaults (Batch A / A2) — ground truth from the user's real workspace screenshot.
// risk-raw's own field is `entryDate` ("تاريخ الدخول") — distinct from population/BI's
// `xrayEntryDate` ("تاريخ دخول الأشعة"). BI has no `stage` field, so its set drops that column.
const RISK_RAW_DEFAULT_COLUMN_KEYS: string[] = [
  "stage", "xrayImageId", "entryDate", "portType", "portName",
  "xrayLevelOneResult", "xrayLevelTwoResult", "plateOrContainerNumber"
];
const BI_RAW_DEFAULT_COLUMN_KEYS: string[] = [
  "xrayImageId", "xrayEntryDate", "portType", "portName",
  "levelOneResult", "levelTwoResult", "plateOrContainerNumber"
];

type BrowseColumn = { key: string; label: string; default: boolean };

const RAW_COLUMN_LABELS: Record<string, string> = {
  source: "المصدر",
  portType: "نوع المنفذ",
  portCode: "رمز المنفذ",
  preliminaryDeclarationNumber: "رقم البيان المبدئي",
  declarationNumber: "رقم البيان",
  declarationDate: "تاريخ البيان",
  declarationHijriDate: "تاريخ البيان هجري",
  inboundOutboundType: "نوع الوارد/الصادر",
  declarationType: "نوع البيان",
  declarationStatus: "حالة البيان",
  chassisNumber: "رقم الهيكل",
  governance: "الحوكمة",
  levelOneEmployee: "موظف المستوى الأول",
  entryDate: "تاريخ الدخول",
  levelOneResult: "نتيجة المستوى 1",
  levelTwoResult: "نتيجة المستوى 2",
  movementType: "نوع الحركة",
  plateOrContainerNumber: "رقم اللوحة/الحاوية",
  xrayEntryDate: "تاريخ دخول الأشعة",
  reportNumber: "رقم المحضر",
  targetedByRiskEngine: "مستهدف محرك المخاطر",
  riskMessage: "رسالة المخاطر",
  sourceSheetName: "اسم الورقة",
  sourceRowNumber: "رقم الصف في المصدر",
  certScanStatus: "حالة CertScan",
  certScanSnippet: "نص CertScan",
  originalCertScanSnippet: "نص CertScan الأصلي",
  biEnrichmentStatus: "حالة إثراء ذكاء الأعمال",
  biMatched: "مطابق في ذكاء الأعمال",
  biFilledFields: "حقول ذكاء الأعمال المضافة",
  xrayLevelOneResult: "نتيجة المستوى الأول",
  xrayLevelTwoResult: "نتيجة المستوى الثاني",
  stage: "المستوى",
  _monthFolder: "الشهر المصدر"
};

const NORMALIZED_COLUMN_LABELS: Record<string, string> = (() => {
  const labels: Record<string, string> = {};

  function add(key: string, label: string): void {
    labels[normalizeColumnKey(key)] = label;
  }

  for (const column of BROWSE_COLUMNS) {
    add(column.key, column.label);
  }

  for (const field of DEFAULT_SYSTEM_FIELDS) {
    add(field.key, field.labelAr);
  }

  for (const [fieldKey, aliases] of Object.entries(DEFAULT_MAPPING_TEMPLATE.columnMappings)) {
    const fieldLabel =
      DEFAULT_SYSTEM_FIELDS.find((field) => field.key === fieldKey)?.labelAr ??
      RAW_COLUMN_LABELS[fieldKey];

    if (!fieldLabel) {
      continue;
    }

    add(fieldKey, fieldLabel);
    for (const alias of aliases) {
      add(alias, fieldLabel);
    }
  }

  for (const [key, label] of Object.entries(RAW_COLUMN_LABELS)) {
    add(key, label);
  }

  return labels;
})();

function normalizeColumnKey(key: string): string {
  return key
    .trim()
    .replace(/[\s_\-/\\]+/g, "")
    .toLowerCase();
}

function getBrowseColumnLabel(key: string): string {
  return NORMALIZED_COLUMN_LABELS[normalizeColumnKey(key)] ?? key;
}

function buildBrowseColumns(rows: BrowseRow[]): BrowseColumn[] {
  const baseKeys = new Set(BROWSE_COLUMNS.map((column) => column.key));
  const dynamicKeys = new Set<string>();

  for (const row of rows.slice(0, 100)) {
    for (const key of Object.keys(row)) {
      if (key === "_month" || key === "_year" || baseKeys.has(key)) {
        continue;
      }
      dynamicKeys.add(key);
    }
  }

  return [
    ...BROWSE_COLUMNS,
    ...Array.from(dynamicKeys).map((key) => ({
      key,
      label: getBrowseColumnLabel(key),
      default: false
    }))
  ];
}

function orderBrowseColumns(
  columns: BrowseColumn[],
  columnOrder: string[]
): BrowseColumn[] {
  const orderIndex = new Map(columnOrder.map((key, index) => [key, index]));

  return [...columns].sort((first, second) => {
    const firstIndex = orderIndex.get(first.key) ?? Number.MAX_SAFE_INTEGER;
    const secondIndex = orderIndex.get(second.key) ?? Number.MAX_SAFE_INTEGER;

    if (firstIndex !== secondIndex) {
      return firstIndex - secondIndex;
    }

    return columns.indexOf(first) - columns.indexOf(second);
  });
}

function mergeColumnOrder(
  savedOrder: string[] | undefined,
  availableKeys: string[]
): string[] {
  if (!savedOrder || savedOrder.length === 0) {
    return availableKeys;
  }

  const available = new Set(availableKeys);
  const ordered = savedOrder.filter((key) => available.has(key));
  const missing = availableKeys.filter((key) => !ordered.includes(key));
  return [...ordered, ...missing];
}

function resolveVisibleColumns(
  dataset: BrowseDatasetKind,
  columns: BrowseColumn[],
  savedVisibleColumns: string[] | undefined
): Set<string> {
  const availableKeys = new Set(columns.map((column) => column.key));

  if (savedVisibleColumns && savedVisibleColumns.length > 0) {
    return new Set(savedVisibleColumns.filter((key) => availableKeys.has(key)));
  }

  return defaultVisibleColumns(dataset, columns);
}

function curatedDefaultKeys(dataset: BrowseDatasetKind): string[] {
  if (dataset === "risk-raw") return RISK_RAW_DEFAULT_COLUMN_KEYS;
  if (dataset === "bi-raw") return BI_RAW_DEFAULT_COLUMN_KEYS;
  return [];
}

function defaultVisibleColumns(
  dataset: BrowseDatasetKind,
  columns: BrowseColumn[]
): Set<string> {
  if (dataset === "population" || dataset === "sample") {
    return new Set(columns.filter((column) => column.default).map((column) => column.key));
  }

  const curated = curatedDefaultKeys(dataset);
  if (curated.length > 0) {
    const availableKeys = new Set(columns.map((column) => column.key));
    const matchedCurated = curated.filter((key) => availableKeys.has(key));
    if (matchedCurated.length > 0) {
      return new Set(matchedCurated);
    }
  }

  const rawKeys = columns
    .filter((column) => !column.key.startsWith("_") && !BROWSE_COLUMNS.some((base) => base.key === column.key))
    .slice(0, 12)
    .map((column) => column.key);

  return new Set([...rawKeys, "_monthFolder"]);
}

// Places curated keys first (in curated order), then appends whatever else is available — only
// takes effect when no per-dataset order has been saved to a preset yet (see mergeColumnOrder).
function defaultColumnOrderKeys(
  dataset: BrowseDatasetKind,
  columns: BrowseColumn[]
): string[] {
  const curated = curatedDefaultKeys(dataset);
  const availableKeys = columns.map((column) => column.key);
  if (curated.length === 0) {
    return availableKeys;
  }

  const curatedPresent = curated.filter((key) => availableKeys.includes(key));
  const remaining = availableKeys.filter((key) => !curatedPresent.includes(key));
  return [...curatedPresent, ...remaining];
}

// Resolves column order/visibility once for a freshly-loaded dataset, from a
// representative row sample (see this file's own "fresh load" doc comment near
// COLUMNS_INIT below for why only a sample — not the full row set — is available for
// the worker-backed "population" path). A module-level pure function (not a
// component closure) so it needs no entry in any effect's dependency array.
function resolveColumnsAndVisibility(
  dataset: BrowseDatasetKind,
  sampleRows: BrowseRow[],
  datasetPreset: BrowseDatasetPreset | undefined
): { columnOrder: string[]; visibleCols: Set<string> } {
  const nextColumns = buildBrowseColumns(sampleRows);
  const nextOrder = mergeColumnOrder(datasetPreset?.columnOrder, defaultColumnOrderKeys(dataset, nextColumns));
  const nextVisible = resolveVisibleColumns(dataset, nextColumns, datasetPreset?.visibleColumns);
  return { columnOrder: nextOrder, visibleCols: nextVisible };
}

// Same "all months" narrowing BrowseDataView has always applied to its loaded rows —
// extracted to a module-level function (rather than a component-scoped useMemo) so it
// can be called synchronously mid-effect with whichever `rows` value is current at
// that point (see the query effect below), not just the value React has already
// committed to state.
function filterRowsByMonth(
  rows: BrowseRow[],
  showAllMonths: boolean,
  globalFolder: string | null
): BrowseRow[] {
  return showAllMonths || !globalFolder
    ? rows
    : rows.filter((row) => row._monthFolder === globalFolder);
}

const BROWSE_DATASETS: Array<{
  id: BrowseDatasetKind;
  label: string;
  description: string;
}> = [
  {
    id: "population",
    label: "المجتمع النهائي",
    description: "البيانات المعالجة التي تُستخدم لاحقاً لسحب العينة."
  },
  {
    id: "sample",
    label: "العينة المسحوبة",
    description: "السجلات التي تم اختيارها كعينة من المجتمع النهائي."
  },
  {
    id: "risk-raw",
    label: "تحليل المخاطر",
    description: "صفوف ملف المخاطر كما قُرئت من Excel ومحفوظة للرجوع فقط."
  },
  {
    id: "bi-raw",
    label: "ذكاء الأعمال",
    description: "صفوف ذكاء الأعمال كما قُرئت من Excel ومحفوظة للرجوع فقط."
  }
];

const STAGE_FILTER_ORDER: Record<string, number> = {
  "المستوى الأول": 1,
  "المستوى الثاني": 2,
  "المستوى الثالث": 3,
  "المستوى الرابع": 4
};

function compareBrowseFilterOptions(first: string, second: string): number {
  const firstStageOrder = STAGE_FILTER_ORDER[first];
  const secondStageOrder = STAGE_FILTER_ORDER[second];
  if (firstStageOrder !== undefined || secondStageOrder !== undefined) {
    return (firstStageOrder ?? Number.MAX_SAFE_INTEGER) - (secondStageOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return first.localeCompare(second, "ar");
}

function formatMonthFolderLabel(monthFolder: string): string {
  return formatMonthFolderShortLabel(monthFolder);
}

function formatBrowseCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (Array.isArray(value)) {
    return value.map(formatBrowseCellValue).join("، ");
  }

  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }

  return String(value);
}

// The real (main-thread) display-value formatter — used directly for: per-page cell
// rendering (both paths, always correct since it's a plain function call over at
// most DATA_PAGE_SIZE rows), the fallback (non-worker) path's search/filter/sort
// query, and the fallback path's column-filter dropdown preview. For the
// worker-backed "population" path, this SAME special-casing is mirrored inside the
// worker itself (src/workers/populationQueryWorker.ts's getWorkerDisplayValue) since
// a function can't cross postMessage — see this file's PR/commit notes for the full
// rationale (Task 4's CRITICAL gap).
function getBrowseDisplayValue(
  row: BrowseRow,
  key: string,
  stageMappings?: PopulationConfig["stageMappings"]
): string {
  if (key === "stage") {
    return formatStageLabel(row[key], stageMappings);
  }

  if (key === "_monthFolder") {
    return formatMonthFolderLabel(String(row[key] ?? ""));
  }

  return formatBrowseCellValue(row[key]);
}

function rowMatchesSearch(
  row: BrowseRow,
  normalizedSearch: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  if (!normalizedSearch) {
    return true;
  }

  return Object.keys(row).some((key) =>
    getBrowseDisplayValue(row, key, stageMappings).toLowerCase().includes(normalizedSearch)
  );
}

function rowMatchesColumnFilters(
  row: BrowseRow,
  filters: Record<string, string[]>,
  exceptKey?: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  return Object.entries(filters).every(([key, selectedValues]) => {
    if (key === exceptKey || selectedValues.length === 0) {
      return true;
    }

    return selectedValues.includes(getBrowseDisplayValue(row, key, stageMappings));
  });
}

function safeExportFileName(value: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips ASCII control characters (U+0000-U+001F) from file names
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, "_");
}

// Same yieldToMain idiom used by populationProcessor.ts / riskDataWorkbook.ts —
// defined locally per-file rather than shared across tab boundaries.
const EXPORT_CHUNK_SIZE = 1000;

// Bounded page-scan cap for the worker-backed path's per-column filter dropdown
// preview (see collectMatchingRows below): a single query already returns
// DATA_PAGE_SIZE rows, and this scans up to FILTER_PREVIEW_MAX_PAGES of them (search
// + every OTHER active column filter applied, this column's own filter excluded) to
// collect up to DATA_PAGE_SIZE *distinct* display values. Low-cardinality categorical
// columns (stage, portType, certScanStatus, ...) are found in the first page with
// overwhelming probability; this bound exists only to avoid an unbounded scan across
// a 200k+ row dataset for a dropdown preview that's already documented in its own UI
// copy ("عرض أول 100 قيمة...") as a non-exhaustive preview, not a promise of
// completeness. The fallback (non-worker, smaller-dataset) path does a true
// unbounded scan instead — see fallbackFilterOptions below — since it already holds
// the full row array in memory with no extra cost.
const FILTER_PREVIEW_MAX_PAGES = 5;

// Single-column sort cycle: none -> ascending -> descending -> none.
function cycleSort(current: PopulationQuerySort, column: string): PopulationQuerySort {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column, direction: "desc" };
  }
  return null;
}

const EMPTY_QUERY_RESULT: PopulationQueryResult<BrowseRow> = { pageRows: [], totalRows: 0, totalPages: 1 };
const EMPTY_FILTER_PREVIEW = { options: [] as string[], truncated: false };

export default function BrowseDataView({
  directoryHandle,
  refreshKey,
  username,
  config,
  canExportReports
}: {
  directoryHandle: unknown;
  refreshKey: number;
  username: string;
  config: PopulationConfig;
  /**
   * DEFECT 4: `view-browse` defaults true for guest/employee while
   * `export-reports` defaults false, so this screen's XLSX export used to hand
   * the entire month (population, sample, raw risk and BI rows) to a role that
   * the identical Phase 2 export correctly denies. Threaded down from the tab's
   * already-computed capability (`computeWizardCapabilities` in index.tsx)
   * rather than re-derived here, and enforced at BOTH the render boundary (the
   * button's `disabled`) and the handler boundary (`exportFilteredRowsToXlsx`),
   * per CLAUDE.md.
   */
  canExportReports: boolean;
}) {
  const { selection: globalMonth } = useGlobalMonth();
  const labels = useLabels();
  const [isExporting, setIsExporting] = useState(false);
  // Surfaced as an in-page role="alert" banner rather than window.alert (LTR,
  // thread-blocking, unstyleable), matching the error pattern used elsewhere.
  const [exportError, setExportError] = useState<string | null>(null);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const globalFolder = globalMonth.kind === "none" ? null : globalMonth.folderName;
  const [dataset, setDataset] = useState<BrowseDatasetKind>("population");

  // Worker-backed path: scoped to the "population" dataset viewed at a single month
  // (per Task 4's brief — the proposal's stated concern is specifically the large
  // 200k-400k row single-month population.final.json file). Every other case keeps
  // the pre-Task-4 main-thread loadBrowseRows + synchronous runPopulationQuery path:
  //  - "sample"/"risk-raw"/"bi-raw" datasets stay comfortably small (a sample is at
  //    most the drawn portion of a population; risk/BI raw rows are the imported
  //    Excel row counts for one month, not the processed/deduplicated population) —
  //    no large-population perf concern to solve for them.
  //  - "population" with "عرض كل الشهور" (show all months) checked uses
  //    loadAllPopulationRows, which merges/dedupes rows across every month's own
  //    file — a fundamentally different, multi-file operation the worker's
  //    single-JSON-blob "load" contract has no equivalent for.
  const useWorkerPath = dataset === "population" && !showAllMonths && globalFolder != null;

  const worker = usePopulationBrowseWorker();

  const [rows, setRows] = useState<BrowseRow[]>([]); // fallback (non-worker) path only
  const [loading, setLoading] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const columnsInitializedRef = useRef(false);
  const browsePresetRef = useRef<UserBrowsePresetFile | null>(null);
  const [isPresetLoaded, setIsPresetLoaded] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(BROWSE_COLUMNS.filter((c) => c.default).map((c) => c.key))
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => BROWSE_COLUMNS.map((column) => column.key)
  );
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<PopulationQuerySort>(null);
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [queryResult, setQueryResult] = useState<PopulationQueryResult<BrowseRow>>(EMPTY_QUERY_RESULT);
  const [workerFilterPreview, setWorkerFilterPreview] = useState(EMPTY_FILTER_PREVIEW);

  // Finding 11: these two floating panels (column picker, per-column filter
  // menu) had no focus trap and no Escape handling — the only overlay
  // surfaces in the app missing it. Unlike DataTable's ColPickerPanel/
  // ColFilterMenu (separate components that mount fresh each time they
  // open), these panels are plain conditional JSX inside BrowseDataView's own
  // persistently-mounted render — the hook itself never remounts, so it needs
  // an explicit `enabled` tied to the open state (mirrors GlobalMonthSelector's
  // `enabled: pickerOpen`) or its mount-time effect never re-fires once the
  // div actually appears in the DOM.
  const colPickerFocusTrapRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setColPickerOpen(false),
    enabled: colPickerOpen
  });
  // `resetKey` (not just `enabled`) because switching straight from column A's
  // filter menu to column B's never passes `enabled` through `false`: the menu
  // is rendered inside the open column's own `th`, so A's node is destroyed and
  // a fresh one is built under B while the flag stays `true` throughout. Without
  // a changing key the effect keeps A's now-detached node and the keyboard user
  // is left with an inert Tab and focus pointed at nothing.
  const filterMenuFocusTrapRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setOpenFilterColumn(null),
    enabled: openFilterColumn !== null,
    resetKey: openFilterColumn
  });

  useEffect(() => {
    if (!directoryHandle) {
      browsePresetRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync (no directory yet, nothing to await)
      setIsPresetLoaded(true);
      return;
    }

    // Was previously `setTimeout(() => setIsPresetLoaded(false), 0)` — a macrotask
    // racing the Promise.all microtask chain below. In a fast environment (an
    // in-memory test workspace, or a small/cached preset file in production) the
    // promise chain's `.finally(() => setIsPresetLoaded(true))` can settle BEFORE
    // this queued setTimeout callback runs, since microtasks always drain ahead of
    // macrotasks — so the deferred "false" fired LAST, clobbering the already-correct
    // "true" back to "false" forever (the query effect below never re-satisfies its
    // `isPresetLoaded` guard once that happens). Setting synchronously here removes
    // the race entirely; it's the same "sync loading indicator before async work"
    // pattern the load effect below already uses.
    setIsPresetLoaded(false);
    const workspaceHandle = directoryHandle as Parameters<typeof loadUserBrowsePreset>[0];
    void Promise.all([
      loadAdminBrowsePreset(workspaceHandle),
      loadUserBrowsePreset(workspaceHandle, username)
    ])
      .then(([adminPreset, userPreset]) => {
        const nextPreset = {
          username,
          browseData: {
            ...userPreset.browseData,
            ...adminPreset.browseData
          }
        };
        browsePresetRef.current = nextPreset;
      })
      .catch(() => {
        const emptyPreset = { username, browseData: {} };
        browsePresetRef.current = emptyPreset;
      })
      .finally(() => setIsPresetLoaded(true));
  }, [directoryHandle, username]);

  // ── Load: reads the dataset's rows (worker path: raw text only, handed to the
  // query worker; fallback path: fully parsed rows, as before) whenever the dataset
  // identity changes. Bumps `loadGeneration` once the new data is in place (worker:
  // once `loadRawJson` has been posted; fallback: once `rows` is set) — the query
  // effect below is gated on `loadGeneration` so it never queries stale data left
  // over from a previous dataset/month.
  useEffect(() => {
    if (!directoryHandle || !isPresetLoaded) return;
    columnsInitializedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async browse row load; necessary to show spinner while data fetches
    setLoading(true);
    // a fresh load always starts back at page 1, same as the pre-Task-4 rowsKey-derived reset this replaces
    setPage(1);
    let cancelled = false;

    if (useWorkerPath) {
      void loadMonthPopulationFinalRawText(
        directoryHandle as Parameters<typeof loadMonthPopulationFinalRawText>[0],
        globalFolder as string
      )
        .then((rawText) => rawText ?? JSON.stringify({ rows: [] }))
        .catch(() => JSON.stringify({ rows: [] }))
        .then((rawText) => {
          if (cancelled) return;
          worker.loadRawJson(rawText, {
            stageMappings: config.stageMappings,
            monthFolder: globalFolder as string
          });
          setLoadGeneration((generation) => generation + 1);
        });
    } else {
      loadBrowseRows(
        directoryHandle as Parameters<typeof loadBrowseRows>[0],
        dataset,
        showAllMonths ? undefined : globalFolder ?? undefined
      )
        .then((nextRows) => {
          if (cancelled) return;
          setRows(nextRows);
        })
        .catch(() => {
          if (!cancelled) setRows([]);
        })
        .finally(() => {
          if (!cancelled) setLoadGeneration((generation) => generation + 1);
        });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worker.loadRawJson is useCallback([])-stable; including the whole `worker` object would re-run this effect every render (usePopulationBrowseWorker returns a fresh object each render)
  }, [dataset, directoryHandle, globalFolder, isPresetLoaded, refreshKey, showAllMonths, useWorkerPath, config.stageMappings, worker.loadRawJson]);

  // LINT-01c: dataset-scoped UI reset (filters/sort/open-dropdown), deferred to a
  // microtask to avoid a synchronous setState-in-effect lint error. Search is
  // deliberately NOT reset here (matches the pre-Task-4 behavior: search persists
  // across a dataset switch, only column filters/sort/the open dropdown do not).
  useEffect(() => {
    const id = setTimeout(() => {
      setColumnFilters({});
      setOpenFilterColumn(null);
      setSort(null);
    }, 0);
    return () => clearTimeout(id);
  }, [dataset]);

  // ── Query: runs search/filter/sort/paginate — via the worker for the
  // worker-backed path, or synchronously via the same pure runPopulationQuery
  // (Task 1) for the fallback path, using the REAL getBrowseDisplayValue directly
  // (no display-parity gap possible there, since it's a plain in-process call, not
  // a postMessage round trip). Column order/visible-columns are resolved from the
  // first result of a fresh load only (columnsInitializedRef), so later
  // reactive re-queries (typing in search, toggling a filter) never clobber the
  // user's own column reordering/visibility choices mid-session.
  useEffect(() => {
    if (!directoryHandle || !isPresetLoaded || loadGeneration === 0) return;
    let cancelled = false;
    const params: PopulationQueryParams = { search: debouncedSearch, columnFilters, sort, page };

    async function run(): Promise<void> {
      const result = useWorkerPath
        ? await worker.runQuery(params, MAIN_QUERY_LANE)
        : runPopulationQuery(
            filterRowsByMonth(rows, showAllMonths, globalFolder),
            params,
            (row, key) => getBrowseDisplayValue(row, key, config.stageMappings)
          );

      if (cancelled || !result) return;

      const typedResult = result as PopulationQueryResult<BrowseRow>;
      setQueryResult(typedResult);

      if (!columnsInitializedRef.current) {
        columnsInitializedRef.current = true;
        const { columnOrder: nextOrder, visibleCols: nextVisible } = resolveColumnsAndVisibility(
          dataset,
          typedResult.pageRows,
          browsePresetRef.current?.browseData[dataset]
        );
        setColumnOrder(nextOrder);
        setVisibleCols(nextVisible);
      }

      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worker.runQuery is useCallback([])-stable; see the load effect's identical note above
  }, [
    directoryHandle,
    isPresetLoaded,
    loadGeneration,
    useWorkerPath,
    rows,
    debouncedSearch,
    columnFilters,
    sort,
    page,
    config.stageMappings,
    worker.runQuery,
    dataset,
    showAllMonths,
    globalFolder
  ]);

  // ── Derived stats ──
  // Unfiltered dataset size (worker path: from the worker's own "loaded" response,
  // independent of the user's current search/filter — see usePopulationBrowseWorker's
  // totalRows doc comment; fallback path: the pre-Task-4 monthFilteredRows.length).
  const monthFilteredRows = useMemo(
    () => filterRowsByMonth(rows, showAllMonths, globalFolder),
    [rows, showAllMonths, globalFolder]
  );
  const total = useWorkerPath ? worker.totalRows ?? 0 : monthFilteredRows.length;
  // A10: a reload after the first successful load (refreshKey bump, dataset/month
  // switch) -- distinct from the initial `loading` (which has no prior rows to
  // dim). The worker path's `total` can drop to 0 the instant a reload starts
  // (loadRawJson resets totalRows synchronously, see usePopulationBrowseWorker),
  // so this -- not `total` -- is what the render below gates on to avoid a false
  // "no data" flash for a dataset that still has rows in `queryResult`.
  const isRefreshing = loading && loadGeneration > 0;

  // ── Load/query failure surface (worker path only) ──
  // The worker answers a request it can't fulfil (unparseable population.final.json,
  // a query issued before any successful load) with an "error" response. Before this
  // was read here, that response went nowhere: `loading` is only ever cleared by a
  // successful query result, so a corrupt file left Browse spinning forever with no
  // indication of what happened. Derived, not stored in state — no extra effect, and
  // it clears itself the moment a fresh `loadRawJson` or a successful query lands
  // (see usePopulationBrowseWorker). The fallback path has its own catch → empty
  // rows, so it never has a worker error to show.
  const browseError = useWorkerPath ? worker.error : null;

  // Finding 10(b): the worker's "error" response carries the raw
  // `err.message` from a failed `JSON.parse` (e.g. "Unexpected token < in
  // JSON at position 0") — plain V8 English text with no Arabic translation.
  // Rendering it directly inside the Arabic error banner below used to leak
  // that raw string to the user. Log the raw detail (for diagnostics) instead
  // of rendering it, and show a fixed Arabic description at the render site.
  const loggedBrowseErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (browseError && loggedBrowseErrorRef.current !== browseError) {
      loggedBrowseErrorRef.current = browseError;
      logError("browse:worker-query", browseError);
    }
  }, [browseError]);

  const browseColumns = useMemo(
    () => buildBrowseColumns(queryResult.pageRows),
    [queryResult.pageRows]
  );
  const orderedColumns = useMemo(
    () => orderBrowseColumns(browseColumns, columnOrder),
    [browseColumns, columnOrder]
  );
  const activeCols = orderedColumns.filter((c) => visibleCols.has(c.key));
  const activeDataset = BROWSE_DATASETS.find((item) => item.id === dataset) ?? BROWSE_DATASETS[0]!;
  const activeFilterCount = Object.values(columnFilters).filter((values) => values.length > 0).length;

  // ── Column-filter dropdown option preview ──
  // Fallback path: exact pre-Task-4 behavior — an unbounded scan over the full
  // in-memory row set (cheap; these datasets are all small — see useWorkerPath's own
  // doc comment above).
  const fallbackFilterOptions = useMemo(() => {
    if (useWorkerPath || !openFilterColumn) return EMPTY_FILTER_PREVIEW;
    const rowsForOpenColumn = monthFilteredRows
      .filter((row) => (debouncedSearch ? rowMatchesSearch(row, debouncedSearch, config.stageMappings) : true))
      .filter((row) => rowMatchesColumnFilters(row, columnFilters, openFilterColumn, config.stageMappings));
    return buildBrowseFilterOptionPreview(
      rowsForOpenColumn,
      columnFilters[openFilterColumn] ?? [],
      (row) => getBrowseDisplayValue(row, openFilterColumn, config.stageMappings),
      compareBrowseFilterOptions,
      DATA_PAGE_SIZE
    );
  }, [useWorkerPath, openFilterColumn, monthFilteredRows, debouncedSearch, columnFilters, config.stageMappings]);

  // Fetches every row matching `params` (not just one page) by looping the same
  // query primitive across pages, up to `maxPages` (Number.POSITIVE_INFINITY for "no
  // cap" — used by export, which needs the complete matching set). Shared by both
  // export and the worker path's filter-dropdown preview (that one bounded — see
  // FILTER_PREVIEW_MAX_PAGES below). `queryOne` abstracts over the worker (async) vs
  // fallback (sync, wrapped as a resolved value) query call so this loop doesn't
  // need to know which path it's running under.
  async function collectMatchingRows(
    params: Pick<PopulationQueryParams, "search" | "columnFilters" | "sort">,
    maxPages: number,
    queryOne: (
      queryParams: PopulationQueryParams
    ) => Promise<PopulationQueryResult<Record<string, unknown>> | null> | PopulationQueryResult<Record<string, unknown>>
  ): Promise<{ rows: BrowseRow[]; complete: boolean }> {
    const collected: BrowseRow[] = [];

    // Phase 1.6: when the caller wants *everything* (the XLSX export passes
    // maxPages = Infinity), ask for it in one query instead of walking pages.
    //
    // runPopulationQuery is stateless — each call re-runs search → filter →
    // sort → slice over the whole dataset — so page-walking an unbounded
    // collection re-sorted the entire month once per 100 rows. On a 400k-row
    // month that is ~4,000 full sorts and ~1.6e9 row visits to produce one file.
    // The bounded filter-preview path (FILTER_PREVIEW_MAX_PAGES) deliberately
    // keeps paging: it wants an early exit after a few pages, not the full set.
    if (maxPages === Infinity) {
      // MAX_SAFE_INTEGER, not Infinity: `pageSlice` computes
      // `(page - 1) * pageSize`, and `0 * Infinity` is NaN — which `Array.slice`
      // coerces to 0 for both bounds and quietly returns an EMPTY array. A
      // finite sentinel takes the same "one page holds everything" branch
      // without that trap.
      const result = await queryOne({
        ...params,
        page: 1,
        pageSize: Number.MAX_SAFE_INTEGER,
      });
      if (!result) {
        return { rows: collected, complete: false };
      }
      return { rows: result.pageRows as BrowseRow[], complete: true };
    }

    let pageNum = 1;
    // Uninitialized: the do-while body always runs at least once and always
    // assigns this before the condition (which reads it) is ever checked, so
    // an initial placeholder value would only ever be dead code.
    let totalPages: number;

    do {
      const result = await queryOne({ ...params, page: pageNum });
      if (!result) {
        // Superseded within this caller's own query lane, or the query failed —
        // stop; caller decides how to treat a partial/interrupted collection.
        return { rows: collected, complete: false };
      }
      collected.push(...(result.pageRows as BrowseRow[]));
      totalPages = result.totalPages;
      pageNum += 1;
      if (collected.length % 1000 === 0) {
        await yieldToMain();
      }
    } while (pageNum <= totalPages && pageNum <= maxPages);

    return { rows: collected, complete: pageNum > totalPages };
  }

  // Worker path: bounded async page-scan (see FILTER_PREVIEW_MAX_PAGES above).
  useEffect(() => {
    if (!useWorkerPath || !openFilterColumn || loadGeneration === 0) {
      return;
    }
    let cancelled = false;
    const filtersExceptOpenColumn = { ...columnFilters };
    delete filtersExceptOpenColumn[openFilterColumn];

    void collectMatchingRows(
      { search: debouncedSearch, columnFilters: filtersExceptOpenColumn, sort: null },
      FILTER_PREVIEW_MAX_PAGES,
      (queryParams) => worker.runQuery(queryParams, FILTER_PREVIEW_QUERY_LANE)
    ).then(({ rows: sampleRows }) => {
      if (cancelled) return;
      const preview = buildBrowseFilterOptionPreview(
        sampleRows,
        columnFilters[openFilterColumn] ?? [],
        (row) => getBrowseDisplayValue(row, openFilterColumn, config.stageMappings),
        compareBrowseFilterOptions,
        DATA_PAGE_SIZE
      );
      setWorkerFilterPreview(preview);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worker.runQuery is useCallback([])-stable
  }, [useWorkerPath, openFilterColumn, loadGeneration, debouncedSearch, columnFilters, config.stageMappings]);

  const openFilterValues = useWorkerPath ? workerFilterPreview : fallbackFilterOptions;

  function saveCurrentPreset(nextOrder: string[], nextVisible: Set<string>): void {
    if (!directoryHandle) {
      return;
    }

    const visibleColumns = Array.from(nextVisible);
    const datasetPreset = {
      columnOrder: nextOrder,
      visibleColumns
    };

    browsePresetRef.current = {
      username,
      browseData: {
        ...(browsePresetRef.current?.browseData ?? {}),
        [dataset]: {
          ...datasetPreset,
          updatedAt: new Date().toISOString()
        }
      }
    };

    // Finding 9: every user persists their OWN personal layout (isolated) —
    // mirrors XrayReferrals.tsx's onColConfigChange call site. Before this,
    // only an admin's column choices were ever written to disk; a non-admin's
    // reorder/show-hide updated the in-memory ref above (so it looked saved
    // for the rest of the session) but vanished on the next reload/relogin.
    void saveUserBrowseDatasetPreset(
      directoryHandle as Parameters<typeof saveUserBrowseDatasetPreset>[0],
      username,
      dataset,
      datasetPreset
    );

    if (readSession()?.role === "admin") {
      void saveAdminBrowseDatasetPreset(
        directoryHandle as Parameters<typeof saveAdminBrowseDatasetPreset>[0],
        dataset,
        datasetPreset
      );
    }
  }

  function handleColumnDrop(targetKey: string): void {
    if (!draggedColumnKey || draggedColumnKey === targetKey) {
      setDraggedColumnKey(null);
      return;
    }

    setColumnOrder((currentOrder) => {
      const currentKeys = orderedColumns.map((column) => column.key);
      const baseOrder = currentOrder.length > 0 ? currentOrder : currentKeys;
      const nextOrder = baseOrder.filter((key) => key !== draggedColumnKey);
      const targetIndex = nextOrder.indexOf(targetKey);

      if (targetIndex === -1) {
        return baseOrder;
      }

      nextOrder.splice(targetIndex, 0, draggedColumnKey);
      saveCurrentPreset(nextOrder, visibleCols);
      return nextOrder;
    });
    setDraggedColumnKey(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLTableCellElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleSortClick(columnKey: string): void {
    setSort((current) => cycleSort(current, columnKey));
    setPage(1);
  }

  function toggleColumnFilterValue(columnKey: string, value: string): void {
    setPage(1);
    setColumnFilters((current) => {
      const selected = new Set(current[columnKey] ?? []);
      if (selected.has(value)) {
        selected.delete(value);
      } else {
        selected.add(value);
      }

      const next = { ...current };
      if (selected.size === 0) {
        delete next[columnKey];
      } else {
        next[columnKey] = Array.from(selected);
      }
      return next;
    });
  }

  function clearColumnFilter(columnKey: string): void {
    setPage(1);
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[columnKey];
      return next;
    });
  }

  function clearAllTableFilters(): void {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearch("");
    setDebouncedSearch("");
    setColumnFilters({});
    setOpenFilterColumn(null);
    setPage(1);
  }

  async function exportFilteredRowsToXlsx(): Promise<void> {
    // Handler boundary (DEFECT 4) — the button is also disabled without this
    // capability, but a stale render must never be able to egress the month.
    if (!canExportReports) {
      setExportError(labels.msg_export_not_permitted);
      return;
    }
    if (isExporting) return;
    setExportError(null);
    setIsExporting(true);
    try {
      const exportParams = { search: debouncedSearch, columnFilters, sort };
      const { rows: allMatchingRows, complete } = await collectMatchingRows(
        exportParams,
        Number.POSITIVE_INFINITY,
        (queryParams) =>
          useWorkerPath
            ? worker.runQuery(queryParams, EXPORT_QUERY_LANE)
            : runPopulationQuery(
                filterRowsByMonth(rows, showAllMonths, globalFolder),
                queryParams,
                (row, key) => getBrowseDisplayValue(row, key, config.stageMappings)
              )
      );

      // Export runs on its own query lane, so a filter/search change mid-export no
      // longer supersedes it (it completes against the params captured at click
      // time — what the user actually asked to export, and it no longer breaks the
      // live table by superseding ITS queries either). This guard stays as the
      // honest handler for a genuinely interrupted collection — a failed query
      // (worker "error" response) also resolves null and lands here.
      if (!complete) {
        setExportError("تعذّر إكمال التصدير بسبب خطأ أثناء قراءة البيانات — حاول مرة أخرى.");
        return;
      }

      const header = activeCols.map((column) => column.label);
      const body: string[][] = [];
      for (let i = 0; i < allMatchingRows.length; i += EXPORT_CHUNK_SIZE) {
        const chunk = allMatchingRows.slice(i, i + EXPORT_CHUNK_SIZE);
        for (const row of chunk) {
          body.push(
            activeCols.map((column) => getBrowseDisplayValue(row, column.key, config.stageMappings))
          );
        }
        if (allMatchingRows.length > EXPORT_CHUNK_SIZE) {
          await yieldToMain();
        }
      }
      const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "البيانات");

      const monthName =
        showAllMonths || !globalFolder
          ? labels.gm_all_months
          : formatMonthFolderShortLabel(globalFolder);
      const fileName = safeExportFileName(
        `البيانات - ${activeDataset.label} - ${monthName}.xlsx`
      );

      XLSX.writeFile(workbook, fileName);
    } catch (err) {
      // Finding 10(a): this was a bare try/finally — a thrown error (a
      // rejected collectMatchingRows call, an XLSX build failure) surfaced as
      // an unhandled rejection while the finally block cleared `isExporting`
      // as if the export had actually succeeded, and the already-wired
      // `exportError` banner never appeared.
      logError("browse:export", err);
      setExportError("تعذّر تصدير البيانات بسبب خطأ غير متوقع — حاول مرة أخرى.");
    } finally {
      setIsExporting(false);
    }
  }

  if (!directoryHandle) {
    return (
      <div className="placeholder-phase" style={{ marginTop: 40 }}>
        <p>يجب اختيار مساحة عمل أولاً.</p>
      </div>
    );
  }

  return (
    <section className="browse-data-view" aria-label="البيانات">
      <PageHeader
        eyebrow="استعراض البيانات"
        title="البيانات"
        subtitle={activeDataset.description}
      >
        <div className="bv-header-actions">
          <label className="bv-month-filter" htmlFor="browseAllMonths">
            <input
              id="browseAllMonths"
              type="checkbox"
              checked={showAllMonths}
              onChange={(event) => setShowAllMonths(event.target.checked)}
            />
            <span>{labels.gm_all_months}</span>
          </label>
        </div>
      </PageHeader>

      <div className="bv-dataset-row">
        <div className="bv-dataset-toggle" role="group" aria-label="مصدر البيانات">
          {BROWSE_DATASETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`bv-toggle-btn${dataset === item.id ? " active" : ""}`}
              onClick={() => setDataset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {browseError && (
        <ErrorState
          title="تعذّر تحميل بيانات هذا الشهر"
          description="تعذّرت قراءة ملف المجتمع النهائي أو الاستعلام عنه. تم تسجيل تفاصيل الخطأ لمراجعة الدعم الفني."
        />
      )}

      {/* A10 (perf/sync enhancement 2026-08-12): blank only on the very first
          load for this component's lifetime (loadGeneration === 0). A later
          reload (refreshKey bump, dataset/month switch) instead keeps
          queryResult's already-rendered rows on screen -- see the load
          effect's own comment: it never clears `rows`/`queryResult` when a
          reload starts, only when the reload's own new data lands -- and
          renders a dimmed overlay instead of unmounting the table (F24). */}
      {!browseError && loading && loadGeneration === 0 && (
        <LoadingState label={showAllMonths ? "جاري تحميل بيانات جميع الأشهر..." : "جاري تحميل بيانات الشهر المحدد..."} />
      )}

      {/* NOT gated on loadGeneration: the load effect above early-returns while
          `!directoryHandle || !isPresetLoaded`, leaving loading=false and
          loadGeneration=0 -- gating this on loadGeneration would render an
          empty panel instead of the empty state in exactly that window, which
          A1 makes the manager's landing view. `!loading` is sufficient to
          exclude both the initial load and a refresh, since isRefreshing
          implies loading. */}
      {!browseError && !loading && total === 0 && (
        <EmptyState
          icon={<Database />}
          title="لا توجد بيانات محفوظة لهذا المصدر بعد"
          description="ابدأ بمعالجة شهر من تبويب معالجة المجتمع لتظهر بياناته هنا."
        />
      )}

      {!browseError && loadGeneration > 0 && (isRefreshing || total > 0) && (
        <div className={`bv-table-view${isRefreshing ? " bv-table-view-refreshing" : ""}`} aria-busy={isRefreshing}>
          {isRefreshing && (
            <div className="bv-table-refresh-overlay" role="status" aria-live="polite">
              جاري التحديث...
            </div>
          )}
          {/* Toolbar */}
          <div className="bv-table-toolbar">
            <input
              type="text"
              className="bv-search"
              placeholder="بحث في جميع الأعمدة..."
              value={search}
              onChange={(e) => {
                const v = e.target.value;
                setSearch(v);
                setPage(1);
                if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                searchDebounceRef.current = setTimeout(
                  () => setDebouncedSearch(v.trim().toLowerCase()),
                  200
                );
              }}
            />
            <span className="bv-row-count">
              {queryResult.totalRows.toLocaleString("ar-SA-u-nu-latn")} صف
              {(search || activeFilterCount > 0) && ` من ${total.toLocaleString("ar-SA-u-nu-latn")}`}
            </span>
            <button
              type="button"
              className="bv-export-btn"
              onClick={exportFilteredRowsToXlsx}
              disabled={!canExportReports || activeCols.length === 0 || isExporting}
              aria-busy={isExporting}
              title={canExportReports ? undefined : labels.msg_export_not_permitted}
            >
              {isExporting ? labels.dt_exporting : "تصدير XLSX"}
            </button>
            {exportError && (
              <span className="bv-export-error" role="alert">
                {exportError}
              </span>
            )}
            {(search || activeFilterCount > 0) && (
              <button
                type="button"
                className="bv-clear-filters-btn"
                onClick={clearAllTableFilters}
              >
                مسح التصفية
              </button>
            )}
            <div className="bv-col-picker-wrap">
              <button
                type="button"
                className="bv-col-picker-btn"
                onClick={() => {
                  // Mutually exclusive with the per-column filter menu, as in
                  // DataTable: two floating panels open at once left two live
                  // focus traps fighting over Tab and Escape.
                  setColPickerOpen((o) => !o);
                  setOpenFilterColumn(null);
                }}
              >
                <Settings2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> الأعمدة ({visibleCols.size})
              </button>
              {colPickerOpen && (
                <div
                  className="bv-col-picker-dropdown"
                  ref={colPickerFocusTrapRef}
                  role="dialog"
                  aria-label="اختيار الأعمدة"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  {orderedColumns.map((c) => (
                    <label key={c.key} className="bv-col-option">
                      <input
                        type="checkbox"
                        checked={visibleCols.has(c.key)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          setVisibleCols((prev) => {
                            const next = new Set(prev);
                            if (next.has(c.key)) { next.delete(c.key); } else { next.add(c.key); }
                            saveCurrentPreset(columnOrder, next);
                            return next;
                          });
                        }}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bv-table-scroll">
            <table className="bv-table">
              <thead>
                <tr>
                  {activeCols.map((c) => (
                    <th
                      key={c.key}
                      className={`bv-th bv-th-draggable${draggedColumnKey === c.key ? " dragging" : ""}`}
                      draggable
                      title="اسحب العمود لتغيير ترتيبه"
                      onDragStart={(event) => {
                        setDraggedColumnKey(c.key);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", c.key);
                      }}
                      onDragOver={handleColumnDragOver}
                      onDrop={() => handleColumnDrop(c.key)}
                      onDragEnd={() => setDraggedColumnKey(null)}
                    >
                      <div className="bv-th-content">
                        <span className="bv-th-actions">
                          <span className="bv-th-grip" aria-hidden="true">⋮⋮</span>
                        </span>
                        <button
                          type="button"
                          className={`bv-sort-btn${sort?.column === c.key ? " active" : ""}`}
                          aria-label={
                            sort?.column === c.key
                              ? `ترتيب حسب ${c.label} (${sort.direction === "asc" ? "تصاعدي" : "تنازلي"})`
                              : `ترتيب حسب ${c.label}`
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSortClick(c.key);
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                          draggable={false}
                        >
                          {sort?.column === c.key ? (
                            sort.direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                          ) : (
                            <ChevronUp size={13} className="bv-sort-btn-idle-icon" />
                          )}
                        </button>
                        <button
                          type="button"
                          className={`bv-filter-btn${columnFilters[c.key]?.length ? " active" : ""}`}
                          aria-label={`تصفية ${c.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenFilterColumn((current) => current === c.key ? null : c.key);
                            setColPickerOpen(false);
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                          draggable={false}
                        >
                          ▾
                        </button>
                        <span className="bv-th-label">{c.label}</span>
                      </div>
                      {openFilterColumn === c.key && (
                        <div
                          className="bv-column-filter-menu"
                          ref={filterMenuFocusTrapRef}
                          role="dialog"
                          aria-label={`تصفية ${c.label}`}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <div className="bv-filter-menu-head">
                            <strong>{c.label}</strong>
                            <button
                              type="button"
                              onClick={() => clearColumnFilter(c.key)}
                              disabled={!columnFilters[c.key]?.length}
                            >
                              مسح
                            </button>
                          </div>
                          <div className="bv-filter-options">
                            {openFilterValues.options.length === 0 && (
                              <span className="bv-filter-empty">لا توجد خيارات</span>
                            )}
                            {openFilterValues.options.map((option) => (
                              <label key={option} className="bv-filter-option">
                                <input
                                  type="checkbox"
                                  checked={(columnFilters[c.key] ?? []).includes(option)}
                                  onChange={() => toggleColumnFilterValue(c.key, option)}
                                />
                                <span title={option}>{option}</span>
                              </label>
                            ))}
                            {openFilterValues.truncated && (
                              <span className="bv-filter-empty">عرض أول 100 قيمة. استخدم البحث للوصول إلى قيم أخرى.</span>
                            )}
                          </div>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queryResult.pageRows.map((row, i) => (
                  <tr key={`${page}-${i}`} className={i % 2 === 0 ? "bv-row-even" : ""}>
                    {activeCols.map((c) => {
                      const val = getBrowseDisplayValue(row, c.key, config.stageMappings);
                      return <td key={c.key} className="bv-td">{val}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalItems={queryResult.totalRows}
            onPageChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      )}
    </section>
  );
}
