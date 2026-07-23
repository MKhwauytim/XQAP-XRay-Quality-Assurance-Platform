import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import * as XLSX from "xlsx";
import { Database, Settings2 } from "lucide-react";

import { readSession } from "../../../../auth/authSession";
import {
  loadBrowseRows,
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
  type UserBrowsePresetFile
} from "../../../../data/preferences/browsePresetStorage";
import { useGlobalMonth } from "../../../../data/month/useGlobalMonth";
import { useLabels } from "../../../../data/labels/useLabels";
import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { EmptyState, LoadingState } from "../../../../components/StateViews/StateViews";
import Pagination from "../../../../components/Pagination/Pagination";
import { DATA_PAGE_SIZE, clampPage, pageSlice } from "../../../../components/Pagination/paginationUtils";
import { formatStageLabel } from "./components/helpers";
import { buildBrowseFilterOptionPreview } from "./browseFilterOptions";

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
  search: string,
  stageMappings?: PopulationConfig["stageMappings"]
): boolean {
  const normalizedSearch = search.trim().toLowerCase();
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

export default function BrowseDataView({
  directoryHandle,
  refreshKey,
  username,
  config
}: {
  directoryHandle: unknown;
  refreshKey: number;
  username: string;
  config: PopulationConfig;
}) {
  const { selection: globalMonth } = useGlobalMonth();
  const labels = useLabels();
  const [showAllMonths, setShowAllMonths] = useState(false);
  const globalFolder = globalMonth.kind === "none" ? null : globalMonth.folderName;
  const [dataset, setDataset] = useState<BrowseDatasetKind>("population");
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const rowsPageKey = `${rows.length}:${rows[0]?._monthFolder ?? ""}:${rows[0]?.xrayImageId ?? ""}:${rows.at(-1)?._monthFolder ?? ""}:${rows.at(-1)?.xrayImageId ?? ""}`;
  const [pageState, setPageState] = useState<{ rowsKey: string; page: number }>(() => ({ rowsKey: rowsPageKey, page: 1 }));

  useEffect(() => {
    if (!directoryHandle) {
      browsePresetRef.current = null;
      const id = setTimeout(() => setIsPresetLoaded(true), 0);
      return () => clearTimeout(id);
    }

    const loadingId = setTimeout(() => setIsPresetLoaded(false), 0);
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
    return () => clearTimeout(loadingId);
  }, [directoryHandle, username]);

  useEffect(() => {
    if (!directoryHandle || !isPresetLoaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading indicator before async browse row load; necessary to show spinner while data fetches
    setLoading(true);
    loadBrowseRows(
      directoryHandle as Parameters<typeof loadBrowseRows>[0],
      dataset,
      showAllMonths ? undefined : globalFolder ?? undefined
    )
      .then((nextRows) => {
        const nextColumns = buildBrowseColumns(nextRows);
        const datasetPreset = browsePresetRef.current?.browseData[dataset];
        const nextOrder = mergeColumnOrder(
          datasetPreset?.columnOrder,
          defaultColumnOrderKeys(dataset, nextColumns)
        );
        const nextVisible = resolveVisibleColumns(
          dataset,
          nextColumns,
          datasetPreset?.visibleColumns
        );

        setRows(nextRows);
        setColumnOrder(nextOrder);
        setVisibleCols(nextVisible);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [dataset, directoryHandle, globalFolder, isPresetLoaded, refreshKey, showAllMonths]);

  const monthFilteredRows = useMemo(
    () =>
      showAllMonths || !globalFolder
        ? rows
        : rows.filter((row) => row._monthFolder === globalFolder),
    [rows, showAllMonths, globalFolder]
  );
  // LINT-01c: Instead of a setState-in-effect, reset column filters by
  // deriving the key from `dataset` and using it as a React key on the
  // filter container (see BrowseDataView render). Here we set state
  // safely inside a microtask to avoid the synchronous-setState lint error.
  useEffect(() => {
    const id = setTimeout(() => {
      setColumnFilters({});
      setOpenFilterColumn(null);
    }, 0);
    return () => clearTimeout(id);
  }, [dataset]);

  // ── Derived stats ──
  const total = monthFilteredRows.length;

  const browseColumns = useMemo(() => buildBrowseColumns(rows), [rows]);
  const orderedColumns = useMemo(
    () => orderBrowseColumns(browseColumns, columnOrder),
    [browseColumns, columnOrder]
  );
  const activeCols = orderedColumns.filter((c) => visibleCols.has(c.key));
  const activeDataset = BROWSE_DATASETS.find((item) => item.id === dataset) ?? BROWSE_DATASETS[0]!;

  // ── Filtered table rows ──
  const searchFilteredRows = useMemo(
    () => search.trim()
      ? monthFilteredRows.filter((row) => rowMatchesSearch(row, search, config.stageMappings))
      : monthFilteredRows,
    [monthFilteredRows, search, config.stageMappings]
  );
  const filteredRows = useMemo(
    () => Object.values(columnFilters).some((values) => values.length > 0)
      ? searchFilteredRows.filter((row) =>
          rowMatchesColumnFilters(row, columnFilters, undefined, config.stageMappings)
        )
      : searchFilteredRows,
    [columnFilters, searchFilteredRows, config.stageMappings]
  );
  const requestedPage = pageState.rowsKey === rowsPageKey ? pageState.page : 1;
  const page = clampPage(requestedPage, filteredRows.length, DATA_PAGE_SIZE);
  const pagedRows = useMemo(() => pageSlice(filteredRows, page), [filteredRows, page]);
  const activeFilterCount = Object.values(columnFilters).filter((values) => values.length > 0).length;
  const openFilterValues = useMemo(() => {
    if (!openFilterColumn) return { options: [] as string[], truncated: false };
    // Build the option list from rows filtered by every OTHER active column
    // filter (and search) but NOT this column's own filter. Reusing the fully
    // filtered `filteredRows` here caused a "single-select collapse": once a
    // value was checked, `filteredRows` was already restricted to rows
    // matching that value, so every other option vanished from the dropdown.
    const rowsForOpenColumn = searchFilteredRows.filter((row) =>
      rowMatchesColumnFilters(row, columnFilters, openFilterColumn, config.stageMappings)
    );
    return buildBrowseFilterOptionPreview(
      rowsForOpenColumn,
      columnFilters[openFilterColumn] ?? [],
      (row) => getBrowseDisplayValue(row, openFilterColumn, config.stageMappings),
      compareBrowseFilterOptions,
      DATA_PAGE_SIZE,
    );
  }, [openFilterColumn, columnFilters, searchFilteredRows, config.stageMappings]);
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

  function toggleColumnFilterValue(columnKey: string, value: string): void {
    setPageState({ rowsKey: rowsPageKey, page: 1 });
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
    setPageState({ rowsKey: rowsPageKey, page: 1 });
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[columnKey];
      return next;
    });
  }

  function clearAllTableFilters(): void {
    setSearch("");
    setColumnFilters({});
    setOpenFilterColumn(null);
    setPageState({ rowsKey: rowsPageKey, page: 1 });
  }

  function exportFilteredRowsToXlsx(): void {
    const header = activeCols.map((column) => column.label);
    const body = filteredRows.map((row) =>
      activeCols.map((column) => getBrowseDisplayValue(row, column.key, config.stageMappings))
    );
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

      {loading && <LoadingState label={showAllMonths ? "جاري تحميل بيانات جميع الأشهر..." : "جاري تحميل بيانات الشهر المحدد..."} />}

      {!loading && total === 0 && (
        <EmptyState
          icon={<Database />}
          title="لا توجد بيانات محفوظة لهذا المصدر بعد"
          description="ابدأ بمعالجة شهر من تبويب معالجة المجتمع لتظهر بياناته هنا."
        />
      )}

      {!loading && total > 0 && (
        <div className="bv-table-view">
          {/* Toolbar */}
          <div className="bv-table-toolbar">
            <input
              type="text"
              className="bv-search"
              placeholder="بحث في جميع الأعمدة..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPageState({ rowsKey: rowsPageKey, page: 1 }); }}
            />
            <span className="bv-row-count">
              {filteredRows.length.toLocaleString("ar-SA-u-nu-latn")} صف
              {(search || activeFilterCount > 0) && ` من ${total.toLocaleString("ar-SA-u-nu-latn")}`}
            </span>
            <button
              type="button"
              className="bv-export-btn"
              onClick={exportFilteredRowsToXlsx}
              disabled={activeCols.length === 0}
            >
              تصدير XLSX
            </button>
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
                onClick={() => setColPickerOpen((o) => !o)}
              >
                <Settings2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 4 }} /> الأعمدة ({visibleCols.size})
              </button>
              {colPickerOpen && (
                <div
                  className="bv-col-picker-dropdown"
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
                          className={`bv-filter-btn${columnFilters[c.key]?.length ? " active" : ""}`}
                          aria-label={`تصفية ${c.label}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenFilterColumn((current) => current === c.key ? null : c.key);
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
                {pagedRows.map((row, i) => (
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
            totalItems={filteredRows.length}
            onPageChange={(nextPage) => setPageState({ rowsKey: rowsPageKey, page: nextPage })}
          />
        </div>
      )}
    </section>
  );
}
