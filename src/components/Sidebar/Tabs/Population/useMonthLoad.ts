import { useEffect, useRef, useState } from "react";

import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { GlobalMonthSelection } from "../../../../data/month/globalMonthLogic";
import type { MonthChangeGuard } from "../../../../data/month/GlobalMonthContext";
import { logError } from "../../../../data/storage/errorLogger";
import { getLabels } from "../../../../data/labels/labelsStore";
import {
  loadMonthForEditing,
  type MonthLoadScope,
} from "../../../../data/population/populationStorage";
import {
  registerBootSources,
  markBootSourceLoading,
  markBootSourceLoaded,
  markBootSourceError,
} from "../../../../data/workspace/bootProgress";
import { buildLoadedMonthState } from "./populationWorkflowHelpers";

export type LoadedMonthState = ReturnType<typeof buildLoadedMonthState>;

type BootSourceDescriptor = { key: string; labelEn: string; labelAr: string };

/**
 * Named on-disk sources this hook's single `loadMonthForEditing` call actually
 * reads, given `scope` -- kept in lockstep with `computeMonthLoadScope`
 * (`populationWorkflowHelpers.ts`): the manifest and `summary`/`sample`/
 * `distribution` are always read regardless of scope, `population`/`raw` only
 * when the caller's scope includes them (see `MonthLoadScope`). Feeds the
 * post-login boot-progress checklist (`src/data/workspace/bootProgress.ts`) so
 * a viewer can see which real files this load actually touched -- this is pure
 * reporting, it never changes what `loadMonthForEditing` itself fetches.
 */
function monthLoadBootSources(scope: MonthLoadScope): BootSourceDescriptor[] {
  return [
    { key: "population_manifest", labelEn: "month.manifest.json", labelAr: "بيانات الشهر" },
    { key: "population_summary", labelEn: "processing.summary.json", labelAr: "ملخص المعالجة" },
    { key: "population_sample", labelEn: "sample.master.json", labelAr: "العينة" },
    { key: "population_distribution", labelEn: "distribution.current.json", labelAr: "التوزيع" },
    ...(scope.population
      ? [{ key: "population_final", labelEn: "population.final.json", labelAr: "بيانات المجتمع المعالجة" }]
      : []),
    ...(scope.raw
      ? [{ key: "population_raw", labelEn: "risk.raw.json / bi.raw.json", labelAr: "البيانات الخام" }]
      : []),
  ];
}

/**
 * Owns the "which month is loaded, and is a load in flight" concern for the
 * Population wizard (extracted out of PopulationTab itself -- Large-Population
 * Performance Proposal, Phase A step 3a -- purely to stay under this repo's
 * `max-lines-per-function`/`check:complexity` budget; PopulationTab was at
 * 1442/1450 lines before this extraction, with the sub-tab/capability-based
 * scoping (step 3c) and the lazy population top-up (step 3d) both still to add).
 *
 * State that OTHER wizard phases also read/write (populationProcessingResult,
 * sampleDrawResult, distributionCurrent, currentPhase, uploads, ...) stays
 * declared in PopulationTab itself and is threaded in here only as the two
 * callbacks below -- moving that shared state into this hook would make it a
 * de facto second home for wizard state rather than a genuine "month load"
 * extraction, for no reduction in coupling.
 *
 * This is a byte-for-byte behavioral move of the pre-existing auto-load effect,
 * `handleLoadExistingMonth`, the token/folder race guards, and the
 * `hasUnsavedSessionWorkRef`-based month-change guard registration -- see
 * `populationLoadRace.test.tsx` (I-2) for the regression coverage this must
 * keep passing unmodified. The only NEW behavior is `computeScope`, which lets
 * the caller decide what `loadMonthForEditing` actually fetches (Phase A step 3c).
 */
