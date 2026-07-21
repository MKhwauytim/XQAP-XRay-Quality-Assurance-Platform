import { useState } from "react";
import "./Pagination.css";
import { DATA_PAGE_SIZE, clampPage } from "./paginationUtils";

type PaginationProps = {
  page: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  itemLabel?: string;
};

export default function Pagination({
  page,
  totalItems,
  onPageChange,
  pageSize = DATA_PAGE_SIZE,
  itemLabel = "صف",
}: PaginationProps) {
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
    const nextPage = Number(value);
    if (Number.isFinite(nextPage)) goToPage(nextPage);
  };

  return (
    <nav className="data-pagination" aria-label="التنقل بين صفحات البيانات">
      <p className="data-pagination-summary" aria-live="polite">
        عرض {firstItem.toLocaleString("ar-SA-u-nu-latn")} إلى {lastItem.toLocaleString("ar-SA-u-nu-latn")} من {totalItems.toLocaleString("ar-SA-u-nu-latn")} {itemLabel}
      </p>
      <div className="data-pagination-controls">
        <button type="button" onClick={() => goToPage(1)} disabled={safePage === 1} aria-label="الصفحة الأولى">الأولى</button>
        <button type="button" onClick={() => goToPage(safePage - 1)} disabled={safePage === 1} aria-label="الصفحة السابقة">السابق</button>
        <label className="data-pagination-page">
          <span>الصفحة</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            aria-label="رقم الصفحة"
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
          <span>من {totalPages.toLocaleString("ar-SA-u-nu-latn")}</span>
        </label>
        <button type="button" onClick={() => goToPage(safePage + 1)} disabled={safePage === totalPages} aria-label="الصفحة التالية">التالي</button>
        <button type="button" onClick={() => goToPage(totalPages)} disabled={safePage === totalPages} aria-label="الصفحة الأخيرة">الأخيرة</button>
      </div>
    </nav>
  );
}
