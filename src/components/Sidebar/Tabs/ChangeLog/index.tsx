/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { History, Search } from "lucide-react";

import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { formatNumber } from "../../../../utils/formatting";
import type { SidebarTabModule } from "../tabTypes";
// Aggregated from the repo's date-organized edit logs. Newest-first.
import editLogRaw from "virtual:edit-log";
import "./ChangeLog.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "change-log",
  label: "سجل الإصدارات",
  order: 96,
  allowedRoles: tabAllowedRoles("change-log"),
  icon: <History size={20} strokeWidth={1.8} aria-hidden />,
};

// ── Parsing ─────────────────────────────────────────────────────────────────
// Each version is a level-2 heading: "## v34.4 — 2026-07-01 — Category: Title"
// (per CLAUDE.md's edit-log convention; see CATEGORY_RE below). The body is
// everything up to the next such heading (separator rules trimmed).

type ChangeEntry = {
  version: string;
  date: string;
  title: string;
  tag: string | null;
  body: string;
};

const HEADING_RE = /^##\s+(v[\d.]+)\s+—\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s*$/;
// Matches the CLAUDE.md edit-log title convention: "{Category}: ..." or
// "{Category} (scope): ..." (Category is one of the mandated prefixes —
// Fix/Add/Change/Remove/Refactor/Security/Docs/Chore). Only used to derive
// the small colored badge below; the title text itself is left untouched.
const CATEGORY_RE = /^(Fix|Add|Change|Remove|Refactor|Security|Docs|Chore)\b/;

/** "v34.5" → [34, 5]; "v7.12.1" → [7, 12, 1] for numeric (not string) ordering. */
function versionKey(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
}

/** Newest (highest) version first, segment by segment. */
function compareVersionsDesc(a: ChangeEntry, b: ChangeEntry): number {
  const av = versionKey(a.version);
  const bv = versionKey(b.version);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (bv[i] ?? 0) - (av[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseChangeLog(raw: string): ChangeEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: ChangeEntry[] = [];
  let current: ChangeEntry | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (!current) return;
    let body = bodyLines.join("\n").trim();
    // Drop a trailing horizontal rule that belongs to the section separator.
    body = body.replace(/\n?-{3,}\s*$/g, "").trim();
    current.body = body;
    entries.push(current);
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      const rawTitle = match[3]!;
      const categoryMatch = CATEGORY_RE.exec(rawTitle);
      current = {
        version: match[1]!,
        date: match[2]!,
        title: rawTitle,
        tag: categoryMatch ? categoryMatch[1]! : null,
        body: "",
      };
      bodyLines = [];
    } else if (current) {
      if (/^-{3,}\s*$/.test(line)) continue; // skip separators inside/around a block
      bodyLines.push(line);
    }
  }
  flush();
  return entries;
}

// Repurposed for the real (CLAUDE.md) category taxonomy — the old FEATURE/BUG/
// DESIGN tags above never matched a real heading (edit-log titles carry the
// category as a leading "Category:" prefix, not a trailing "(TAG)" suffix).
// Reuses the four existing badge colors already defined in ChangeLog.css
// (cl-tag--feature/fix/design/chore) rather than adding new ones there.
const TAG_LABELS_AR: Record<string, string> = {
  Fix:      "إصلاح",
  Add:      "إضافة",
  Change:   "تعديل",
  Remove:   "إزالة",
  Refactor: "إعادة هيكلة",
  Security: "أمان",
  Docs:     "توثيق",
  Chore:    "صيانة",
};

function tagClass(tag: string | null): string {
  switch (tag) {
    case "Fix":
    case "Security":
      return "cl-tag--fix";
    case "Add":
    case "Change":
      return "cl-tag--feature";
    case "Refactor":
      return "cl-tag--design";
    default:
      return "cl-tag--chore";
  }
}

// ── Lightweight markdown rendering (no library; safe React nodes only) ────────

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(<code key={`${keyBase}-${i}`} className="cl-inline-code">{part.slice(1, -1)}</code>);
    } else {
      nodes.push(part);
    }
  });
  return nodes;
}

