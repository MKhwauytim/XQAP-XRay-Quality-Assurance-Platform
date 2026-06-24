import type { DistributionEntry } from "../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../data/answers/answerTypes";

type PanelPosition = "right" | "bottom";

type Props = {
  entry: DistributionEntry;
  savedAnswer: ItemAnswer | null;
  panelPosition: PanelPosition;
  onTogglePosition: () => void;
  onClose: () => void;
};

export function PanelHeader({
  entry,
  savedAnswer,
  panelPosition,
  onTogglePosition,
  onClose,
}: Props) {
  const isSubmitted = entry.status === "completed" || savedAnswer?.status === "submitted";
  const isReplaced  = entry.status === "replaced";

  const badgeClass = isReplaced ? "ip-badge--replaced"
    : isSubmitted ? "ip-badge--done"
    : "ip-badge--pending";

  const badgeText = isReplaced ? "مستبدلة"
    : isSubmitted ? "مقدم"
    : "قيد التحرير";

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
            title={panelPosition === "right" ? "تبديل إلى اللوحة السفلية" : "تبديل إلى اللوحة الجانبية"}
            onClick={onTogglePosition}
            aria-label="تبديل موضع اللوحة"
          >
            {panelPosition === "right" ? "⊟" : "⊞"}
          </button>
          <button
            type="button"
            className="ip-ctrl-btn"
            title="إغلاق اللوحة"
            onClick={onClose}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
