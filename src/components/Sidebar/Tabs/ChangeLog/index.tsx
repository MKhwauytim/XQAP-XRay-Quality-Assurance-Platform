/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ReactNode } from "react";
import { History, Search } from "lucide-react";

import { PageHeader } from "../../../../components/PageHeader/PageHeader";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { formatNumber } from "../../../../utils/formatting";
import type { SidebarTabModule } from "../tabTypes";
// Bundled at build time from the repo's authoritative edit log. Newest-first.
import editLogRaw from "../../../../../docs/EDIT_LOG.md?raw";
import "./ChangeLog.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "change-log",
  label: "سجل الإصدارات",
  order: 96,
  allowedRoles: tabAllowedRoles("change-log"),
  icon: <History size={20} strokeWidth={1.8} aria-hidden />,
};

// ── Parsing ─────────────────────────────────────────────────────────────────
// Each version is a level-2 heading: "## v34.4 — 2026-07-01 — Title (TAG)".
// The body is everything up to the next such heading (separator rules trimmed).

type ChangeEntry = {
  version: string;
  date: string;
  title: string;
  tag: string | null;
  body: string;
};

const HEADING_RE = /^##\s+(v[\d.]+)\s+—\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s*$/;
const TAG_RE = /\s*\(([A-Z]+)\)\s*$/;

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
      const tagMatch = TAG_RE.exec(rawTitle);
      current = {
        version: match[1]!,
        date: match[2]!,
        title: rawTitle.replace(TAG_RE, "").trim(),
        tag: tagMatch ? tagMatch[1]! : null,
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

const TAG_LABELS_AR: Record<string, string> = {
  FEATURE: "ميزة",
  BUG: "إصلاح",
  FIX: "إصلاح",
  CHORE: "صيانة",
  DESIGN: "تصميم",
};

function tagClass(tag: string | null): string {
  switch (tag) {
    case "FEATURE":
      return "cl-tag--feature";
    case "BUG":
    case "FIX":
      return "cl-tag--fix";
    case "DESIGN":
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

function renderBody(body: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const fenceRe = /```(?:[\w-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  const pushProse = (chunk: string) => {
    const paragraphs = chunk.split(/\n{2,}/);
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      // VIS-03: dir="auto" so English commit prose reads LTR inside the RTL page
      blocks.push(
        <p key={`p-${key++}`} className="cl-prose" dir="auto">
          {trimmed.split("\n").map((ln, i) => (
            <span key={i} className="cl-prose-line" dir="auto">
              {renderInline(ln, `l-${key}-${i}`)}
            </span>
          ))}
        </p>
      );
    }
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
