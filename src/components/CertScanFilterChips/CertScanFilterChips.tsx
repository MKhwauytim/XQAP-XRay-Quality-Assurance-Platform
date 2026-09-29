import {
  CERTSCAN_FILTERS,
  type CertScanFilter,
  type CertScanFilterCounts,
} from "../../data/population/certScanFilter";
import { useLabels } from "../../data/labels/useLabels";

type CertScanFilterChipsProps = {
  value: CertScanFilter;
  onChange: (next: CertScanFilter) => void;
  /** Optional per-chip counts; omitted → no count badge (Population Browse,
   *  whose matching set lives in the query worker). */
  counts?: CertScanFilterCounts;
  groupClassName: string;
  chipClassName: string;
  countClassName?: string;
};

/**
 * «كل الصور» / «CertScan» / «غير CertScan» — the one CertScan chip group (C2),
 * shared by the employee case queue and Population Browse. Styling comes from
 * the caller's class names so each surface keeps its own control family;
 * `aria-pressed` states each chip's on/off.
 */
export default function CertScanFilterChips({
  value,
  onChange,
  counts,
  groupClassName,
  chipClassName,
  countClassName,
}: CertScanFilterChipsProps) {
  const L = useLabels();
  const chipLabel: Record<CertScanFilter, string> = {
    any: L.certscan_filter_any,
    certscan: L.certscan_filter_certscan,
    noncertscan: L.certscan_filter_noncertscan,
  };
  return (
    <div className={groupClassName} role="group" aria-label={L.certscan_filter_aria}>
      {CERTSCAN_FILTERS.map((id) => (
        <button
          key={id}
          type="button"
          className={`${chipClassName}${value === id ? " active" : ""}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {chipLabel[id]}
          {counts && <span className={countClassName}>{counts[id]}</span>}
        </button>
      ))}
    </div>
  );
}
