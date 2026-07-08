type StatusFilter = "all" | "pending" | "approved" | "denied";

type Props = {
  counts: Record<StatusFilter, number>;
  active: StatusFilter;
  onSelect: (filter: StatusFilter) => void;
};

const ORDER: StatusFilter[] = ["pending", "approved", "denied", "all"];
const LABELS: Record<StatusFilter, string> = { pending: "معلّق", approved: "مقبول", denied: "مرفوض", all: "الكل" };

export default function SummaryBar({ counts, active, onSelect }: Props) {
  return (
    <div className="ew-summary-bar" role="tablist" aria-label="تصفية حسب الحالة">
      {ORDER.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`ew-summary-chip${active === key ? " active" : ""}${key === "pending" && counts.pending > 0 ? " has-pending" : ""}`}
          onClick={() => onSelect(key)}
        >
          {LABELS[key]}
          <span className="ew-status-count">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
