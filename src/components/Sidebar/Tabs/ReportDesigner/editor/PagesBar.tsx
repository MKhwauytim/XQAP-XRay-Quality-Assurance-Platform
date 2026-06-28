import type { ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

interface PagesBarProps {
  doc: ReportDocument;
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
}

export default function PagesBar({ doc, currentPageIndex, onSelectPage, onAddPage, onDeletePage }: PagesBarProps) {
  return (
    <div className="rd-pages-bar" dir="rtl">
      {doc.pages.map((page, i) => (
        <button
          key={page.pageId}
          className={`rd-page-tab${i === currentPageIndex ? " rd-page-tab--active" : ""}`}
          onClick={() => onSelectPage(i)}
          title={page.name}
          type="button"
        >
          {page.name}
          <span
            className="rd-page-tab-del"
            role="button"
            aria-label={`حذف ${page.name}`}
            onClick={(e) => { e.stopPropagation(); if (doc.pages.length > 1) onDeletePage(i); }}
            title="حذف الصفحة"
          >
            ×
          </span>
        </button>
      ))}
      <button className="rd-page-tab-add" onClick={onAddPage} type="button" title="إضافة صفحة">
        + صفحة
      </button>
    </div>
  );
}
