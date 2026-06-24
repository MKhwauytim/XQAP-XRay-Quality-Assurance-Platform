import { useState, useRef, useEffect } from "react";
import { ClipboardList } from "lucide-react";

type HighlightType = "port" | "sn" | null;

type CertScanGridProps = {
  initialText?: string;
  onDataChange: (certScanText: string) => void;
};

function parsePaste(text: string): string[][] {
  return text
    .trim()
    .split("\n")
    .map((row) => row.split("\t").map((c) => c.trim()));
}

function buildCertScanText(
  data: string[][],
  portCol: number | null,
  snCol: number | null
): string {
  if (!data.length || portCol === null || snCol === null) return "";
  const header = "Port Name\tSystem S/N";
  const dataRows = data.slice(1).map(
    (row) => `${row[portCol] ?? ""}\t${row[snCol] ?? ""}`
  );
  return [header, ...dataRows].join("\n");
}

/** Parse the stored "Port Name\tSystem S/N\n..." format back into grid rows */
function parseStoredText(text: string): { data: string[][]; portCol: number; snCol: number } | null {
  if (!text.trim()) return null;
  const rows = text.trim().split("\n").map((r) => r.split("\t"));
  if (rows.length < 1) return null;
  return { data: rows, portCol: 0, snCol: 1 };
}

