import type { ReactNode } from "react";
import "./PageHeader.css";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <p className="page-header-eyebrow">{eyebrow}</p>
        <h1 className="page-header-title">{title}</h1>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  );
}
