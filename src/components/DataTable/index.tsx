import { Eye, EyeOff, Maximize2 } from "lucide-react";
import { yieldToMain } from "../../data/storage/yieldToMain";
import {
  Fragment,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
} from "react";
import * as XLSX from "xlsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLabels } from "../../data/labels/useLabels";
import { registerPendingSaveFlush } from "../../data/storage/pendingSaveFlush";
import Pagination from "../Pagination/Pagination";
import { DATA_PAGE_SIZE, clampPage, pageSlice } from "../../utils/paginationUtils";
import "./DataTable.css";
import {
  type DateFormatMode,
  DATE_FORMAT_LABELS,
  looksLikeDate,
  looksLikeNumber,
  toIsoDate,
  isFilterEmpty,
  type DateFilter,
  type AnyFilter,
  type FiltersMap,
} from "./utils";

// ── Public types ──────────────────────────────────────────────────────────────

/** Column definition – generic over the row type */
export type DataTableCol<TRow = unknown> = {
  id: string;
  label: string;
  /** Relative width unit (like CSS fr). Default 1. */
  widthFr?: number;
  alwaysVisible?: boolean;
  adminOnly?: boolean;
  /** Hard-codes this column as a date column (skips auto-detection). */
  isDate?: boolean;
  /**
   * Hard-codes this column as numeric (skips auto-detection). Numeric columns
   * are end-aligned (not hard-coded "right" — this app is RTL, so "end" is
   * the correct logical direction for digits) with tabular figures.
   */
  isNumeric?: boolean;
  /** Which filter UI to show. Auto-detected if omitted (defaults to "multiselect"). */
  filterKind?: "text" | "date" | "status" | "multiselect";
  /** Options for status filter. Required when filterKind === "status". */
  statusOptions?: Array<{ value: string; label: string }>;
  /** Returns the raw string value for this column (used for filtering & auto-date-detect). */
  accessor: (row: TRow) => string | null;
};

export type ColConfig = {
  order: string[];
  hidden: string[];
  dateFmt: Record<string, DateFormatMode>;
  /** Per-column width overrides in fr units (proportional). */
  widths?: Record<string, number>;
};

export type CellMeta = {
  /** True if this column is a date column (explicit or auto-detected). */
  isDate: boolean;
  /** Active date display format for this column. */
  dateFmt: DateFormatMode;
  /** True if this column is numeric (explicit or auto-detected). */
  isNumeric: boolean;
};

export type DataTableProps<TRow = unknown> = {
  columns: DataTableCol<TRow>[];
  rows: TRow[];
  getRowKey: (row: TRow) => string;
  renderCell: (col: DataTableCol<TRow>, row: TRow, meta: CellMeta) => ReactNode;
  /**
   * @deprecated No longer read internally — column config now derives purely
   * from `columns` / `defaultVisible` / `initialColConfig`, and persistence is
   * the caller's responsibility via `onColConfigChange`. Kept optional (rather
   * than removed) so existing call sites don't need to change; safe to delete
   * once they do.
   */
  storageKey?: string;
  defaultVisible?: string[];
  isAdmin?: boolean;
  /**
   * Per-row custom filter override.
   * Return true/false to override default logic for (row, colId).
   * Return null/undefined to fall through to default logic.
   */
  rowMatchesFilter?: (row: TRow, colId: string, filter: AnyFilter) => boolean | null | undefined;
  /** Key of the currently expanded row (for inline forms). */
  expandedKey?: string | null;
  /** Render the expanded content below the row. */
  renderExpanded?: (row: TRow, colCount: number) => ReactNode;
  onRowClick?: (row: TRow) => void;
  getRowClassName?: (row: TRow) => string | undefined;
  /** Extra controls to render on the right side of the toolbar (month selectors, etc.). */
  toolbarStart?: ReactNode;
  /** Extra controls injected between the search box and the export button (left side). */
  toolbarEndExtra?: ReactNode;
  /** Shows the column picker when true. Defaults to true for existing tables. */
  canConfigureColumns?: boolean;
  /** If provided, shows an XLSX export button that downloads visible+filtered rows. */
  exportFileName?: string;
  /**
   * Seed the column config from an external source (e.g. a per-user file preset).
   * Takes precedence over defaults when provided. Call onColConfigChange to
   * persist to a durable store such as the selected workspace file.
   */
  initialColConfig?: ColConfig;
  /**
   * Called (debounced 800 ms) whenever the user changes column order, visibility,
   * widths, or date formats. Use this to persist the config to a per-user file.
   */
  onColConfigChange?: (cfg: ColConfig) => void;
  /** Reports the rows currently visible after global search and column filters. */
  onFilteredRowsChange?: (rows: TRow[]) => void;
  /** Visual density for this table. Defaults to normal. */
  density?: "normal" | "compact";
  /** Column ids that should remain pinned to the RTL start edge while scrolling horizontally. */
  stickyColumnIds?: string[];
};

// ── Column config ────────────────────────────────────────────────────────────

function buildDefault<TRow>(
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  const visSet = defaultVisible ? new Set(defaultVisible) : null;
  // Column order must follow defaultVisible's intended arrangement first (so
  // e.g. a status column meant to sit next to the id column actually does),
  // then append any remaining columns in their definition order.
  const known = new Set(columns.map((c) => c.id));
  const orderedVisible = defaultVisible ? defaultVisible.filter((id) => known.has(id)) : [];
  const orderedVisibleSet = new Set(orderedVisible);
  const rest = columns.map((c) => c.id).filter((id) => !orderedVisibleSet.has(id));
  return {
    order: [...orderedVisible, ...rest],
    hidden: columns
      .filter((c) => visSet ? !visSet.has(c.id) : false)
      .map((c) => c.id),
    dateFmt: {},
    widths: {},
  };
}

function loadColConfig<TRow>(
  columns: DataTableCol<TRow>[],
  defaultVisible?: string[]
): ColConfig {
  return buildDefault(columns, defaultVisible);
}

// ── Filter utilities ──────────────────────────────────────────────────────────

