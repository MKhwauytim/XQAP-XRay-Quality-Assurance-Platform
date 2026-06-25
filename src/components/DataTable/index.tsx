import { Eye, EyeOff, Maximize2 } from "lucide-react";
import {
  Fragment,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
} from "react";
import * as XLSX from "xlsx";
import { useLabels } from "../../data/labels/useLabels";
import "./DataTable.css";
import {
  type DateFormatMode,
  DATE_FORMAT_LABELS,
  looksLikeDate,
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
};

export type DataTableProps<TRow = unknown> = {
  columns: DataTableCol<TRow>[];
  rows: TRow[];
  getRowKey: (row: TRow) => string;
  renderCell: (col: DataTableCol<TRow>, row: TRow, meta: CellMeta) => ReactNode;
  storageKey: string;
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
  return {
    order: columns.map((c) => c.id),
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

function saveColConfig(): void {
  // Durable table preferences should be saved through onColConfigChange.
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

// ── Main component ────────────────────────────────────────────────────────────

export default function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  renderCell,
  storageKey,
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
  const [colPickerOpen, setColPickerOpen]       = useState(false);
  const [openFilterCol, setOpenFilterCol]       = useState<string | null>(null);
  const [filterAnchorRect, setFilterAnchorRect] = useState<DOMRect | null>(null);
  const [filters, setFilters]                   = useState<FiltersMap>({});
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
  const [scrollTop, setScrollTop]             = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  function setColCfg(c: ColConfig): void {
    setColCfgState(c);
    saveColConfig();
    if (onColConfigChange) {
      if (colChangeDebouncerRef.current) clearTimeout(colChangeDebouncerRef.current);
      colChangeDebouncerRef.current = setTimeout(() => { onColConfigChange(c); }, 800);
    }
  }

  // When an external initialColConfig arrives (async file load), seed state once.
  const initialSyncedRef = useRef(false);
  useEffect(() => {
    if (initialColConfig && !initialSyncedRef.current) {
      initialSyncedRef.current = true;
      setColCfgState(initialColConfig);
      saveColConfig();
    }
  }, [initialColConfig, storageKey]);

  // Close filter menu when table scrolls (button has moved, position would be stale).
  // Also track scrollTop + container height for row virtualisation.
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    let raf: number | null = null;
    const handleScroll = () => {
      setOpenFilterCol(null);
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        setScrollTop(el.scrollTop);
      });
    };
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    el.addEventListener("scroll", handleScroll, { passive: true });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
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
    () => searchFilteredRows.filter((row) =>
      visibleCols.every((col) => {
        const f = filters[col.id];
        if (!f || isFilterEmpty(f)) return true;
        const custom = rowMatchesFilter?.(row, col.id, f);
        if (custom !== null && custom !== undefined) return custom;
        return defaultRowMatchesFilter(row, col, f, detectedDates);
      })
    ),
    [searchFilteredRows, visibleCols, filters, rowMatchesFilter, detectedDates]
  );

  useEffect(() => {
    onFilteredRowsChange?.(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Virtual window — only render rows within (+ overscan beyond) the scroll viewport.
  // Keep this aligned with DataTable.css padding; compact mode intentionally reduces row height.
  const VROW_H  = density === "compact" ? 34 : 40;
  const OVERSCAN = 8;

  const vRawStart = Math.max(0, Math.floor(scrollTop / VROW_H) - OVERSCAN);
  const vRawEnd   = Math.min(filteredRows.length, Math.ceil((scrollTop + containerHeight) / VROW_H) + OVERSCAN);

  // Always include the expanded row in the slice so it is never unmounted while open.
  const expandedIdx = expandedKey != null
    ? filteredRows.findIndex((r) => getRowKey(r) === expandedKey)
    : -1;
  const visStart    = expandedIdx >= 0 ? Math.min(vRawStart, expandedIdx) : vRawStart;
  const visEnd      = expandedIdx >= 0 ? Math.max(vRawEnd,   expandedIdx + 1) : vRawEnd;

  const virtualRows = filteredRows.slice(visStart, visEnd);
  const topPad      = visStart * VROW_H;
  const bottomPad   = Math.max(0, (filteredRows.length - visEnd) * VROW_H);

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
  function setFilter(colId: string, f: AnyFilter): void { setFilters((p) => ({ ...p, [colId]: f })); }
  function clearFilter(colId: string): void { setFilters((p) => { const n = { ...p }; delete n[colId]; return n; }); }
  function clearAllFilters(): void { setFilters({}); }

  // XLSX export — visible columns, filtered rows, accessor values
  function handleExport(): void {
    if (!exportFileName) return;
    const header = visibleCols.map((c) => c.label);
    const body = filteredRows.map((row) =>
      visibleCols.map((col) => col.accessor(row) ?? "")
    );
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "البيانات");
    XLSX.writeFile(wb, exportFileName);
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
    let rightPct = 0;
    let order = 0;
    for (const col of visibleCols) {
      if (!stickyIdSet.has(col.id)) continue;
      meta.set(col.id, { rightPct, order });
      rightPct += (((colCfg.widths ?? {})[col.id] ?? col.widthFr ?? 1) / totalFr) * 100;
      order += 1;
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
    // eslint-disable-next-line react-hooks/immutability -- cursor change is a valid DOM side-effect in a mouse-event handler, not during render
    document.body.style.cursor     = "col-resize";
    // eslint-disable-next-line react-hooks/immutability -- same as above
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
        saveColConfig();
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
            placeholder={L.dt_search_placeholder}
            value={globalSearch}
            onChange={(e) => {
              const v = e.target.value;
              setGlobalSearch(v);
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
              onClick={() => { clearAllFilters(); setGlobalSearch(""); setDebouncedSearch(""); }}
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
            <button type="button" className="dt-export-btn" onClick={handleExport}>
              {L.dt_export_xlsx}
            </button>
          )}
          {canConfigureColumns && (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="dt-col-picker-btn"
                onClick={() => { setColPickerOpen((o) => !o); setOpenFilterCol(null); }}
              >
                {L.dt_columns_button} ({visibleCols.length})
              </button>
              {colPickerOpen && (
                <ColPickerPanel
                  columns={columns as DataTableCol<unknown>[]}
                  cfg={colCfg}
                  isAdmin={isAdmin}
                  detectedDates={detectedDates}
                  defaultVisible={defaultVisible}
                  onChange={setColCfg}
                  onClose={() => setColPickerOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>

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
              <col key={col.id} style={{ width: colWidthPct(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleCols.map((col, colIdx) => {
                const isDate    = col.isDate || detectedDates.has(col.id);
                const hasFilter = !!filters[col.id] && !isFilterEmpty(filters[col.id]!);
                return (
                  <th
                    key={col.id}
                    className={`dt-th${stickyMeta.has(col.id) ? " dt-sticky-col dt-sticky-head" : ""}`}
                    style={getStickyStyle(col, true)}
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
            {virtualRows.map((row) => {
              const key        = getRowKey(row);
              const isExpanded = expandedKey === key;
              const rowClassName = getRowClassName?.(row);
              return (
                <Fragment key={key}>
                  <tr
                    className={`dt-tr${isExpanded ? " selected" : ""}${rowClassName ? ` ${rowClassName}` : ""}`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {visibleCols.map((col) => {
                      const isDate = col.isDate || detectedDates.has(col.id);
                      return (
                        <td
                          key={col.id}
                          className={`dt-td${stickyMeta.has(col.id) ? " dt-sticky-col" : ""}`}
                          style={getStickyStyle(col, false)}
                          title={String(col.accessor(row) ?? "")}
                        >
                          {renderCell(col, row, {
                            isDate,
                            dateFmt: colCfg.dateFmt[col.id] as DateFormatMode ?? "date",
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
  onChange: (c: ColConfig) => void;
  onClose: () => void;
};

function ColPickerPanel({
  columns, cfg, isAdmin, detectedDates, defaultVisible, onChange, onClose,
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

  function toggle(id: string): void {
    if (columns.find((c) => c.id === id)?.alwaysVisible) return;
    const hidden = cfg.hidden.includes(id)
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
    <div ref={ref} className="dt-col-picker">
      <div className="dt-col-picker-header">
        <strong>{L.dt_columns_title}</strong>
        <span className="dt-col-picker-count">
          {cols.filter((c) => !cfg.hidden.includes(c.id)).length} / {cols.length}
        </span>
      </div>
      <p className="dt-col-picker-hint">{L.dt_columns_hint}</p>
      <div className="dt-col-list">
        {cols.map((col) => {
          const hidden    = cfg.hidden.includes(col.id);
          const isDateCol = col.isDate || detectedDates.has(col.id);
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
                disabled={!!col.alwaysVisible}
                title={hidden ? L.dt_show_column : L.dt_hide_column}
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
