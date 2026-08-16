import type { ReportDocument } from "../../../../data/reportDesigner/reportTypes";
import { useFocusTrap } from "../../../../hooks/useFocusTrap";
import { ModalPortal } from "../../../ModalPortal/ModalPortal";
import { useLabels } from "../../../../data/labels/useLabels";
import Canvas from "./editor/Canvas";

interface PrintViewProps {
  doc: ReportDocument;
  onClose: () => void;
}

/**
 * Full-screen print preview.
 *
 * It was a bare `position: fixed` div: no portal (so a tab wrapper's
 * `transform` could become the containing block for its own `position: fixed`),
 * no `role`/accessible name, no focus trap and no Escape — the only way out was
 * finding the "رجوع" button with a pointer. It is a full-screen overlay that
 * covers the whole app, so it is treated as what it is: a modal dialog, wired
 * through the same `ModalPortal` + `useFocusTrap` pair every other overlay uses.
 */
export default function PrintView({ doc, onClose }: PrintViewProps) {
  const labels = useLabels();
  // Only mounted while open, so the hook's default `enabled: true` is correct.
  const overlayRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  return (
    <ModalPortal>
      <div
        ref={overlayRef}
        className="rd-print-overlay"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label={labels.rd_print_view_aria}
        style={{
          position: "fixed",
          inset: 0,
          background: "white",
          zIndex: 9999,
          overflowY: "auto",
          padding: "16px",
          boxSizing: "border-box",
        }}
      >
        <div
          className="rd-no-print"
          style={{ display: "flex", gap: "8px", marginBottom: "16px" }}
        >
          <button type="button" className="rd-btn rd-btn-secondary" onClick={onClose}>
            {labels.rd_back_btn}
          </button>
          <button
            type="button"
            className="rd-btn rd-btn-primary"
            onClick={() => window.print()}
          >
            {labels.rd_print_btn}
          </button>
        </div>

        {doc.pages.map((_page, i) => (
          <div key={i} className="rd-print-page">
            <Canvas
              doc={doc}
              pageIndex={i}
              selectedId={null}
              onSelect={() => {}}
              mode="view"
              zoom={1}
            />
          </div>
        ))}
      </div>
    </ModalPortal>
  );
}
