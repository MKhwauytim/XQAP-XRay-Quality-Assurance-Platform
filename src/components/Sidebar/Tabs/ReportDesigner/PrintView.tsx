import type { ReportDocument } from "../../../../data/reportDesigner/reportTypes";
import Canvas from "./editor/Canvas";

interface PrintViewProps {
  doc: ReportDocument;
  onClose: () => void;
}

export default function PrintView({ doc, onClose }: PrintViewProps) {
  return (
    <div
      className="rd-print-overlay"
      dir="rtl"
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
        <button className="rd-btn rd-btn-secondary" onClick={onClose}>
          رجوع
        </button>
        <button
          className="rd-btn rd-btn-primary"
          onClick={() => window.print()}
        >
          طباعة
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
  );
}
