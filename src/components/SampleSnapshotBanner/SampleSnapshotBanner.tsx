import { AlertTriangle } from "lucide-react";

import { useLabels } from "../../data/labels/useLabels";
import { formatNumber } from "../../utils/formatting";
import "./SampleSnapshotBanner.css";

/**
 * A2: some sampled images are shown from the sample snapshot because the month's
 * population no longer contains them. One component for every report surface.
 */
export function SampleSnapshotBanner({ count, variant = "report" }: { count: number; variant?: "report" | "designer" }) {
  const L = useLabels();
  if (count <= 0) return null;
  return (
    <div className="sample-snapshot-banner" role="alert" dir="rtl">
      <AlertTriangle size={14} aria-hidden />
      <span>{(variant === "designer" ? L.report_designer_sample_snapshot_banner : L.report_sample_snapshot_banner).replace("{count}", formatNumber(count))}</span>
    </div>
  );
}
