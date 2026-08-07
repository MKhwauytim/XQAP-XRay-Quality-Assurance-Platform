import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { NormalizedRiskRow } from "../riskData/riskDataTypes";
import { computeCertScanMatchPreview } from "../processing/certScanMatchPreview";
import type { PortMatchTier } from "../processing/certScanParser";

type CertScanMatchPreviewPanelProps = {
  riskRows: NormalizedRiskRow[];
  certScanPasteText: string;
};

function formatCount(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

function tierBadge(tier: PortMatchTier | null) {
  if (tier === "exact" || tier === null) return null;
  const label = tier === "normalized" ? "مطابقة بعد التطبيع" : "مطابقة تقريبية";
  return (
    <span
      className={`csmp-tier-badge csmp-tier-${tier}`}
      title="هذه المطابقة ليست مطابقة حرفية للاسم — يُرجى التأكد من صحتها"
    >
      {label}
    </span>
  );
}

/**
 * Pre-processing CertScan match preview.
 *
 * The owner's report — "there is only 30 certscan sample while if I do the
 * process myself I get more than 30k" — was only discoverable *after* running
 * the full population processing and reading the summary card. This panel
 * surfaces the same headline numbers, and a per-port breakdown, from the
 * current risk upload + CertScan paste alone, so a mismatch this large is
 * obvious before the user commits to processing.
 */
export default function CertScanMatchPreviewPanel({
  riskRows,
  certScanPasteText
}: CertScanMatchPreviewPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const preview = useMemo(
    () => computeCertScanMatchPreview(riskRows, certScanPasteText),
    [riskRows, certScanPasteText]
  );

  if (!preview.hasPasteData) {
    return null;
  }

  const isSuspicious =
    preview.totalMatchPercentage < 5 ||
    preview.populationOnlyPorts.length > 0 ||
    preview.pasteOnlyPorts.length > 0 ||
    preview.looseTierAlignments.length > 0;

  return (
    <div className={`csmp-panel${isSuspicious ? " csmp-panel-warn" : ""}`} role="status">
      <div className="csmp-header">
        <div>
          <h4 className="csmp-title">معاينة مطابقة CertScan قبل المعالجة</h4>
          <p className="csmp-subtitle">
            هذا ما ستنتجه المعالجة بناءً على اللصق الحالي — راجعه قبل الضغط على "معالجة المجتمع".
          </p>
        </div>
      </div>

      <div className="csmp-stats-row">
        <div className="csmp-stat">
          <span className="csmp-stat-value">{formatCount(preview.totalCertScanEntries)}</span>
          <span className="csmp-stat-label">جهاز CertScan في اللصق</span>
        </div>
        <div className="csmp-stat">
          <span className="csmp-stat-value">{formatCount(preview.totalPopulationRows)}</span>
          <span className="csmp-stat-label">صف مرشّح في المجتمع</span>
        </div>
        <div className={`csmp-stat${isSuspicious ? " csmp-stat-warn" : ""}`}>
          <span className="csmp-stat-value">
            {formatCount(preview.totalMatchedRows)} ({preview.totalMatchPercentage}%)
          </span>
          <span className="csmp-stat-label">مطابقة متوقعة CertScan</span>
        </div>
      </div>

      {isSuspicious && (
        <div className="csmp-warning-banner">
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {preview.totalMatchPercentage < 5 && preview.totalPopulationRows > 0 && (
              <>نسبة المطابقة منخفضة جداً ({preview.totalMatchPercentage}%) — راجع أسماء المنافذ أدناه قبل المتابعة. </>
            )}
            {preview.populationOnlyPorts.length > 0 && (
              <>
                {preview.populationOnlyPorts.length} منفذ في المجتمع لا يوجد له مطابقة في لصق CertScan:{" "}
                <strong>{preview.populationOnlyPorts.slice(0, 5).join("، ")}</strong>
                {preview.populationOnlyPorts.length > 5 ? "…" : ""}
                {". "}
              </>
            )}
            {preview.pasteOnlyPorts.length > 0 && (
              <>
                {preview.pasteOnlyPorts.length} منفذ في لصق CertScan غير موجود في المجتمع:{" "}
                <strong>{preview.pasteOnlyPorts.slice(0, 5).join("، ")}</strong>
                {preview.pasteOnlyPorts.length > 5 ? "…" : ""}
                {". "}
              </>
            )}
            {preview.looseTierAlignments.length > 0 && (
              <>
                {preview.looseTierAlignments.length} منفذ تمت مطابقته بالاسم بعد تطبيع/تقريب وليس مطابقة حرفية —
                تأكد من صحتها في الجدول أدناه.
              </>
            )}
          </span>
        </div>
      )}

      <button
        type="button"
        className="csmp-toggle-btn"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? "إخفاء التفصيل حسب المنفذ" : `عرض التفصيل حسب المنفذ (${preview.portBreakdown.length})`}
      </button>

      {expanded && (
        <div className="csmp-table-scroll">
          <table className="csmp-table">
            <thead>
              <tr>
                <th>منفذ المجتمع</th>
                <th>منفذ CertScan المطابَق</th>
                <th>نوع المطابقة</th>
                <th>صفوف المجتمع</th>
                <th>المطابقة المتوقعة</th>
              </tr>
            </thead>
            <tbody>
              {preview.portBreakdown.map((port) => (
                <tr key={port.populationPortName} className={port.tier === null ? "csmp-row-unmatched" : ""}>
                  <td>{port.populationPortName}</td>
                  <td>{port.alignedPastePortName ?? "— لا توجد مطابقة —"}</td>
                  <td>{tierBadge(port.tier) ?? (port.tier === "exact" ? "مطابقة حرفية" : "—")}</td>
                  <td>{formatCount(port.populationRowCount)}</td>
                  <td>{formatCount(port.matchedRowCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
