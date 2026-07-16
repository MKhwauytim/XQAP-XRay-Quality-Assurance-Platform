import { useContext } from "react";

import {
  GlobalMonthContext,
  type GlobalMonthContextValue,
} from "./GlobalMonthContext";

export function useGlobalMonth(): GlobalMonthContextValue {
  const context = useContext(GlobalMonthContext);

  if (!context) {
    throw new Error("useGlobalMonth must be used inside GlobalMonthProvider.");
  }

  return context;
}
