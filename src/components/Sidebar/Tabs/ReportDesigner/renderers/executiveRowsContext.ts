import { createContext, useContext } from "react";

/** One executive-report fact row, as `buildExecutiveReportRows` produces it. */
export type ExecutiveRow = Record<string, unknown>;

/**
 * Executive report rows shared across every KPI tile on a Report Designer canvas.
 *
 * Three EXPLICIT states, because the previous shape (`Array | null`) overloaded `null` to mean
 * both "not loaded yet" and "loaded, and there is nothing" — and an empty array to mean both
 * "loaded, zero rows" and "the load failed, here is a stand-in". Consumers could not tell those
 * apart, so a KPI tile rendered a confident `0` for a month whose data had not arrived (or had
 * failed to load) — a fabricated number, which is exactly what this app's own KPI invariant
 * ("a null denominator renders «—», never 0") forbids everywhere else.
 *
 * - `loading`      — no answer yet (also: no workspace/month selected).
 * - `loaded-empty` — the load finished and produced zero fact rows (this includes the
 *                    load-failure path, where the provider additionally shows an error banner).
 * - `loaded`       — the load finished with at least one row; `rows` is non-empty.
 */
export type ExecutiveRowsState =
  | { status: "loading" }
  | { status: "loaded-empty" }
  | { status: "loaded"; rows: ExecutiveRow[] };

export const EXECUTIVE_ROWS_LOADING: ExecutiveRowsState = { status: "loading" };
export const EXECUTIVE_ROWS_EMPTY: ExecutiveRowsState = { status: "loaded-empty" };

/** Classify a finished load: zero rows is `loaded-empty`, never a `loaded` empty array. */
export function toExecutiveRowsState(rows: ExecutiveRow[]): ExecutiveRowsState {
  return rows.length === 0 ? EXECUTIVE_ROWS_EMPTY : { status: "loaded", rows };
}

export const ExecutiveRowsContext = createContext<ExecutiveRowsState>(EXECUTIVE_ROWS_LOADING);

/**
 * Read the shared executive rows loaded by `ExecutiveRowsProvider`. Without a provider above it
 * (or while one is still loading) this reports `loading`, so a tile shows the neutral «—» rather
 * than a number it cannot justify.
 *
 * Split from the provider component so this module exports no components — otherwise Fast Refresh
 * cannot hot-reload the provider (`react-refresh/only-export-components`). Mirrors the existing
 * `GlobalMonthContext.ts` / `GlobalMonthProvider.tsx` / `useGlobalMonth` split.
 */
export function useExecutiveRows(): ExecutiveRowsState {
  return useContext(ExecutiveRowsContext);
}