/** Merge new paste rows into existing grid, deduplicating by (portName, sn) */
function mergeRows(
  existing: string[][],
  existingPortCol: number,
  existingSnCol: number,
  incoming: string[][],
  inPortCol: number | null,
  inSnCol: number | null
): string[][] {
  if (inPortCol === null || inSnCol === null || incoming.length < 2) return existing;

  const seen = new Set<string>();
  for (const row of existing.slice(1)) {
    seen.add(`${row[existingPortCol] ?? ""}|||${row[existingSnCol] ?? ""}`);
  }

  const newRows: string[][] = [];
  for (const row of incoming.slice(1)) {
    const key = `${row[inPortCol] ?? ""}|||${row[inSnCol] ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      // Normalise to [portName, sn] columns matching existing format
      newRows.push([row[inPortCol] ?? "", row[inSnCol] ?? ""]);
    }
  }

  return [...existing, ...newRows];
}

export default function CertScanGrid({ initialText, onDataChange }: CertScanGridProps) {
  const [gridData, setGridData] = useState<string[][]>([]);
  const [portCol, setPortCol] = useState<number | null>(null);
  const [snCol, setSnCol] = useState<number | null>(null);
  const [activeHL, setActiveHL] = useState<HighlightType>(null);
  const pasteRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  // Load from initialText once
  useEffect(() => {
    if (initialised.current) return;
    if (!initialText) return;
    const parsed = parseStoredText(initialText);
    if (parsed) {
      setGridData(parsed.data);
      setPortCol(parsed.portCol);
      setSnCol(parsed.snCol);
      initialised.current = true;
    }
  }, [initialText]);

  const maxCols = gridData.reduce((m, r) => Math.max(m, r.length), 0);
  const dataRowCount = Math.max(0, gridData.length - 1);
  const isReady = portCol !== null && snCol !== null && dataRowCount > 0;

  function applyPaste(text: string) {
    const incoming = parsePaste(text);
    if (!incoming.length) return;

    // Auto-detect columns in incoming data
    const headers = incoming[0].map((h) => h.toLowerCase());
    const pIdx = headers.findIndex(
      (h) => h.includes("port name") || h === "port" || h.includes("اسم المنفذ")
    );
    const sIdx = headers.findIndex(
      (h) =>
        h.includes("system s/n") ||
        h.includes("system sn") ||
        h === "s/n" ||
        h.includes("serial")
    );
    const newPort = pIdx >= 0 ? pIdx : null;
    const newSn = sIdx >= 0 ? sIdx : null;

    if (gridData.length > 1 && portCol !== null && snCol !== null) {
      // Merge into existing data
      const merged = mergeRows(gridData, portCol, snCol, incoming, newPort, newSn);
      setGridData(merged);
      const text = buildCertScanText(merged, portCol, snCol);
      onDataChange(text);
    } else {
      setGridData(incoming);
      setPortCol(newPort);
      setSnCol(newSn);
      setActiveHL(null);
      onDataChange(buildCertScanText(incoming, newPort, newSn));
    }
  }

  function handleColClick(colIdx: number) {
    if (!activeHL) return;

    let newPort = portCol;
    let newSn = snCol;

    if (activeHL === "port") {
      if (colIdx === snCol) newSn = null;
      newPort = colIdx;
    } else {
      if (colIdx === portCol) newPort = null;
      newSn = colIdx;
    }

    setPortCol(newPort);
    setSnCol(newSn);
    setActiveHL(null);
    onDataChange(buildCertScanText(gridData, newPort, newSn));
  }

  function clearAll() {
    setGridData([]);
    setPortCol(null);
    setSnCol(null);
    setActiveHL(null);
    onDataChange("");
  }

  return (
    <div className="certscan-grid-root">
      {/* ── Toolbar ── */}
      <div className="certscan-toolbar">
        <div className="certscan-hl-group">
          <span className="certscan-toolbar-label">أداة التمييز:</span>

          <button
            type="button"
            className={`certscan-hl-btn port${activeHL === "port" ? " ring" : ""}${portCol !== null ? " done" : ""}`}
            onClick={() => setActiveHL(activeHL === "port" ? null : "port")}
          >
            <span className="certscan-hl-dot port-dot" />
            Port Name
            {portCol !== null && (
              <span className="certscan-hl-assigned">✓ عمود {portCol + 1}</span>
            )}
          </button>

          <button
            type="button"
            className={`certscan-hl-btn sn${activeHL === "sn" ? " ring" : ""}${snCol !== null ? " done" : ""}`}
            onClick={() => setActiveHL(activeHL === "sn" ? null : "sn")}
          >
            <span className="certscan-hl-dot sn-dot" />
            System S/N
            {snCol !== null && (
              <span className="certscan-hl-assigned">✓ عمود {snCol + 1}</span>
            )}
          </button>
        </div>

        <div className="certscan-toolbar-right">
          {isReady && (
            <span className="certscan-ready-chip">
              ✓ {dataRowCount.toLocaleString("ar-SA-u-nu-latn")} جهاز
            </span>
          )}
          {gridData.length > 1 && (
            <button type="button" className="certscan-clear-btn" onClick={clearAll}>
              مسح الكل
            </button>
          )}
        </div>
      </div>

      {/* ── Cursor hint when highlighter active ── */}
      {activeHL && (
        <div className="certscan-cursor-hint" role="status">
          {activeHL === "port" ? "🔴" : "🔵"} انقر على عنوان العمود لتحديده
        </div>
      )}

      {/* ── Paste target / grid ── */}
      {gridData.length <= 1 ? (
        <div
          ref={pasteRef}
          className="certscan-drop-zone"
          tabIndex={0}
          aria-label="منطقة لصق بيانات CertScan"
          onPaste={(e) => {
            e.preventDefault();
            applyPaste(e.clipboardData.getData("text"));
          }}
        >
          <div className="certscan-drop-icon"><ClipboardList size={32} /></div>
          <p className="certscan-drop-title">انقر هنا ثم الصق (Ctrl+V)</p>
          <p className="certscan-drop-sub">
            بيانات CertScan مباشرة من Excel — سيتم اكتشاف الأعمدة تلقائياً
          </p>
          <p className="certscan-drop-sub" style={{ marginTop: 4, opacity: 0.7 }}>
            البيانات تُحفظ تلقائياً وتتراكم شهراً بعد شهر
          </p>
        </div>
      ) : (
        <div className={`certscan-grid-scroll${activeHL ? " selecting" : ""}`}>
          {/* "Add more" paste zone above grid */}
          <div
            className="certscan-add-zone"
            tabIndex={0}
            title="الصق بيانات إضافية لدمجها مع الموجودة"
            onPaste={(e) => {
              e.preventDefault();
              applyPaste(e.clipboardData.getData("text"));
            }}
          >
            ＋ انقر هنا والصق (Ctrl+V) لإضافة المزيد من الأجهزة — الصفوف المكررة تُتجاهل تلقائياً
          </div>

          <table className="certscan-table">
            <thead>
              <tr>
                {Array.from({ length: maxCols }, (_, ci) => {
                  const isPort = ci === portCol;
                  const isSn = ci === snCol;
                  return (
                    <th
                      key={ci}
                      className={[
                        "cg-th",
                        isPort ? "col-port" : "",
                        isSn ? "col-sn" : "",
                        activeHL ? "clickable" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => handleColClick(ci)}
                      title={activeHL ? "انقر لتعيين هذا العمود" : undefined}
                    >
                      {isPort && <span className="cg-col-badge port-badge">Port</span>}
                      {isSn && <span className="cg-col-badge sn-badge">S/N</span>}
                      {gridData[0]?.[ci] ?? ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {gridData.slice(1, 201).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "cg-row-even" : ""}>
                  {Array.from({ length: maxCols }, (_, ci) => (
                    <td
                      key={ci}
                      className={[
                        "cg-td",
                        ci === portCol ? "col-port" : "",
                        ci === snCol ? "col-sn" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {gridData.length > 201 && (
            <div className="certscan-overflow-note">
              عرض أول 200 صف من {(gridData.length - 1).toLocaleString("ar-SA-u-nu-latn")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
