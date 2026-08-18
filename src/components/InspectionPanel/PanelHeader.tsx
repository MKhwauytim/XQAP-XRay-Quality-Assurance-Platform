import { X } from "lucide-react";
import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../data/answers/answerTypes";
import { formatStageLabel } from "../../data/population/stageHelpers";
import { getLabels } from "../../data/labels/labelsStore";
import { formatNumber } from "../../utils/formatting";

type Props = {
  entry: DistributionEntry;
  savedAnswer: ItemAnswer | null;
  onClose: () => void;
  /**
   * Required-field progress, DERIVED by the panel from the active template
   * schema + the current answers (design handoff §"State Management":
   * "requiredFilledCount derived from the template + answers (no new state)").
   * `total === 0` hides the bar — a template with no required fields has no
   * progress to report.
   */
  requiredTotal: number;
  requiredFilled: number;
};

export function PanelHeader({
  entry,
  savedAnswer,
  onClose,
  requiredTotal,
  requiredFilled,
}: Props) {
  const L = getLabels();
  const isSubmitted = entry.status === "completed" || savedAnswer?.status === "submitted";
  const isReplaced  = entry.status === "replaced";

  const badgeClass = isReplaced ? "ip-badge--replaced"
    : isSubmitted ? "ip-badge--done"
    : "ip-badge--pending";

  const badgeText = isReplaced ? L.ip_state_replaced
    : isSubmitted ? L.ip_state_submitted
    : L.ip_state_editing;

  // "المنفذ · المستوى · CertScan" — every part comes off the employee-mirror row
  // stub already inlined on the entry; missing parts are dropped rather than
  // rendered as an empty separator.
  const contextParts = [
    entry.row.portName,
    entry.row.stage ? formatStageLabel(entry.row.stage) : null,
    entry.row.certScanStatus === "Certscan" ? L.ip_certscan_yes
      : entry.row.certScanStatus === "NonCertscan" ? L.ip_certscan_no
      : null,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  const showProgress = requiredTotal > 0;
  const pct = showProgress
    ? Math.max(0, Math.min(100, Math.round((requiredFilled / requiredTotal) * 100)))
    : 0;

  return (
    <div className="ip-header" dir="rtl">
      <div className="ip-header-top">
        <div className="ip-header-id">
          <span className="ip-xray-id">{entry.xrayImageId}</span>
          <span className={`ip-badge ${badgeClass}`}>{badgeText}</span>
        </div>
        <div className="ip-header-controls">
          <button
            type="button"
            className="ip-ctrl-btn"
            title={L.ip_close_panel_title}
            onClick={onClose}
            aria-label={L.ip_close_panel_aria}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {contextParts.length > 0 && (
        <p className="ip-header-context">{contextParts.join(" · ")}</p>
      )}

      {showProgress && (
        <div className="ip-progress">
          <div
            className="ip-progress-track"
            role="progressbar"
            aria-label={L.ip_required_progress_aria}
            aria-valuemin={0}
            aria-valuemax={requiredTotal}
            aria-valuenow={requiredFilled}
          >
            <div className="ip-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="ip-progress-count">
            {L.ip_required_progress
              .replace("{filled}", formatNumber(requiredFilled))
              .replace("{total}", formatNumber(requiredTotal))}
          </span>
        </div>
      )}
    </div>
  );
}
