import type { AuthRole } from "../../../../auth/authTypes";
import { MANAGED_ROLES } from "../../../../auth/userManagement";

const ROLE_BADGE_COLORS: Record<string, string> = {
  guest: "um-badge-guest",
  employee: "um-badge-employee",
  supervisor: "um-badge-supervisor",
  manager: "um-badge-manager",
  admin: "um-badge-admin",
};

export function RoleBadge({ role }: { role: AuthRole }) {
  const label = MANAGED_ROLES.find((item) => item.id === role)?.label ?? role;
  return <span className={`um-role-badge ${ROLE_BADGE_COLORS[role] ?? ""}`}>{label}</span>;
}
