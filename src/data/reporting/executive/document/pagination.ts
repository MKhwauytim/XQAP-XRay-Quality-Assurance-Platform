// Explicit table pagination for the A4 Document (design §4.1).
// Replaces the removed runtime `transform:scale()` hack: long tables are split
// across N pages BY DESIGN, with the header repeated on every page, rather than
// being shrunk to fit at runtime. Pure functions — no DOM, no React.

import { esc } from "../primitives";

export type Cell = string | number | null;

export type PaginatedTableOpts = {
  headers: string[];
  rows: Cell[][];
  /** Max body rows per page chunk. Tune per page density. Default 16. */
  rowsPerPage?: number;
  /** Optional total row rendered ONLY on the last chunk. */
  totalRow?: Cell[];
  /** Optional per-row class resolver (e.g. highlight insufficient ports). */
  rowClass?: (row: Cell[], index: number) => string | undefined;
};

function cellHtml(c: Cell): string {
  if (c === null) return `<td><span class="insuff">—</span></td>`;
  return `<td>${esc(String(c))}</td>`;
}

function tableChunk(
  headers: string[],
  rows: Cell[][],
  rowClass: PaginatedTableOpts["rowClass"],
  baseIndex: number,
  totalRow?: Cell[],
): string {
  const th = headers.map((h) => `<th>${esc(String(h))}</th>`).join("");
  const trs = rows
    .map((row, i) => {
      const cls = rowClass?.(row, baseIndex + i);
      return `<tr${cls ? ` class="${esc(cls)}"` : ""}>${row.map(cellHtml).join("")}</tr>`;
    })
    .join("");
  const tot = totalRow
    ? `<tr class="total-row">${totalRow.map((c) => `<td>${c === null ? "" : esc(String(c))}</td>`).join("")}</tr>`
    : "";
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}${tot}</tbody></table></div>`;
}

/**
 * Split `rows` into chunks of `rowsPerPage`, returning one table-HTML string per
 * chunk (header repeated each time). The caller places each chunk on its own page.
 * A single short table returns a one-element array (no extra pages).
 */
export function paginateRows(opts: PaginatedTableOpts): string[] {
  const perPage = Math.max(1, opts.rowsPerPage ?? 16);
  const chunks: string[] = [];
  if (opts.rows.length === 0) {
    chunks.push(tableChunk(opts.headers, [], opts.rowClass, 0, opts.totalRow));
    return chunks;
  }
  for (let start = 0; start < opts.rows.length; start += perPage) {
    const slice = opts.rows.slice(start, start + perPage);
    const isLast = start + perPage >= opts.rows.length;
    chunks.push(
      tableChunk(opts.headers, slice, opts.rowClass, start, isLast ? opts.totalRow : undefined),
    );
  }
  return chunks;
}

/** Convenience: render a (non-paginated) single table — for short tables. */
export function dataTable(opts: Omit<PaginatedTableOpts, "rowsPerPage">): string {
  return tableChunk(opts.headers, opts.rows, opts.rowClass, 0, opts.totalRow);
}