export function useMonthLoad(params: {
  directoryHandle: DirectoryHandleLike | null;
  globalMonth: GlobalMonthSelection;
  registerMonthChangeGuard: (guard: MonthChangeGuard) => () => void;
  /** Evaluated fresh at the moment a NEW month's load actually starts. */
  computeScope: () => MonthLoadScope;
  applyLoadedState: (loaded: LoadedMonthState) => void;
  /** Resets every OTHER wizard state field PopulationTab owns (uploads, phase, messages, ...). */
  resetWizardState: () => void;
  onLoadError: (message: string) => void;
}) {
  const { directoryHandle, globalMonth, registerMonthChangeGuard, computeScope, applyLoadedState, resetWizardState, onLoadError } = params;

  const [isLoadingMonthData, setIsLoadingMonthData] = useState(false);

  // Unsaved in-session work (parsed uploads not yet auto-saved) -- switching the
  // global month would discard it, so the provider asks for confirmation first.
  const hasUnsavedSessionWorkRef = useRef(false);
  useEffect(
    () =>
      registerMonthChangeGuard(() =>
        hasUnsavedSessionWorkRef.current ? getLabels().gm_month_switch_confirm : null
      ),
    [registerMonthChangeGuard]
  );

  const loadMonthTokenRef = useRef(0);
  const loadedRef = useRef<{ folderName: string; directoryHandle: DirectoryHandleLike } | null>(null);

  /** Clean Phase-1 state targeting the (pending) global month. */
  function resetForNewMonth(): void {
    hasUnsavedSessionWorkRef.current = false;
    // Clear unconditionally: a stale existing-month load may still be
    // in-flight (its token already invalidated by the caller), in which case
    // its own `finally` will skip clearing this flag once it resolves — so a
    // clean new-month state must clear it here itself, or the wizard would be
    // stuck permanently "loading" (CRITICAL — I-2 follow-up regression).
    setIsLoadingMonthData(false);
    resetWizardState();
  }

  async function handleLoadExistingMonth(
    info: { month: number; year: number; folderName: string },
    token: number
  ): Promise<void> {
    if (!directoryHandle) return;
    setIsLoadingMonthData(true);
    let bootSources: BootSourceDescriptor[] = [];
    try {
      hasUnsavedSessionWorkRef.current = false;
      const scope = computeScope();
      bootSources = monthLoadBootSources(scope);
      registerBootSources(bootSources);
      bootSources.forEach((source) => markBootSourceLoading(source.key));
      const data = await loadMonthForEditing(directoryHandle, info.folderName, scope);
      bootSources.forEach((source) => markBootSourceLoaded(source.key));
      if (token !== loadMonthTokenRef.current) return; // superseded by a newer month selection
      applyLoadedState(buildLoadedMonthState(data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bootSources.forEach((source) => markBootSourceError(source.key, message));
      throw error;
    } finally {
      if (token === loadMonthTokenRef.current) setIsLoadingMonthData(false);
    }
  }

  // The global month IS the wizard's month: selecting an existing month loads it
  // from disk; selecting a pending (new) month resets to a clean import flow.
  useEffect(() => {
    if (!directoryHandle || globalMonth.kind === "none") return;
    if (
      loadedRef.current !== null &&
      loadedRef.current.folderName === globalMonth.folderName &&
      loadedRef.current.directoryHandle === directoryHandle
    ) {
      return;
    }
    loadedRef.current = { folderName: globalMonth.folderName, directoryHandle };
    if (globalMonth.kind === "existing") {
      const targetFolder = globalMonth.folderName;
      const targetDirectoryHandle = directoryHandle;
      const token = ++loadMonthTokenRef.current;
      void handleLoadExistingMonth({
        month: globalMonth.month,
        year: globalMonth.year,
        folderName: globalMonth.folderName,
      }, token).catch((error) => {
        // Guarded on the token so a STALE (superseded) rejection can never
        // wipe a newer load's already-committed, successful data.
        if (token !== loadMonthTokenRef.current) return;
        // A rejected load leaves the previous month's data under this month's
        // header. Reset to a clean empty state, surface the failure, and clear
        // the stamp so re-selecting the same month/workspace retries the load.
        logError("population:auto-load-month", error);
        resetForNewMonth();
        onLoadError("تعذر تحميل بيانات الشهر — أعد المحاولة");
        if (
          loadedRef.current !== null &&
          loadedRef.current.folderName === targetFolder &&
          loadedRef.current.directoryHandle === targetDirectoryHandle
        ) {
          loadedRef.current = null;
        }
      });
    } else {
      // Invalidate any in-flight existing-month load so it can never resolve
      // later and commit its stale data over this clean new-month reset.
      ++loadMonthTokenRef.current;
      resetForNewMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth/resetForNewMonth are stable per render cycle; keying on folderName+directoryHandle prevents load loops
  }, [directoryHandle, globalMonth]);

  return { isLoadingMonthData, hasUnsavedSessionWorkRef };
}
