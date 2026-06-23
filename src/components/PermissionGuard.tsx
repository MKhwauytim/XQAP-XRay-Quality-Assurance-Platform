import type { ReactNode } from "react";
import { usePermissions } from "../auth/usePermissions";
import type { PermissionLevel } from "../auth/userManagement";

// ── Tab guard ─────────────────────────────────────────────────────────────────

type TabGuardProps = {
  tabId: string;
  /** Minimum required access level. Defaults to "view". */
  min?: Exclude<PermissionLevel, "none">;
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Renders `children` only if the current role has at least `min` access on
 * `tabId`. Uses `fallback` (or the built-in denied page) otherwise.
 */
export function TabGuard({ tabId, min = "view", children, fallback }: TabGuardProps) {
  const { canAccessTab } = usePermissions();
  if (canAccessTab(tabId, min)) return <>{children}</>;
  return <>{fallback ?? <AccessDenied />}</>;
}

// ── Feature guard ─────────────────────────────────────────────────────────────

type FeatureGuardProps = {
  featureId: string;
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Renders `children` only if the current role has the feature enabled AND
 * the parent tab is not blocked (cascade). Uses `fallback` otherwise.
 */
export function FeatureGuard({ featureId, children, fallback }: FeatureGuardProps) {
  const { can } = usePermissions();
  if (can(featureId)) return <>{children}</>;
  return <>{fallback ?? null}</>;
}

// ── Access denied page ────────────────────────────────────────────────────────

export function AccessDenied() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "300px",
        gap: "12px",
        color: "var(--app-text-muted, #6b7280)",
        direction: "rtl",
        textAlign: "center",
        padding: "40px",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="48"
        height="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      </svg>
      <strong style={{ fontSize: "1.1rem", color: "var(--app-text, #111)" }}>
        غير مصرح
      </strong>
      <p style={{ margin: 0, fontSize: "0.9rem" }}>
        لا تملك صلاحية الوصول إلى هذا القسم.
        <br />
        تواصل مع مسؤول النظام إذا كنت بحاجة لهذا الوصول.
      </p>
    </div>
  );
}
