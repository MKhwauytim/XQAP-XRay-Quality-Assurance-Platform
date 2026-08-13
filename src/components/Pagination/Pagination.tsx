import { Fragment, useState } from "react";
import "./Pagination.css";
import { DATA_PAGE_SIZE, clampPage } from "../../utils/paginationUtils";
import { getLabels } from "../../data/labels/labelsStore";
import { formatNumber } from "../../utils/formatting";

type PaginationProps = {
  page: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  itemLabel?: string;
};

/**
 * Renders a label template's `{placeholder}` slots as React nodes.
 *
 * The summary interleaves three separately-formatted numbers with Arabic
 * connective words, so each number is wrapped in `<bdi>`: without an isolate,
 * a digit run adjacent to RTL text can be reordered by the bidi algorithm and
 * read as the wrong value. Building the string with `.replace()` and dropping
 * it into JSX would lose that isolation.
 */
function renderTemplate(template: string, vars: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/g).map((part, i) => {
    const key = part.startsWith("{") && part.endsWith("}") ? part.slice(1, -1) : null;
    return <Fragment key={i}>{key && key in vars ? vars[key] : part}</Fragment>;
  });
}

export default function Pagination({
  page,
  totalItems,
  onPageChange,
  pageSize = DATA_PAGE_SIZE,
  itemLabel,
}: PaginationProps) {
  const L = getLabels();
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = clampPage(page, totalItems, pageSize);
  const firstItem = (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(safePage * pageSize, totalItems);
  const [pageInput, setPageInput] = useState({ page: safePage, value: String(safePage) });
  const pageInputValue = pageInput.page === safePage ? pageInput.value : String(safePage);

  if (totalItems <= pageSize) return null;

  const goToPage = (nextPage: number) => {
    const targetPage = clampPage(nextPage, totalItems, pageSize);
    setPageInput({ page: targetPage, value: String(targetPage) });
    onPageChange(targetPage);
  };

  const commitPageInput = () => {
    const value = pageInputValue.trim();
    if (!value) {
      setPageInput({ page: safePage, value: String(safePage) });
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setPageInput({ page: safePage, value: String(safePage) });
      return;
    }
    goToPage(Math.trunc(parsed));
  };

  return (
    <nav className="data-pagination" aria-label={L.pg_nav_aria}>
      <p className="data-pagination-summary" aria-live="polite">
        {renderTemplate(L.pg_summary, {
          from: <bdi>{formatNumber(firstItem)}</bdi>,
          to: <bdi>{formatNumber(lastItem)}</bdi>,
          total: <bdi>{formatNumber(totalItems)}</bdi>,
          // Defaults to the shared row-suffix label rather than a second
          // hardcoded copy of the same word.
          item: itemLabel ?? L.dt_row_suffix,
        })}
      </p>
      <div className="data-pagination-controls">
        <button
          type="button"
          onClick={() => goToPage(1)}
          disabled={safePage === 1}
          aria-label={L.pg_first_aria}
        >
          {L.pg_first_label}
        </button>
        <button
          type="button"
          onClick={() => goToPage(safePage - 1)}
          disabled={safePage === 1}
          aria-label={L.pg_prev_aria}
        >
          {L.pg_prev_label}
        </button>
        <label className="data-pagination-page">
          <span>{L.pg_page_label}</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            aria-label={L.pg_page_number_aria}
            value={pageInputValue}
            onChange={(event) => setPageInput({ page: safePage, value: event.target.value })}
            onBlur={commitPageInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitPageInput();
              }
              if (event.key === "Escape") {
                setPageInput({ page: safePage, value: String(safePage) });
              }
            }}
          />
          <span>
            {renderTemplate(L.pg_of_label, { total: <bdi>{formatNumber(totalPages)}</bdi> })}
          </span>
        </label>
        <button
          type="button"
          onClick={() => goToPage(safePage + 1)}
          disabled={safePage === totalPages}
          aria-label={L.pg_next_aria}
        >
          {L.pg_next_label}
        </button>
        <button
          type="button"
          onClick={() => goToPage(totalPages)}
          disabled={safePage === totalPages}
          aria-label={L.pg_last_aria}
        >
          {L.pg_last_label}
        </button>
      </div>
    </nav>
  );
}
