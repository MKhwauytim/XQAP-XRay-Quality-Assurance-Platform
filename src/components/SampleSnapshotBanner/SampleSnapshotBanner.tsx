import { AlertTriangle } from "lucide-react";

import { useLabels } from "../../data/labels/useLabels";
import "./SampleSnapshotBanner.css";

/**
 * A2: some sampled images are shown from the sample snapshot because the month's
 * population no longer contains them. One component for every report surface.
 */
export function SampleSnapshotBanner({ count }: { count: number }) {
  const L = useLabels();
  if (count <= 0) return null;
  return (
    <div className="sample-snapshot-banner" role="alert" dir="rtl">
      <AlertTriangle size={14} aria-hidden />
      <span>{L.report_sample_snapshot_banner.replace("{count}", count.toLocaleString("ar-SA-u-nu-latn"))}</span>
    </div>
  );
}
