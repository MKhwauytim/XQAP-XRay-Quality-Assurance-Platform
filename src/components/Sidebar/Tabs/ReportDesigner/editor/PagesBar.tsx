import type { ReportDocument } from "../../../../../data/reportDesigner/reportTypes";
import { useLabels } from "../../../../../data/labels/useLabels";

interface PagesBarProps {
  doc: ReportDocument;
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  /** onAddPage/onDeletePage already reject silently when this is false (handler
   *  boundary, see TabView.tsx addPage/handleDeletePage) -- render-gate the
   *  add/delete affordances to match, instead of leaving them looking clickable. */
  canEdit: boolean;
}

export default function PagesBar({ doc, currentPageIndex, onSelectPage, onAddPage, onDeletePage, canEdit }: PagesBarProps) {
  const labels = useLabels();
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
          {canEdit && (
            <span
              className="rd-page-tab-del"
              role="button"
              aria-label={labels.rd_delete_page_aria.replace("{name}", page.name)}
              onClick={(e) => { e.stopPropagation(); if (doc.pages.length > 1) onDeletePage(i); }}
              title={labels.rd_delete_page_title}
            >
              ×
            </span>
          )}
        </button>
      ))}
      <button
        className="rd-page-tab-add"
        onClick={onAddPage}
        type="button"
        title={!canEdit ? labels.rd_edit_denied_msg : labels.rd_add_page_title}
        disabled={!canEdit}
      >
        {labels.rd_add_page_btn}
      </button>
    </div>
  );
}
