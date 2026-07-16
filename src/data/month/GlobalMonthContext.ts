import { createContext } from "react";

import type { MonthFolderInfo } from "../population/monthFolder";
import type { GlobalMonthSelection } from "./globalMonthLogic";

/** Returns a confirm message when switching months needs user confirmation, or null when clean. */
export type MonthChangeGuard = () => string | null;

export type GlobalMonthContextValue = {
  months: MonthFolderInfo[];
  selection: GlobalMonthSelection;
  /** Month-lock state (Tier-1 Item A) for the current selection. */
  isSelectedMonthClosed: boolean;
  /** Switches to an existing month. Returns true when the change was applied, false on a no-op (already selected / unknown folder) or when a registered guard declined the switch. */
  setSelectedMonth: (folderName: string) => boolean;
  /** Starts (or switches to) a month. Returns true when the change was applied, false on a no-op (already selected) or when a registered guard declined the switch. */
  startNewMonth: (month: number, year: number) => boolean;
  refreshMonths: () => Promise<void>;
  registerMonthChangeGuard: (guard: MonthChangeGuard) => () => void;
};

export const GlobalMonthContext = createContext<GlobalMonthContextValue | null>(null);