function defaultRowMatchesFilter<TRow>(
  row: TRow,
  col: DataTableCol<TRow>,
  filter: AnyFilter,
  detectedDates: Set<string>
): boolean {
  if (isFilterEmpty(filter)) return true;

  const raw = col.accessor(row);

  if (filter.kind === "date") {
    if (!raw) return false;
    if (col.isDate || detectedDates.has(col.id)) {
      const ds = toIsoDate(raw);
      if (filter.mode === "single") return !filter.single || ds === filter.single;
      return (!filter.from || ds >= filter.from) && (!filter.to || ds <= filter.to);
    }
    return true;
  }

  if (filter.kind === "text") {
    if (!filter.value) return true;
    if (!raw) return false;
    return raw.toLowerCase().includes(filter.value.toLowerCase());
  }

  // status — default: treat accessor value as the status string
  if (filter.kind === "status") {
    if (filter.value === "all" || !filter.value) return true;
    return raw === filter.value;
  }

  // multiselect — row passes if its value is one of the selected options
  if (filter.kind === "multiselect") {
    if (filter.values.length === 0) return true;
    return filter.values.includes(raw ?? "");
  }

  return true;
}

const STAGE_OPTION_ORDER: Record<string, number> = {
  "المستوى الأول": 1,
  "المستوى الثاني": 2,
  "المستوى الثالث": 3,
  "المستوى الرابع": 4,
};

