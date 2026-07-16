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
  setSelectedMonth: (folderName: string) => void;
  startNewMonth: (month: number, year: number) => void;
  refreshMonths: () => Promise<void>;
  registerMonthChangeGuard: (guard: MonthChangeGuard) => () => void;
};

export const GlobalMonthContext = createContext<GlobalMonthContextValue | null>(null);
