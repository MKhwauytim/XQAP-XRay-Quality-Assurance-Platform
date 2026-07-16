import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { logError } from "../storage/errorLogger";
import { listMonthFolders } from "../population/populationStorage";
import { isMonthClosed } from "../population/monthLock";
import { formatMonthFolderName, type MonthFolderInfo } from "../population/monthFolder";
import { GlobalMonthContext, type MonthChangeGuard } from "./GlobalMonthContext";
import {
  GLOBAL_MONTH_STORAGE_KEY,
  reconcileSelection,
  resolveInitialSelection,
  type GlobalMonthSelection,
} from "./globalMonthLogic";

function readStoredFolderName(): string | null {
  try {
    return sessionStorage.getItem(GLOBAL_MONTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSelection(selection: GlobalMonthSelection): void {
  try {
    if (selection.kind === "none") sessionStorage.removeItem(GLOBAL_MONTH_STORAGE_KEY);
    else sessionStorage.setItem(GLOBAL_MONTH_STORAGE_KEY, selection.folderName);
  } catch {
    // sessionStorage unavailable — the selection just won't survive a reload.
  }
}

export function GlobalMonthProvider({ children }: { children: ReactNode }) {
  const { directoryHandle } = useWorkspace();
  const [months, setMonths] = useState<MonthFolderInfo[]>([]);
  const [selection, setSelection] = useState<GlobalMonthSelection>({ kind: "none" });
  const [isSelectedMonthClosed, setIsSelectedMonthClosed] = useState(false);
  const [lockCheckTick, setLockCheckTick] = useState(0);
  const guardsRef = useRef<Set<MonthChangeGuard>>(new Set());
  const monthsRef = useRef<MonthFolderInfo[]>(months);
  // eslint-disable-next-line react-hooks/refs -- latest-value ref for use in stable callbacks; always reassigned to the current render's value, so double-invocation under StrictMode is a no-op
  monthsRef.current = months;
  const selectionRef = useRef<GlobalMonthSelection>(selection);
  // eslint-disable-next-line react-hooks/refs -- see monthsRef above
  selectionRef.current = selection;

  // (Re)load the month list whenever the workspace handle changes.
  useEffect(() => {
    let cancelled = false;
    if (!directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset when the workspace disconnects
      setMonths([]);
      setSelection({ kind: "none" });
      return;
    }
    void listMonthFolders(directoryHandle)
      .then((list) => {
        if (cancelled) return;
        setMonths(list);
        setSelection((prev) => {
          const next = prev.kind === "none"
            ? resolveInitialSelection(list, readStoredFolderName())
            : reconcileSelection(list, prev);
          persistSelection(next);
          return next;
        });
      })
      .catch((error) => {
        // Listing failed — drop to an empty list AND clear the selection so a
        // stale month from a previous workspace can't linger.
        if (!cancelled) {
          setMonths([]);
          setSelection({ kind: "none" });
        }
        logError("globalMonth:listMonthFolders", error);
      });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  // Month-lock state for the current selection (pending/new months are never closed).
  useEffect(() => {
    let cancelled = false;
    if (!directoryHandle || selection.kind !== "existing") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync clear when preconditions unmet
      setIsSelectedMonthClosed(false);
      return;
    }
    isMonthClosed(directoryHandle, selection.folderName)
      .then((closed) => { if (!cancelled) setIsSelectedMonthClosed(closed); })
      .catch(() => { if (!cancelled) setIsSelectedMonthClosed(false); });
    return () => { cancelled = true; };
  }, [directoryHandle, selection, lockCheckTick]);

  /** Runs every registered guard; the first non-null message triggers window.confirm. */
  const confirmGuardedChange = useCallback((): boolean => {
    for (const guard of guardsRef.current) {
      const message = guard();
      if (message) return window.confirm(message);
    }
    return true;
  }, []);

  const setSelectedMonth = useCallback((folderName: string): boolean => {
    const prev = selectionRef.current;
    if (prev.kind !== "none" && prev.folderName === folderName) return false;
    const match = monthsRef.current.find((entry) => entry.folderName === folderName);
    if (!match) return false;
    if (!confirmGuardedChange()) return false;
    const next: GlobalMonthSelection = { kind: "existing", ...match };
    persistSelection(next);
    setSelection(next);
    return true;
  }, [confirmGuardedChange]);

  const startNewMonth = useCallback((month: number, year: number): boolean => {
    const folderName = formatMonthFolderName(month, year);
    const prev = selectionRef.current;
    if (prev.kind !== "none" && prev.folderName === folderName) return false;
    if (!confirmGuardedChange()) return false;
    const match = monthsRef.current.find((entry) => entry.folderName === folderName);
    const next: GlobalMonthSelection = match
      ? { kind: "existing", ...match }
      : { kind: "pending", month, year, folderName };
    persistSelection(next);
    setSelection(next);
    return true;
  }, [confirmGuardedChange]);

  const refreshMonths = useCallback(async () => {
    if (!directoryHandle) return;
    try {
      const list = await listMonthFolders(directoryHandle);
      setMonths(list);
      setSelection((prev) => {
        const next = reconcileSelection(list, prev);
        persistSelection(next);
        return next;
      });
      setLockCheckTick((tick) => tick + 1);
    } catch (error) {
      // Keep the current months/selection on a listing failure rather than
      // wiping the picker.
      logError("globalMonth:refreshMonths", error);
    }
  }, [directoryHandle]);

  const registerMonthChangeGuard = useCallback((guard: MonthChangeGuard) => {
    guardsRef.current.add(guard);
    return () => { guardsRef.current.delete(guard); };
  }, []);

  const value = useMemo(() => ({
    months,
    selection,
    isSelectedMonthClosed,
    setSelectedMonth,
    startNewMonth,
    refreshMonths,
    registerMonthChangeGuard,
  }), [months, selection, isSelectedMonthClosed, setSelectedMonth, startNewMonth, refreshMonths, registerMonthChangeGuard]);

  return (
    <GlobalMonthContext.Provider value={value}>
      {children}
    </GlobalMonthContext.Provider>
  );
}
