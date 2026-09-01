import type { PreparedPopulationRow } from "../population/populationTypes";
import type { EmployeePortRestriction } from "../population/populationConfig";

/** Matches the fallback used everywhere else a row's port is grouped/displayed. */
export const UNSPECIFIED_PORT = "غير محدد";
const UNCATEGORIZED_PORT_TYPE = "غير مصنّف";

/** A row's port name, normalized the same way everywhere eligibility is checked. */
export function normalizePortName(portName: string | null): string {
  return portName ?? UNSPECIFIED_PORT;
}

export type PortCatalogEntry = { portName: string; rowCount: number };
export type PortCatalogCategory = { category: string; ports: PortCatalogEntry[] };

/**
 * Whether `username` may receive a row from `portName`, per the workspace's
 * employee port restrictions. No entry, or an entry with `restricted: false`,
 * means unrestricted — the default for every employee, including a port added
 * to the population after the restriction was last saved.
 */
export function isPortEligible(
  username: string,
  portName: string,
  restrictions: EmployeePortRestriction[]
): boolean {
  const restriction = restrictions.find((r) => r.username === username);
  if (!restriction || !restriction.restricted) return true;
  return restriction.enabledPorts.includes(portName);
}

/** Whether ANY employee in the workspace currently has a port restriction active. */
export function hasAnyPortRestriction(restrictions: EmployeePortRestriction[]): boolean {
  return restrictions.some((r) => r.restricted);
}

/**
 * Distinct ports present in `rows`, grouped by their raw `portType` value (the
 * workbook's own category text — e.g. "بحري"/"بري" — not a fixed enum), each
 * with how many rows currently sit at that port. Used to populate the port
 * restriction picker for the sample currently being distributed.
 */
export function derivePortCatalog(rows: PreparedPopulationRow[]): PortCatalogCategory[] {
  const categories = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const category = row.portType?.trim() || UNCATEGORIZED_PORT_TYPE;
    const portName = normalizePortName(row.portName);
    const ports = categories.get(category) ?? new Map<string, number>();
    ports.set(portName, (ports.get(portName) ?? 0) + 1);
    categories.set(category, ports);
  }

  return [...categories.entries()]
    .map(([category, ports]) => ({
      category,
      ports: [...ports.entries()]
        .map(([portName, rowCount]) => ({ portName, rowCount }))
        .sort((a, b) => b.rowCount - a.rowCount),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "ar"));
}