// Minimal heading (#/##/###) support — real edit-log bodies quote headings
// from other docs (e.g. "### Follow-up: review-finding fixes...") that would
// otherwise leak their literal "#" characters into a plain paragraph. Mapped
// to h4-h6 (not h1-h3) so a quoted heading never outranks the page's own h1.
const HEADING_LINE_RE = /^\s{0,3}(#{1,3})\s+(.+?)\s*$/;
const HEADING_TAG: Record<number, "h4" | "h5" | "h6"> = { 1: "h4", 2: "h5", 3: "h6" };
const HEADING_STYLE: Record<number, CSSProperties> = {
  1: { margin: "14px 0 4px", fontSize: "15.5px", fontWeight: 800, color: "var(--c-navy)" },
  2: { margin: "12px 0 4px", fontSize: "14px",   fontWeight: 700, color: "var(--c-navy)" },
  3: { margin: "10px 0 4px", fontSize: "13px",   fontWeight: 700, color: "var(--c-ink-2)" },
};

// Minimal GFM pipe-table support. Handles both a real header ("| a | b |"
// followed by a "| --- | --- |" separator row) and the header-less runs of
// "| a | b |" rows real entries sometimes paste (a slice of a bigger table
// copied without repeating its header). ChangeLog.css ships no .cl-table
// rules, so this block styles itself inline rather than adding classes to a
// file outside this bucket.
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEPARATOR_CELL_RE = /^:?-{2,}:?$/;

function splitTableCells(line: string): string[] {
  const m = TABLE_ROW_RE.exec(line);
  return (m ? m[1]! : line).split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => TABLE_SEPARATOR_CELL_RE.test(c));
}

const TABLE_WRAP_STYLE: CSSProperties = { overflowX: "auto", margin: "10px 0" };
const TABLE_STYLE: CSSProperties = { borderCollapse: "collapse", width: "100%", fontSize: "12.5px" };
const TABLE_CELL_STYLE: CSSProperties = {
  border: "1px solid var(--c-border)",
  padding: "5px 9px",
  textAlign: "start",
  verticalAlign: "top",
};
const TABLE_HEAD_CELL_STYLE: CSSProperties = {
  ...TABLE_CELL_STYLE,
  background: "var(--c-surface-2)",
  fontWeight: 700,
};

