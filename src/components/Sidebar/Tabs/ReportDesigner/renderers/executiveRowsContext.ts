import { createContext, useContext } from "react";

/**
 * Executive report rows shared across every KPI tile on a Report Designer canvas.
 *
 * `null` doubles as "not loaded / no data yet" — `KpiRenderer` already treats a null result as its
 * loading state, so no extra `isLoading` flag is needed.
 */
export type ExecutiveRowsValue = Array<Record<string, unknown>> | null;

export const ExecutiveRowsContext = createContext<ExecutiveRowsValue>(null);

/**
 * Read the shared executive rows loaded by `ExecutiveRowsProvider`. Returns `null` while loading,
 * or when no month/workspace is selected.
 *
 * Split from the provider component so this module exports no components — otherwise Fast Refresh
 * cannot hot-reload the provider (`react-refresh/only-export-components`). Mirrors the existing
 * `GlobalMonthContext.ts` / `GlobalMonthProvider.tsx` / `useGlobalMonth` split.
 */
export function useExecutiveRows(): ExecutiveRowsValue {
  return useContext(ExecutiveRowsContext);
}