function compareFilterOptions(first: string, second: string): number {
  const firstStageOrder = STAGE_OPTION_ORDER[first];
  const secondStageOrder = STAGE_OPTION_ORDER[second];
  if (firstStageOrder !== undefined || secondStageOrder !== undefined) {
    return (firstStageOrder ?? Number.MAX_SAFE_INTEGER) - (secondStageOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return first.localeCompare(second, "ar");
}

// Same yieldToMain idiom used by populationProcessor.ts / riskDataWorkbook.ts —
// defined locally per-file rather than shared across tab boundaries.

// ── Main component ────────────────────────────────────────────────────────────

export default function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  renderCell,
  defaultVisible,
  isAdmin = false,
  rowMatchesFilter,
  expandedKey,
  renderExpanded,
  onRowClick,
  getRowClassName,
  toolbarStart,
  toolbarEndExtra,
  canConfigureColumns = true,
  exportFileName,
  initialColConfig,
  onColConfigChange,
  onFilteredRowsChange,
  density = "normal",
  stickyColumnIds = [],
}: DataTableProps<TRow>) {
  const L = useLabels();

  const [colCfg, setColCfgState] = useState<ColConfig>(() => {
    if (initialColConfig) return initialColConfig;
    return loadColConfig(columns, defaultVisible);
  });

  // Debounce timer ref for onColConfigChange
  const colChangeDebouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending-config ref so a tab-close/backgrounding flush (registered below)
  // can see the latest config even though it fires outside setColCfg's closure.
  const pendingColCfgRef = useRef<ColConfig | null>(null);
  // Latest-ref for onColConfigChange: the flush-registration effect below has an
  // empty dep array (it must register/unregister exactly once), so it can't close
  // over the prop directly without going stale across re-renders that pass a new
  // onColConfigChange identity (e.g. a caller's inline handler closing over
  // directoryHandle/username). Kept fresh every render (same idiom as
  // useFocusTrap's onEscapeRef / useCanvasInteractions' onElementChangeRef) so the
  // flush callback always reads the current value via the ref instead.
  const onColConfigChangeRef = useRef(onColConfigChange);
  useEffect(() => {
    onColConfigChangeRef.current = onColConfigChange;
  });
  const [colPickerOpen, setColPickerOpen]       = useState(false);
  const [colPickerAnchorRect, setColPickerAnchorRect] = useState<DOMRect | null>(null);
  const [openFilterCol, setOpenFilterCol]       = useState<string | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [filters, setFilters]                   = useState<FiltersMap>({});
  const [isExporting, setIsExporting]            = useState(false);
  const detectedDates = useMemo<Set<string>>(() => {
    const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
    const detected = new Set<string>();
    for (const col of columns) {
      if (col.isDate) { detected.add(col.id); continue; }
      if (col.filterKind === "status") continue;
      for (const row of sample) {
        const v = col.accessor(row);
        if (v && looksLikeDate(v)) { detected.add(col.id); break; }
      }
    }
    return detected;
  }, [rows, columns]);
  // Numeric-column auto-detection (B5): mirrors detectedDates above, so a
  // column that isn't explicitly typed still gets end-aligned tabular figures
  // when every sampled value looks like a plain number. Dates and explicitly
  // categorical columns (status/multiselect) are never candidates.
  const detectedNumeric = useMemo<Set<string>>(() => {
    const sample = rows.length > 200 ? rows.slice(0, 200) : rows;
    const detected = new Set<string>();
    for (const col of columns) {
      if (col.isNumeric) { detected.add(col.id); continue; }
      if (col.isDate || detectedDates.has(col.id)) continue;
      if (col.filterKind === "status" || col.filterKind === "multiselect") continue;
      let sawValue = false;
      let allNumeric = true;
      for (const row of sample) {
        const v = col.accessor(row);
        if (!v) continue;
        sawValue = true;
        if (!looksLikeNumber(v)) { allNumeric = false; break; }
      }
      if (sawValue && allNumeric) detected.add(col.id);
    }
    return detected;
  }, [rows, columns, detectedDates]);
  const [globalSearch, setGlobalSearch]         = useState("");
  const [debouncedSearch, setDebouncedSearch]   = useState("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragColRef   = useRef<string | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const tableRef     = useRef<HTMLTableElement>(null);
  const resizeRef    = useRef<{
    colIdx: number;
    startX: number;
    startWs: number[];
    totalFr: number;
    tableW: number;
  } | null>(null);
  const rowsPageKey = `${rows.length}:${rows[0] ? getRowKey(rows[0]) : ""}:${rows.at(-1) ? getRowKey(rows.at(-1)!) : ""}`;
  const [pageState, setPageState] = useState<{ rowsKey: string; page: number }>(() => ({ rowsKey: rowsPageKey, page: 1 }));

  function setColCfg(c: ColConfig): void {
    setColCfgState(c);
    if (onColConfigChange) {
      pendingColCfgRef.current = c;
      if (colChangeDebouncerRef.current) clearTimeout(colChangeDebouncerRef.current);
      colChangeDebouncerRef.current = setTimeout(() => {
        colChangeDebouncerRef.current = null;
        pendingColCfgRef.current = null;
        onColConfigChange(c);
      }, 800);
    }
  }

  // When an external initialColConfig arrives (async file load), seed state once.
  const initialSyncedRef = useRef(false);
  useEffect(() => {
    if (initialColConfig && !initialSyncedRef.current) {
      initialSyncedRef.current = true;
      setColCfgState(initialColConfig);
    }
  }, [initialColConfig]);

  // Flush the pending debounced column-config write on tab close/backgrounding
  // (registry-driven -- covers pagehide/visibilitychange, which unmount alone
  // doesn't) and on unmount, so a debounce-routed change (reorder, show/hide,
  // date-format, reset-to-default, or auto-fit) made <800ms before either
  // event isn't silently discarded. Drag-resize is NOT covered by this --
  // handleResizeMouseDown's onUp persists via onColConfigChange immediately
  // on mouseup, bypassing the debounce entirely, so it was never at risk.
  useEffect(() => {
    const unregister = registerPendingSaveFlush(() => {
      if (colChangeDebouncerRef.current !== null && pendingColCfgRef.current !== null && onColConfigChangeRef.current) {
        clearTimeout(colChangeDebouncerRef.current);
        colChangeDebouncerRef.current = null;
        const pending = pendingColCfgRef.current;
        pendingColCfgRef.current = null;
        onColConfigChangeRef.current(pending);
      }
    });
    return () => {
      unregister();
      if (colChangeDebouncerRef.current !== null && pendingColCfgRef.current !== null && onColConfigChangeRef.current) {
        clearTimeout(colChangeDebouncerRef.current);
        colChangeDebouncerRef.current = null;
        const pending = pendingColCfgRef.current;
        pendingColCfgRef.current = null;
        onColConfigChangeRef.current(pending);
      }
    };
    // Deliberately empty deps: register once on mount, unregister + flush exactly
    // once on unmount. No exhaustive-deps suppression needed -- everything read
    // above is a ref (colChangeDebouncerRef, pendingColCfgRef, onColConfigChangeRef)
    // or the stable registerPendingSaveFlush import, neither of which the rule
    // requires as a dependency. onColConfigChangeRef.current is always the latest
    // prop value (synced every render by the effect above), so this effect never
    // needs onColConfigChange itself as a dependency to stay correct.
  }, []);

  // Close filter menu when table scrolls (button has moved, position would be stale).
  // Row virtualisation itself (viewport size + scroll-position tracking, including
  // its own ResizeObserver on the scroll container) is now owned by
  // `rowVirtualizer` below.
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const handleScroll = () => setOpenFilterCol(null);
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Reconcile the persisted column order with the current column set:
  //  • keep known ids in their saved position,
  //  • prepend any missing alwaysVisible columns (e.g. the row-select checkbox),
  //  • append any other columns added after the config was persisted (so a newly
  //    added column like "تاريخ رصد الخبير" never silently vanishes),
  //  • drop ids for columns that no longer exist.
  // visibleCols and the drag handlers all read from this normalized order.
  const normalizedOrder = useMemo(() => {
    const known = new Set(columns.map((c) => c.id));
    const kept = colCfg.order.filter((id) => known.has(id));
    const keptSet = new Set(kept);
    const missingAlways = columns.filter((c) => c.alwaysVisible && !keptSet.has(c.id)).map((c) => c.id);
    const missingRest = columns.filter((c) => !c.alwaysVisible && !keptSet.has(c.id)).map((c) => c.id);
    return [...missingAlways, ...kept, ...missingRest];
  }, [columns, colCfg.order]);

  // Visible columns: normalized order, not hidden, respecting adminOnly.
  const visibleCols = useMemo(
    () => normalizedOrder
      .map((id) => columns.find((c) => c.id === id))
      .filter((c): c is DataTableCol<TRow> => !!c)
      .filter((c) => !colCfg.hidden.includes(c.id) && (!c.adminOnly || isAdmin)),
    [normalizedOrder, columns, colCfg.hidden, isAdmin]
  );

  // Global search — match any visible column's raw value (debounced to avoid per-keystroke scans)
  const searchTerm = debouncedSearch;
  const searchFilteredRows = useMemo(
    () => !searchTerm
      ? rows
      : rows.filter((row) =>
          visibleCols.some((col) => {
            const v = col.accessor(row);
            return v ? v.toLowerCase().includes(searchTerm) : false;
          })
        ),
    [rows, searchTerm, visibleCols]
  );

  // Column filters applied on top of search
  const filteredRows = useMemo(
    () => {
      const hasColumnFilters = Object.values(filters).some((filter) => !isFilterEmpty(filter));
      if (!hasColumnFilters) return searchFilteredRows;
      return searchFilteredRows.filter((row) =>
        visibleCols.every((col) => {
          const f = filters[col.id];
          if (!f || isFilterEmpty(f)) return true;
          const custom = rowMatchesFilter?.(row, col.id, f);
          if (custom !== null && custom !== undefined) return custom;
          return defaultRowMatchesFilter(row, col, f, detectedDates);
        })
      );
    },
    [searchFilteredRows, visibleCols, filters, rowMatchesFilter, detectedDates]
  );

  const requestedPage = pageState.rowsKey === rowsPageKey ? pageState.page : 1;
  const page = clampPage(requestedPage, filteredRows.length, DATA_PAGE_SIZE);
  const pageRows = useMemo(
    () => pageSlice(filteredRows, page, DATA_PAGE_SIZE),
    [filteredRows, page]
  );

  function changePage(nextPage: number): void {
    setPageState({ rowsKey: rowsPageKey, page: nextPage });
    // `scrollToOffset` updates the virtualizer's own tracked scroll position
    // synchronously (not just the DOM), which a raw `tableWrap.scrollTop = 0`
    // can't rely on -- jsdom (this component's tests) never dispatches the
    // native `scroll` event on a programmatic scrollTop write, and even in a
    // real browser that event is asynchronous, so the virtualizer would
    // render one stale frame at the old window before catching up.
    rowVirtualizer.scrollToOffset(0);
  }

  // LOG-03: only notify when the visible rows actually changed. filteredRows can
  // get a fresh array identity on every render when a consumer passes an
  // unstable rowMatchesFilter; emitting each time loops consumers that store
  // the rows in state.
  //
  // useLayoutEffect (not useEffect) is deliberate: this notification calls a
  // consumer-supplied callback (typically a parent setState, e.g. XrayReferrals'
  // `setFilteredTableEntries`) that other click handlers in the parent read
  // synchronously at click time (e.g. "reassign all filtered"/"select all
  // filtered" buttons). filteredRows itself is already computed synchronously
  // during THIS render via useMemo above; the only reason a consumer's mirrored
  // state could ever lag behind what's on screen is if forwarding it runs in a
  // passive effect, which React defers relative to the parent's own commit and
  // to real user input. A layout effect still fires after this component's own
  // commit, but React flushes any state update it triggers synchronously before
  // the browser paints or yields to the next event — so by the time rows are
  // visible on screen, a filtered-rows-dependent parent action is guaranteed to
  // observe the up-to-date set instead of an empty/stale one. See
  // XrayReferrals.tsx's openBulkReassignModal for the concrete bug this closes.
  const lastEmittedRowsRef = useRef<TRow[] | null>(null);
  useLayoutEffect(() => {
    if (!onFilteredRowsChange) return;
    const prev = lastEmittedRowsRef.current;
    const unchanged =
      prev !== null &&
      prev.length === filteredRows.length &&
      prev.every((row, i) => row === filteredRows[i]);
    if (unchanged) return;
    lastEmittedRowsRef.current = filteredRows;
    onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Virtual window — only render rows within (+ overscan beyond) the scroll viewport.
  // Keep this aligned with DataTable.css padding; compact mode intentionally reduces row height.
  // TanStack Virtual (not a hand-rolled scrollTop/ResizeObserver calculation
  // -- rework W5.6): chosen specifically for RTL. react-window's RTL support
  // is documented-broken and its v2 drops RTL from `List` entirely; TanStack
  // Virtual's RTL gap is horizontal-only, which doesn't apply to vertical row
  // virtualization. Row height is fixed per density mode, so a plain
  // `estimateSize` (no per-row `measureElement` dynamic sizing) is exact, not
  // an estimate in practice.
  const VROW_H  = density === "compact" ? 34 : 40;
  const OVERSCAN = 8;

  // `useVirtualizer` intentionally returns non-memoizable functions
  // (`scrollToOffset`, etc.); this component reads them straight from the
  // hook's return value on every render rather than caching them, so the
  // Compiler skipping memoization for this scope is exactly the correct,
  // safe behavior here -- not a bug to fix.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => tableWrapRef.current,
    estimateSize: () => VROW_H,
    overscan: OVERSCAN,
    // Matches the previous hand-rolled implementation's own `useState(600)`
    // fallback: before the virtualizer's internal ResizeObserver has fired
    // its first real measurement (mount, or any environment where
    // ResizeObserver never fires -- notably jsdom in this component's tests,
    // which stub it as a no-op), a 0-height scroll container would otherwise
    // compute an empty visible range and render nothing.
    initialRect: { width: 0, height: 600 },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const vRawStart = virtualItems.length ? virtualItems[0]!.index : 0;
  const vRawEnd   = virtualItems.length ? virtualItems[virtualItems.length - 1]!.index + 1 : 0;

  // Always include the expanded row in the slice so it is never unmounted while open.
  const expandedIdx = expandedKey != null
    ? pageRows.findIndex((r) => getRowKey(r) === expandedKey)
    : -1;
  const visStart    = expandedIdx >= 0 ? Math.min(vRawStart, expandedIdx) : vRawStart;
  const visEnd      = expandedIdx >= 0 ? Math.max(vRawEnd,   expandedIdx + 1) : vRawEnd;

  const virtualRows = pageRows.slice(visStart, visEnd);
  const topPad      = visStart * VROW_H;
  const bottomPad   = Math.max(0, (pageRows.length - visEnd) * VROW_H);

  // Unique values for the currently-open multiselect dropdown.
  // Computed from the rows currently visible after search and active filters.
  const openColOptions = useMemo<string[]>(() => {
    if (!openFilterCol) return [];
    const col = visibleCols.find((c) => c.id === openFilterCol);
    if (!col) return [];
    return Array.from(
      new Set(filteredRows.map((row) => (col.accessor as (r: unknown) => string | null)(row) ?? "").filter(Boolean))
    ).sort(compareFilterOptions);
  }, [openFilterCol, visibleCols, filteredRows]);

  // Column drag-to-reorder
  function handleDragStart(id: string): void { dragColRef.current = id; }
  function handleDrop(targetId: string): void {
    const srcId = dragColRef.current;
    if (!srcId || srcId === targetId) return;
    // Operate on the normalized order so columns missing from the persisted order
    // (added in a newer version) can be reordered instead of corrupting the array.
    const order = [...normalizedOrder];
    const sp = order.indexOf(srcId);
    const tp = order.indexOf(targetId);
    if (sp < 0 || tp < 0) return;
    order.splice(sp, 1);
    order.splice(tp, 0, srcId);
    setColCfg({ ...colCfg, order });
    dragColRef.current = null;
  }

  // Filter state helpers
  const activeFilterCount = Object.values(filters).filter((f) => !isFilterEmpty(f)).length;
  function setFilter(colId: string, f: AnyFilter): void {
    setFilters((p) => ({ ...p, [colId]: f }));
    setPageState({ rowsKey: rowsPageKey, page: 1 });
  }
  function clearFilter(colId: string): void {
    setFilters((p) => { const n = { ...p }; delete n[colId]; return n; });
    setPageState({ rowsKey: rowsPageKey, page: 1 });
  }
  function clearAllFilters(): void {
    setFilters({});
    setPageState({ rowsKey: rowsPageKey, page: 1 });
  }

  // XLSX export — visible columns, filtered rows, accessor values.
  // Row-array construction is chunked with a main-thread yield between chunks
  // (same idiom as populationProcessor.ts / riskDataWorkbook.ts) so large
  // filtered sets don't block the UI thread for the whole build; the final
  // XLSX.utils/writeFile call is an unavoidable synchronous tail, covered by
  // the isExporting state below.
  const EXPORT_CHUNK_SIZE = 1000;

  async function handleExport(): Promise<void> {
    if (!exportFileName || isExporting) return;
    setIsExporting(true);
    try {
      const header = visibleCols.map((c) => c.label);
      const body: string[][] = [];
      for (let i = 0; i < filteredRows.length; i += EXPORT_CHUNK_SIZE) {
        const chunk = filteredRows.slice(i, i + EXPORT_CHUNK_SIZE);
        for (const row of chunk) {
          body.push(visibleCols.map((col) => col.accessor(row) ?? ""));
        }
        if (filteredRows.length > EXPORT_CHUNK_SIZE) {
          await yieldToMain();
        }
      }
      const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "البيانات");
      XLSX.writeFile(wb, exportFileName);
    } finally {
      setIsExporting(false);
    }
  }

  // Column percentage widths for table-layout: fixed
  // Prefer per-column saved width, fall back to column definition widthFr
  const getColFr = (c: DataTableCol<TRow>) => (colCfg.widths ?? {})[c.id] ?? c.widthFr ?? 1;
  const totalFr  = visibleCols.reduce((s, c) => s + getColFr(c), 0);
  const colWidthPct = (c: DataTableCol<TRow>) =>
    `${((getColFr(c) / totalFr) * 100).toFixed(2)}%`;
  const stickyIdSet = useMemo(() => new Set(stickyColumnIds), [stickyColumnIds]);
  const stickyMeta = useMemo(() => {
    const meta = new Map<string, { rightPct: number; order: number }>();
    // Accumulate over EVERY visible column (sticky or not) so a sticky column's
    // offset reflects its true position from the RTL start edge. Skipping
    // non-sticky columns here would understate the offset for any sticky
    // column that isn't adjacent to the previous one, tearing it out of its
    // table cell and leaving a gap in its place (LOG-04-style visual bug).
    let cumulativePct = 0;
    let order = 0;
    for (const col of visibleCols) {
      const colPct = (((colCfg.widths ?? {})[col.id] ?? col.widthFr ?? 1) / totalFr) * 100;
      if (stickyIdSet.has(col.id)) {
        meta.set(col.id, { rightPct: cumulativePct, order });
        order += 1;
      }
      cumulativePct += colPct;
    }
    return meta;
  }, [visibleCols, stickyIdSet, totalFr, colCfg.widths]);

  function getStickyStyle(col: DataTableCol<TRow>, header: boolean): CSSProperties | undefined {
    const meta = stickyMeta.get(col.id);
    if (!meta) return undefined;
    return {
      right: `${meta.rightPct.toFixed(2)}%`,
      zIndex: header ? 8 + meta.order : 3 + meta.order,
    };
  }

  // B5: sensible per-column default min-width, floored off header label
  // length, so a narrow % share (widthFr) never squeezes an Arabic header
  // below the point where it clips mid-word (VIS-06, e.g. "تاريخ" -> "تار").
  // Below this floor the header wraps onto a second line instead (see the
  // .dt-th-label white-space rule in DataTable.css) rather than clipping.
  function headerMinWidth(col: DataTableCol<TRow>): number {
    return Math.min(180, Math.max(88, col.label.length * 9 + 28));
  }

  function estimateColumnFr(col: DataTableCol<TRow>): number {
    const sample = filteredRows.slice(0, 300);
    const maxChars = Math.max(
      col.label.length,
      ...sample.map((row) => String(col.accessor(row) ?? "").length)
    );
    const tableW = tableRef.current?.getBoundingClientRect().width ?? 800;
    const total = visibleCols.reduce((s, c) => s + getColFr(c), 0);
    const px = Math.min(Math.max(70, maxChars * 8 + 42), 420);
    return (px / tableW) * total;
  }

  function handleAutoFitColumn(colIdx: number): void {
    const col = visibleCols[colIdx];
    if (!col) return;
    const nextCfg = {
      ...colCfg,
      widths: {
        ...(colCfg.widths ?? {}),
        [col.id]: estimateColumnFr(col),
      },
    };
    setColCfg(nextCfg);
  }

  function handleAutoFitVisibleColumns(): void {
    const widths: Record<string, number> = { ...(colCfg.widths ?? {}) };
    for (const col of visibleCols) {
      widths[col.id] = estimateColumnFr(col);
    }
    setColCfg({ ...colCfg, widths });
  }

  // Column resize via drag
  function handleResizeMouseDown(colIdx: number, e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    e.stopPropagation();
    const tableW = tableRef.current?.getBoundingClientRect().width ?? 800;
    const tFr    = visibleCols.reduce((s, c) => s + getColFr(c), 0);
    resizeRef.current = {
      colIdx,
      startX:  e.clientX,
      startWs: visibleCols.map((c) => getColFr(c)),
      totalFr: tFr,
      tableW,
    };
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent): void {
      const r = resizeRef.current;
      if (!r) return;
      const deltaX  = ev.clientX - r.startX;
      // RTL: left-edge handle — dragging left (deltaX<0) widens the column
      const deltaFr = (-deltaX / r.tableW) * r.totalFr;
      const minFr   = (50 / r.tableW) * r.totalFr;

      const origW  = r.startWs[r.colIdx]!;
      const newW   = Math.max(minFr, origW + deltaFr);
      const actual = newW - origW;

      const ws: Record<string, number> = {};
      visibleCols.forEach((c, i) => { ws[c.id] = r.startWs[i]!; });
      ws[visibleCols[r.colIdx]!.id] = newW;
      const nextCol = visibleCols[r.colIdx + 1];
      if (nextCol) ws[nextCol.id] = Math.max(minFr, r.startWs[r.colIdx + 1]! - actual);

      setColCfgState((prev) => ({ ...prev, widths: ws }));
    }

    function onUp(): void {
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      // Persist on release
      setColCfgState((prev) => {
        onColConfigChange?.(prev);
        return prev;
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  return (
    <>
      {/* Toolbar */}
      <div className="dt-toolbar">
        {toolbarStart ? <div className="dt-toolbar-start">{toolbarStart}</div> : null}
        <div className="dt-toolbar-end">
          <input
            type="text"
            className="dt-search"
            aria-label={L.dt_search_placeholder}
            placeholder={L.dt_search_placeholder}
            value={globalSearch}
            onChange={(e) => {
              const v = e.target.value;
              setGlobalSearch(v);
              setPageState({ rowsKey: rowsPageKey, page: 1 });
              if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
              searchDebounceRef.current = setTimeout(
                () => setDebouncedSearch(v.trim().toLowerCase()),
                200
              );
            }}
          />
          {(activeFilterCount > 0 || globalSearch) && (
            <button
              type="button"
              className="dt-clear-filters-btn"
              onClick={() => { clearAllFilters(); setGlobalSearch(""); setDebouncedSearch(""); setPageState({ rowsKey: rowsPageKey, page: 1 }); }}
            >
              {L.dt_clear_filters} {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
            </button>
          )}
          {toolbarEndExtra}
          <button
            type="button"
            className="dt-autofit-btn"
            onClick={handleAutoFitVisibleColumns}
            title="ملاءمة عرض الأعمدة المرئية حسب المحتوى"
          >
            <Maximize2 size={14} />
            ملاءمة الأعمدة
          </button>
          {exportFileName && (
            <button
              type="button"
              className="dt-export-btn"
              onClick={handleExport}
              disabled={isExporting}
              aria-busy={isExporting}
            >
              {isExporting ? L.dt_exporting : L.dt_export_xlsx}
            </button>
          )}
          {canConfigureColumns && (
            <div>
              <button
                type="button"
                className="dt-col-picker-btn"
                onClick={(event) => {
                  setColPickerAnchorRect(event.currentTarget.getBoundingClientRect());
                  setColPickerOpen((open) => !open);
                  setOpenFilterCol(null);
                }}
              >
                {L.dt_columns_button} ({visibleCols.length})
              </button>
            </div>
          )}
        </div>
      </div>
      {colPickerOpen && colPickerAnchorRect && (
        <ColPickerPanel
          columns={columns as DataTableCol<unknown>[]}
          cfg={colCfg}
          isAdmin={isAdmin}
          detectedDates={detectedDates}
          defaultVisible={defaultVisible}
          anchorRect={colPickerAnchorRect}
          onChange={setColCfg}
          onClose={() => setColPickerOpen(false)}
        />
      )}

      {/* Row count */}
      <p className="dt-row-count">
        {filteredRows.length.toLocaleString("ar-SA-u-nu-latn")}
        {(filteredRows.length !== rows.length || globalSearch) && ` / ${rows.length.toLocaleString("ar-SA-u-nu-latn")}`}
        {` ${L.dt_row_suffix}`}
      </p>

      {/* Table */}
      <div className={`dt-table-wrap dt-density-${density}`} ref={tableWrapRef}>
        <table className="dt-table" ref={tableRef}>
          <colgroup>
            {visibleCols.map((col) => (
              <col key={col.id} style={{ width: colWidthPct(col), minWidth: headerMinWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleCols.map((col, colIdx) => {
                const isDate    = col.isDate || detectedDates.has(col.id);
                const isNumeric = col.isNumeric || detectedNumeric.has(col.id);
                const hasFilter = !!filters[col.id] && !isFilterEmpty(filters[col.id]!);
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={`dt-th${stickyMeta.has(col.id) ? " dt-sticky-col dt-sticky-head" : ""}${isNumeric ? " dt-th--numeric" : ""}`}
                    style={{ minWidth: headerMinWidth(col), ...getStickyStyle(col, true) }}
                    draggable
                    onDragStart={() => handleDragStart(col.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(col.id)}
                  >
                    {/* Resize handle on physical-left border (RTL separator) */}
                    <div
                      className="dt-resize-handle"
                      onMouseDown={(e) => handleResizeMouseDown(colIdx, e)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAutoFitColumn(colIdx);
                      }}
                      title="اسحب لتغيير العرض، أو انقر مرتين للملاءمة التلقائية"
                    />
                    <div className="dt-th-inner">
                      <span className="dt-th-grip" aria-hidden="true">⋮⋮</span>
                      <span className="dt-th-label">{col.label}</span>
                      <button
                        type="button"
                        className={`dt-filter-btn${hasFilter ? " active" : ""}`}
                        title={`تصفية: ${col.label}`}
                        aria-label={`تصفية: ${col.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setFilterAnchorRect(rect);
                          setOpenFilterCol((c) => (c === col.id ? null : col.id));
                          setColPickerOpen(false);
                        }}
                      >▾</button>
                    </div>
                    {openFilterCol === col.id && filterAnchorRect && (
                      <ColFilterMenu
                        col={col as DataTableCol<unknown>}
                        filter={filters[col.id]}
                        isDateCol={isDate}
                        anchorRect={filterAnchorRect}
                        options={openColOptions}
                        onSet={(f) => {
                          setFilter(col.id, f);
                          // Keep multiselect menu open so user can check multiple values
                          if (f.kind !== "multiselect") setOpenFilterCol(null);
                        }}
                        onClear={() => { clearFilter(col.id); setOpenFilterCol(null); }}
                        onClose={() => setOpenFilterCol(null)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {topPad > 0 && (
              <tr aria-hidden="true" style={{ height: topPad }}>
                <td colSpan={visibleCols.length} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
            {/* B11: search/filters can legitimately hide every row — without this,
                the tbody just goes blank beneath the header with no indication of
                why. Only shown when there IS data (rows.length > 0); a table with
                zero rows to begin with is unaffected. */}
            {filteredRows.length === 0 && rows.length > 0 && (
              <tr className="dt-empty-row">
                <td
                  colSpan={Math.max(1, visibleCols.length)}
                  className="dt-empty-td"
                  style={{ textAlign: "center", padding: "28px 12px", color: "var(--c-ink-4)", fontSize: 13 }}
                >
                  لا توجد نتائج مطابقة
                </td>
              </tr>
            )}
            {virtualRows.map((row) => {
              const key        = getRowKey(row);
              const isExpanded = expandedKey === key;
              const rowClassName = getRowClassName?.(row);
              return (
                <Fragment key={key}>
                  <tr
                    className={`dt-tr${isExpanded ? " selected" : ""}${rowClassName ? ` ${rowClassName}` : ""}`}
                    onClick={() => onRowClick?.(row)}
                    {...(onRowClick
                      ? {
                          tabIndex: 0,
                          "aria-selected": isExpanded,
                          onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                            // Ignore keydowns bubbling up from interactive children (e.g. the
                            // row-select checkbox) — Space there toggles the checkbox, not the row.
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          },
                        }
                      : {})}
                  >
                    {visibleCols.map((col) => {
                      const isDate    = col.isDate || detectedDates.has(col.id);
                      const isNumeric = col.isNumeric || detectedNumeric.has(col.id);
                      return (
                        <td
                          key={col.id}
                          className={`dt-td${stickyMeta.has(col.id) ? " dt-sticky-col" : ""}${isNumeric ? " dt-td--numeric" : ""}`}
                          style={getStickyStyle(col, false)}
                          title={String(col.accessor(row) ?? "")}
                        >
                          {renderCell(col, row, {
                            isDate,
                            dateFmt: colCfg.dateFmt[col.id] as DateFormatMode ?? "date",
                            isNumeric,
                          })}
                        </td>
                      );
                    })}
                  </tr>
                  {isExpanded && renderExpanded && (
                    <tr>
                      <td colSpan={visibleCols.length} className="dt-expand-td">
                        {renderExpanded(row, visibleCols.length)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {bottomPad > 0 && (
              <tr aria-hidden="true" style={{ height: bottomPad }}>
                <td colSpan={visibleCols.length} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalItems={filteredRows.length}
        onPageChange={changePage}
      />
    </>
  );
}

// ── ColPickerPanel ────────────────────────────────────────────────────────────

type ColPickerPanelProps = {
  columns: DataTableCol<unknown>[];
  cfg: ColConfig;
  isAdmin: boolean;
  detectedDates: Set<string>;
  defaultVisible?: string[];
  anchorRect: DOMRect;
  onChange: (c: ColConfig) => void;
  onClose: () => void;
};

function ColPickerPanel({
  columns, cfg, isAdmin, detectedDates, defaultVisible, anchorRect, onChange, onClose,
}: ColPickerPanelProps) {
  const L = useLabels();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const cols = columns.filter((c) => !c.adminOnly || isAdmin);
  // B11: how many of the picker's own candidate columns are currently shown.
  // Hiding the last one would leave the grid fully blank with no visible way
  // back in short of the "إعادة الافتراضي" reset button — refuse the toggle
  // instead (mirrors the alwaysVisible guard right below).
  const visibleCount = cols.filter((c) => !cfg.hidden.includes(c.id)).length;
  const pickerWidth = 300;
  const style: CSSProperties = {
    position: "fixed",
    top: anchorRect.bottom + 6,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - pickerWidth - 8)),
    zIndex: 9999,
  };

  function toggle(id: string): void {
    if (columns.find((c) => c.id === id)?.alwaysVisible) return;
    const isHidden = cfg.hidden.includes(id);
    if (!isHidden && visibleCount <= 1) return; // refuse to hide the last visible column
    const hidden = isHidden
      ? cfg.hidden.filter((h) => h !== id)
      : [...cfg.hidden, id];
    onChange({ ...cfg, hidden });
  }

  function setFmt(id: string, fmt: DateFormatMode): void {
    onChange({ ...cfg, dateFmt: { ...cfg.dateFmt, [id]: fmt } });
  }

  function resetToDefault(): void {
    const visSet = defaultVisible ? new Set(defaultVisible) : null;
    onChange({
      order: columns.map((c) => c.id),
      hidden: columns.filter((c) => visSet ? !visSet.has(c.id) : false).map((c) => c.id),
      dateFmt: {},
      widths: {},
    });
  }

  return (
    <div ref={ref} className="dt-col-picker" style={style}>
      <div className="dt-col-picker-header">
        <strong>{L.dt_columns_title}</strong>
        <span className="dt-col-picker-count">
          {cols.filter((c) => !cfg.hidden.includes(c.id)).length} / {cols.length}
        </span>
      </div>
      <p className="dt-col-picker-hint">{L.dt_columns_hint}</p>
      <div className="dt-col-list">
        {cols.map((col) => {
          const hidden       = cfg.hidden.includes(col.id);
          const isDateCol    = col.isDate || detectedDates.has(col.id);
          const isLastVisible = !hidden && visibleCount <= 1;
          return (
            <div
              key={col.id}
              className={`dt-col-item${hidden ? " dt-col-hidden" : ""}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("colId", col.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const srcId = e.dataTransfer.getData("colId");
                if (!srcId || srcId === col.id) return;
                // Normalize against the current columns so a column missing from the
                // persisted order (added later) can be reordered safely.
                const known = new Set(columns.map((c) => c.id));
                const kept = cfg.order.filter((id) => known.has(id));
                const keptSet = new Set(kept);
                const order = [...kept, ...columns.filter((c) => !keptSet.has(c.id)).map((c) => c.id)];
                const sp = order.indexOf(srcId);
                const tp = order.indexOf(col.id);
                if (sp < 0 || tp < 0) return;
                order.splice(sp, 1);
                order.splice(tp, 0, srcId);
                onChange({ ...cfg, order });
              }}
            >
              <span className="dt-col-drag">⋮⋮</span>
              <div className="dt-col-label-group">
                <span className="dt-col-label">{col.label}</span>
                {isDateCol && !hidden && (
                  <select
                    className="dt-col-date-fmt-select"
                    value={cfg.dateFmt[col.id] ?? "date"}
                    onChange={(e) => setFmt(col.id, e.target.value as DateFormatMode)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(Object.keys(DATE_FORMAT_LABELS) as DateFormatMode[]).map((k) => (
                      <option key={k} value={k}>{DATE_FORMAT_LABELS[k]}</option>
                    ))}
                  </select>
                )}
              </div>
              {isDateCol && (
                <span className="dt-col-badge-date">{L.dt_date_badge}</span>
              )}
              <button
                type="button"
                className="dt-col-eye-btn"
                disabled={!!col.alwaysVisible || isLastVisible}
                title={
                  hidden
                    ? L.dt_show_column
                    : isLastVisible
                      ? "يجب أن يبقى عمود واحد ظاهرًا على الأقل"
                      : L.dt_hide_column
                }
                onClick={(e) => { e.stopPropagation(); toggle(col.id); }}
              >
                {hidden
                  ? <EyeOff size={14} className="dt-col-eye-off" />
                  : <Eye size={14} className="dt-col-eye-on" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="dt-col-picker-footer">
        <button
          type="button"
          className="dt-panel-btn dt-panel-btn-secondary"
          onClick={resetToDefault}
        >{L.dt_reset_default}</button>
        <button
          type="button"
          className="dt-panel-btn dt-panel-btn-primary"
          onClick={onClose}
        >{L.dt_done}</button>
      </div>
    </div>
  );
}

// ── ColFilterMenu ─────────────────────────────────────────────────────────────

type ColFilterMenuProps = {
  col: DataTableCol<unknown>;
  filter: AnyFilter | undefined;
  isDateCol: boolean;
  anchorRect: DOMRect;
  options: string[];
  onSet: (f: AnyFilter) => void;
  onClear: () => void;
  onClose: () => void;
};

function ColFilterMenu({ col, filter, isDateCol, anchorRect, options, onSet, onClear, onClose }: ColFilterMenuProps) {
  const L = useLabels();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  // Position fixed below the filter button, right-aligned to the button in RTL
  const style: CSSProperties = {
    position: "fixed",
    top: anchorRect.bottom + 4,
    right: window.innerWidth - anchorRect.right,
    zIndex: 9999,
  };

  const resolvedKind = col.filterKind ?? (isDateCol ? "date" : "multiselect");

  // Multiselect filter (default for most columns)
  if (resolvedKind === "multiselect") {
    const selected = new Set(filter?.kind === "multiselect" ? filter.values : []);
    function toggle(value: string): void {
      const next = new Set(selected);
      if (next.has(value)) next.delete(value); else next.add(value);
      onSet({ kind: "multiselect", values: Array.from(next) });
    }
    return (
      <div ref={ref} className="dt-filter-menu dt-filter-multiselect" style={style} dir="rtl">
        <div className="dt-filter-head">
          <strong>{col.label}</strong>
          <button type="button" onClick={onClear} disabled={selected.size === 0}>{L.dt_filter_clear}</button>
        </div>
        {options.length === 0 && (
          <p className="dt-filter-empty">{L.dt_filter_empty}</p>
        )}
        <div className="dt-filter-options">
          {options.map((value) => (
            <label key={value} className="dt-filter-option">
              <input
                type="checkbox"
                checked={selected.has(value)}
                onChange={() => toggle(value)}
              />
              <span title={value}>{value}</span>
            </label>
          ))}
        </div>
        <div className="dt-filter-footer">
          <button type="button" className="dt-filter-done-btn" onClick={onClose}>
            {L.dt_done} {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
    );
  }

  // Status filter
  if (resolvedKind === "status") {
    const opts = col.statusOptions ?? [{ value: "all", label: "الكل" }];
    const cur  = filter?.kind === "status" ? filter.value : "all";
    return (
      <div ref={ref} className="dt-filter-menu" style={style} dir="rtl">
        <div className="dt-filter-head">
          <strong>{col.label}</strong>
          <button type="button" onClick={onClear}>{L.dt_filter_clear}</button>
        </div>
        {opts.map(({ value, label }) => (
          <label key={value} className="dt-filter-radio">
            <input
              type="radio"
              name={`status-filter-${col.id}`}
              checked={cur === value}
              onChange={() => onSet({ kind: "status", value })}
            />
            {label}
          </label>
        ))}
      </div>
    );
  }

  // Date filter
  if (resolvedKind === "date") {
    const cur = filter?.kind === "date"
      ? filter
      : { kind: "date" as const, mode: "single" as const, single: "", from: "", to: "" };
    return (
      <DateFilterMenu
        ref={ref}
        label={col.label}
        filter={cur}
        style={style}
        onSet={onSet}
        onClear={onClear}
      />
    );
  }

  // Text filter
  const cur = filter?.kind === "text" ? filter.value : "";
  return (
    <div ref={ref} className="dt-filter-menu" style={style} dir="rtl">
      <div className="dt-filter-head">
        <strong>{col.label}</strong>
        <button type="button" onClick={onClear}>{L.dt_filter_clear}</button>
      </div>
      <TextFilterBody value={cur} onSubmit={(v) => onSet({ kind: "text", value: v })} />
    </div>
  );
}

// ── TextFilterBody ────────────────────────────────────────────────────────────

function TextFilterBody({ value, onSubmit }: { value: string; onSubmit: (v: string) => void }) {
  const L = useLabels();
  const [v, setV] = useState(value);
  return (
    <div style={{ paddingTop: 8 }}>
      <input
        type="text"
        placeholder={L.dt_filter_search}
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(v); }}
        className="dt-filter-input"
      />
      <button
        type="button"
        onClick={() => onSubmit(v)}
        className="dt-filter-apply-btn"
      >{L.dt_filter_apply}</button>
    </div>
  );
}

// ── DateFilterMenu ────────────────────────────────────────────────────────────

const DateFilterMenu = forwardRef(function DateFilterMenu(
  { label, filter, style, onSet, onClear }:
  { label: string; filter: DateFilter; style?: CSSProperties; onSet: (f: AnyFilter) => void; onClear: () => void },
  ref: ForwardedRef<HTMLDivElement>
) {
  const L = useLabels();
  const [mode,   setMode]   = useState<"single" | "range">(filter.mode);
  const [single, setSingle] = useState(filter.single);
  const [from,   setFrom]   = useState(filter.from);
  const [to,     setTo]     = useState(filter.to);

  return (
    <div ref={ref} className="dt-filter-menu dt-filter-date" style={style} dir="rtl">
      <div className="dt-filter-head">
        <strong>{label}</strong>
        <button type="button" onClick={onClear}>{L.dt_filter_clear}</button>
      </div>
      <div className="dt-date-mode-toggle">
        <button type="button" className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
          {L.dt_filter_specific_day}
        </button>
        <button type="button" className={mode === "range" ? "active" : ""} onClick={() => setMode("range")}>
          {L.dt_filter_range}
        </button>
      </div>
      {mode === "single" ? (
        <div className="dt-date-inputs">
          <input
            type="date"
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            className="dt-filter-input"
          />
        </div>
      ) : (
        <div className="dt-date-inputs">
          <label className="dt-date-label">
            {L.dt_filter_from}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="dt-filter-input" />
          </label>
          <label className="dt-date-label">
            {L.dt_filter_to}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="dt-filter-input" />
          </label>
        </div>
      )}
      <button
        type="button"
        onClick={() => onSet({ kind: "date", mode, single, from, to })}
        className="dt-filter-apply-btn"
      >{L.dt_filter_apply}</button>
    </div>
  );
});