function renderTableBlock(lines: string[], keyBase: string): ReactNode {
  const rows = lines.map(splitTableCells);
  const hasHeader = rows.length > 1 && isSeparatorRow(rows[1]!);
  const headerRow = hasHeader ? rows[0]! : null;
  const bodyRows = hasHeader ? rows.slice(2) : rows;
  return (
    <div key={keyBase} style={TABLE_WRAP_STYLE} dir="auto">
      <table style={TABLE_STYLE}>
        {headerRow && (
          <thead>
            <tr>
              {headerRow.map((cell, ci) => (
                <th key={ci} scope="col" style={TABLE_HEAD_CELL_STYLE}>
                  {renderInline(cell, `${keyBase}-th-${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((cells, ri) => (
            <tr key={ri}>
              {cells.map((cell, ci) => (
                <td key={ci} style={TABLE_CELL_STYLE}>
                  {renderInline(cell, `${keyBase}-td-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBody(body: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const fenceRe = /```(?:[\w-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  const flushParaLines = (lines: string[]) => {
    const text = lines.join("\n").trim();
    if (!text) return;
    // VIS-03: dir="auto" so English commit prose reads LTR inside the RTL page
    blocks.push(
      <p key={`p-${key++}`} className="cl-prose" dir="auto">
        {text.split("\n").map((ln, i) => (
          <span key={i} className="cl-prose-line" dir="auto">
            {renderInline(ln, `l-${key}-${i}`)}
          </span>
        ))}
      </p>
    );
  };

  const pushProse = (chunk: string) => {
    const lines = chunk.split("\n");
    let paraBuf: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;

      const heading = HEADING_LINE_RE.exec(line);
      if (heading) {
        flushParaLines(paraBuf);
        paraBuf = [];
        const level = heading[1]!.length;
        const Tag = HEADING_TAG[level] ?? "h6";
        blocks.push(
          <Tag key={`h-${key++}`} style={HEADING_STYLE[level]} dir="auto">
            {renderInline(heading[2]!, `h-${key}`)}
          </Tag>
        );
        i++;
        continue;
      }

      if (TABLE_ROW_RE.test(line)) {
        flushParaLines(paraBuf);
        paraBuf = [];
        const tableLines: string[] = [];
        while (i < lines.length && TABLE_ROW_RE.test(lines[i]!)) {
          tableLines.push(lines[i]!);
          i++;
        }
        blocks.push(renderTableBlock(tableLines, `tbl-${key++}`));
        continue;
      }

      if (line.trim() === "") {
        flushParaLines(paraBuf);
        paraBuf = [];
        i++;
        continue;
      }

      paraBuf.push(line);
      i++;
    }
    flushParaLines(paraBuf);
  };

  while ((match = fenceRe.exec(body)) !== null) {
    if (match.index > last) pushProse(body.slice(last, match.index));
    blocks.push(
      <pre key={`code-${key++}`} className="cl-code">
        <code>{match[1]!.replace(/\n$/, "")}</code>
      </pre>
    );
    last = match.index + match[0].length;
  }
  if (last < body.length) pushProse(body.slice(last));
  return blocks;
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChangeLogTab() {
  const entries = useMemo(
    () => parseChangeLog(editLogRaw).sort(compareVersionsDesc),
    []
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.version.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.date.includes(q) ||
        e.body.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const latest = entries[0];

  return (
    <div className="change-log-tab" dir="rtl">
      <PageHeader
        eyebrow="النظام"
        title="سجل الإصدارات"
        subtitle="سجل كامل لجميع الإصدارات والتعديلات على النظام — رقم الإصدار، التاريخ، ووصف كل تغيير."
      />

      <div className="cl-summary">
        <div className="cl-summary-stat">
          <span className="cl-summary-label">إجمالي الإصدارات</span>
          <span className="cl-summary-value">
            {formatNumber(
              typeof __EDIT_LOG_TOTAL_VERSIONS__ !== "undefined"
                ? __EDIT_LOG_TOTAL_VERSIONS__
                : entries.length
            )}
          </span>
        </div>
        {latest && (
          <div className="cl-summary-stat">
            <span className="cl-summary-label">أحدث إصدار</span>
            <span className="cl-summary-value">{latest.version}</span>
          </div>
        )}
        {latest && (
          <div className="cl-summary-stat">
            <span className="cl-summary-label">آخر تحديث</span>
            <span className="cl-summary-value cl-summary-value--date">{latest.date}</span>
          </div>
        )}
        <div className="cl-search">
          <Search size={15} className="cl-search-icon" aria-hidden />
          <input
            type="search"
            className="cl-search-input"
            placeholder="ابحث في الإصدارات…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="البحث في سجل الإصدارات"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="cl-empty">لا توجد إصدارات مطابقة لبحثك.</p>
      ) : (
        <ol className="cl-list">
          {filtered.map((entry, index) => (
            <li key={entry.version + entry.date + index} className="cl-item">
              <details open={query === "" && index === 0}>
                <summary className="cl-item-head">
                  <span className="cl-version">{entry.version}</span>
                  <span className="cl-item-title" dir="auto">{entry.title}</span>
                  {entry.tag && (
                    <span className={`cl-tag ${tagClass(entry.tag)}`}>
                      {TAG_LABELS_AR[entry.tag] ?? entry.tag}
                    </span>
                  )}
                  <span className="cl-date">{entry.date}</span>
                </summary>
                <div className="cl-body">
                  {entry.body ? renderBody(entry.body) : <p className="cl-prose">—</p>}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default ChangeLogTab;
