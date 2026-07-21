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
  if (totalItems <= pageSize) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = clampPage(page, totalItems, pageSize);
  const firstItem = (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(safePage * pageSize, totalItems);
  const goToPage = (nextPage: number) => onPageChange(clampPage(nextPage, totalItems, pageSize));

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
            value={safePage}
            aria-label="رقم الصفحة"
            onChange={(event) => {
              const nextPage = Number(event.target.value);
              if (Number.isFinite(nextPage)) goToPage(nextPage);
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
