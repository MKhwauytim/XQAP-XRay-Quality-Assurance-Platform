import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

/**
 * Thin presentational wrapper over the canonical `.ui-btn` primitive
 * (see src/styles/primitives.css). Adds no design decisions of its own.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "ui-btn",
    `ui-btn--${variant}`,
    size !== "md" ? `ui-btn--${size}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <span className="ui-btn__icon">{icon}</span> : null}
      {children}
    </button>
  );
}

export default Button;
