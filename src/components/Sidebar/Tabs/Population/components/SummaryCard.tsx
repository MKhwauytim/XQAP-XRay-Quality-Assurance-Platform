import { formatNumber } from "./helpers";

type SummaryCardProps = {
  label: string;
  value: number;
};

export default function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </article>
  );
}
