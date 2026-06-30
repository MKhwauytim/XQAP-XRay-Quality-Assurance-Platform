import type { ReactNode } from "react";

type Tone = "default" | "premium" | "success" | "danger";

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaDirection?: "up" | "down";
  tone?: Tone;
  className?: string;
}

/**
 * Thin presentational KPI card over the canonical `.ui-stat` primitive
 * (see src/styles/primitives.css).
 */
export function StatCard({
  label,
  value,
  delta,
  deltaDirection,
  tone = "default",
  className,
}: StatCardProps) {
  const classes = [
    "ui-stat",
    tone !== "default" ? `ui-stat--${tone}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__value">{value}</span>
      {delta != null ? (
        <span
          className={`ui-stat__delta${
            deltaDirection ? ` ui-stat__delta--${deltaDirection}` : ""
          }`}
        >
          {delta}
        </span>
      ) : null}
    </div>
  );
}

export default StatCard;
