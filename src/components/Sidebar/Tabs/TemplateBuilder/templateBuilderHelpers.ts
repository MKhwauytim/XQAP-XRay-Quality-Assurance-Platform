import type { AuthRole } from "../../../../auth/authTypes";

/**
 * Returns true if the given role is allowed to use the Template Builder tab.
 * Extracted from index.tsx into its own file so that index.tsx only exports
 * the default component, satisfying the react-refresh/only-export-components rule.
 */
export function canUseTemplateBuilder(role: AuthRole): boolean {
  return role === "admin";
}
