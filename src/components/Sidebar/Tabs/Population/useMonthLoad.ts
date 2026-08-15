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
import {
  subscribeToDataChange,
  type DataRefreshFamily,
} from "../../../../data/workspace/dataRefreshSignal";
import { buildLoadedMonthState } from "./populationWorkflowHelpers";

export type LoadedMonthState = ReturnType<typeof buildLoadedMonthState>;

type BootSourceDescriptor = { key: string; labelEn: string; labelAr: string };

/**
 * The families whose change actually invalidates what `loadMonthForEditing`
 * reads. Module-level (not rebuilt per render) so the subscription below is
 * never torn down and re-established just because the array identity moved.
 */
const MONTH_LOAD_REFRESH_FAMILIES: readonly DataRefreshFamily[] = ["manifest", "distribution"];

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
  /**
   * Optional escape hatch for the periodic/manual background-refresh subscriber
   * below (Sync extension task): read `.current` at tick time, true while some
   * OTHER wizard-owned mutation (processing, drawing/saving a sample,
   * distributing) is writing its own not-yet-persisted result into state
   * `applyLoadedState` would also overwrite (populationProcessingResult,
   * sampleDrawResult, distributionCurrent) -- e.g. Phase 3's draw-sample flow
   * sets sampleDrawResult locally before its disk save resolves. A plain ref
   * (reassigned every PopulationTab render, same idiom as `wizardFolderRef`
   * there) rather than a callback, so the subscriber below never needs it in
   * an effect dependency array and can't read a stale closed-over value.
   * Omitted entirely by callers with no such concept (e.g. this hook's own
   * unit tests) -- treated as "never busy".
   */
  isWizardBusyRef?: { current: boolean };
}) {
  const { directoryHandle, globalMonth, registerMonthChangeGuard, computeScope, applyLoadedState, resetWizardState, onLoadError, isWizardBusyRef } = params;

  const [isLoadingMonthData, setIsLoadingMonthData] = useState(false);
  // Mirrors `isLoadingMonthData` exactly, updated synchronously at each of that
  // state's three call sites. The background-refresh subscriber below reads
  // THIS, never the state: reading the state would have forced that effect to
  // list `isLoadingMonthData` as a dependency purely to avoid a stale closure,
  // which tore down and re-subscribed the listener on every load transition --
  // and left a real (if sub-millisecond) window, between the state commit and
  // the re-subscribe actually running, in which an external broadcast would
  // still observe the OLD closured value. A ref has no such window and removes
  // the churn that created it.
  const loadInFlightRef = useRef(false);

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
    loadInFlightRef.current = false;
    setIsLoadingMonthData(false);
    resetWizardState();
  }

  async function handleLoadExistingMonth(
    info: { month: number; year: number; folderName: string },
    token: number,
    opts?: { silent?: boolean }
  ): Promise<void> {
    if (!directoryHandle) return;
    // `silent` is set only by the periodic/manual background data-refresh
    // signal subscriber below, never by a real month/user switch. Flipping
    // isLoadingMonthData true withdraws every mutating capability
    // (canDrawSample/canDistributeSamples/canBulkAssign/canUploadNow/...) and
    // shows the "جاري تحميل بيانات الشهر" banner across every phase (index.tsx)
    // -- a silent background refresh must re-read and swap the underlying
    // data in place without any of that, mirroring XrayReferrals.tsx/
    // XrayInspectionResults.tsx's identical `{ silent: true }` handling.
    const silent = opts?.silent ?? false;
    if (!silent) {
      loadInFlightRef.current = true;
      setIsLoadingMonthData(true);
    }
    let bootSources: BootSourceDescriptor[] = [];
    try {
      if (!silent) hasUnsavedSessionWorkRef.current = false;
      const scope = computeScope();
      // Boot-progress reporting is for the post-login checklist only -- a
      // background tick minutes into a session re-registering these same
      // keys would needlessly flip them back through pending/loading for a
      // screen that's long since been dismissed.
      if (!silent) {
        bootSources = monthLoadBootSources(scope);
        registerBootSources(bootSources);
        bootSources.forEach((source) => markBootSourceLoading(source.key));
      }
      const data = await loadMonthForEditing(directoryHandle, info.folderName, scope);
      // Staleness check FIRST: a superseded load must not touch the shared
      // boot-progress store at all. Marking its keys "loaded" would show the
      // checklist ticking off sources the newer, still-pending load is about to
      // re-read from scratch.
      if (token !== loadMonthTokenRef.current) return; // superseded by a newer month selection
      if (!silent) bootSources.forEach((source) => markBootSourceLoaded(source.key));
      const loaded = buildLoadedMonthState(data);
      // A silent refresh must not snap the wizard back to whatever phase the
      // on-disk manifest currently records -- the user may already have
      // manually navigated further (e.g. onto Phase 3 to draw a sample not
      // yet saved). Only the underlying population/sample/distribution data
      // is refreshed in place; phase/step navigation is left exactly as-is.
      applyLoadedState(silent ? { ...loaded, phase: null } : loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A silent background refresh must not force-reset the wizard
      // (uploads, in-progress phase, messages) on a transient read hiccup --
      // log it for observability and leave everything exactly as it was; the
      // next successful tick (or a real navigation) will recover the data.
      if (silent) {
        logError("population:silent-reload-month", error);
        return;
      }
      // Staleness check FIRST, mirroring the success path above: a
      // superseded load's rejection must not touch the shared boot-progress
      // store either -- it would show a false failure on keys the newer,
      // still-pending load has already re-registered and is midway through
      // re-loading fresh.
      if (token === loadMonthTokenRef.current) {
        bootSources.forEach((source) => markBootSourceError(source.key, message));
      }
      throw error;
    } finally {
      if (!silent && token === loadMonthTokenRef.current) {
        loadInFlightRef.current = false;
        setIsLoadingMonthData(false);
      }
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

  // Re-fetch the CURRENTLY loaded month on the app-wide refresh signal (manual
  // toolbar button + the periodic sync tick, workspaceSync.ts) so a sample
  // redraw, distribution action, or replacement made elsewhere -- another tab,
  // another machine -- shows up without navigating away and back.
  //
  // Subscribed to the per-family CHANGE SET (§4.2), not to the bare signal.
  // `loadMonthForEditing` reads month.manifest.json, processing.summary.json,
  // sample.master.json and the derived distribution -- and, for an oversight
  // user on the `process` sub-tab, population.final.json / the raw workbooks on
  // top (`computeMonthLoadScope`). None of that is touched by a notification
  // being posted, an employee answering an item, or a referral request landing
  // in someone's answers file, yet the legacy bare subscription re-ran the
  // whole load on every one of those ticks -- including the distribution
  // derivation, which is the expensive part even when `population` is out of
  // scope. `manual` still reaches this callback unconditionally
  // (subscribeToDataChange's contract), so the discard-everything button is
  // unchanged.
  //
  // KNOWN GAP, pre-existing and not introduced here: no probe family covers
  // `sample.master.json`, so another user's RE-draw of an already-drawn month
  // is not itself a broadcast trigger. Before this change such a redraw was
  // picked up only incidentally -- when some unrelated family happened to
  // change in the same tick. Closing it properly means adding a `sample`
  // family probe in workspaceSync.ts (one extra small read per tick), which is
  // a deliberate budget decision, not something to smuggle in here.
  useEffect(
    () =>
      subscribeToDataChange(MONTH_LOAD_REFRESH_FAMILIES, () => {
        if (!directoryHandle || globalMonth.kind !== "existing") return;
        // A real (foreground) load is already in flight for this exact
        // target -- bumping loadMonthTokenRef here too would make this tick
        // "win" the latest-wins race and make that load's own result get
        // silently discarded once it resolves. Skip; the next tick will
        // catch up once it's done.
        //
        // Known, accepted tradeoff: that "next tick" only exists for the
        // automatic 45s timer. A user's MANUAL refresh-button press that
        // lands during an in-flight load is dropped outright, with no retry --
        // they get the in-flight load's own (near-identical, moments-old)
        // result and have to press again for anything newer. Deliberate: the
        // alternative (queueing the tick) reintroduces the token race this
        // guard exists to prevent, for a case that already resolves itself.
        if (loadInFlightRef.current) return;
        // Unsaved in-session work (parsed uploads not yet auto-saved) has
        // already diverged from disk -- overwriting it here with no
        // confirmation would silently discard it.
        if (hasUnsavedSessionWorkRef.current) return;
        // Some other wizard-owned mutation is writing its own not-yet-
        // persisted result into a field this refresh would also overwrite.
        if (isWizardBusyRef?.current) return;
        if (
          loadedRef.current === null ||
          loadedRef.current.folderName !== globalMonth.folderName ||
          loadedRef.current.directoryHandle !== directoryHandle
        ) {
          return; // nothing successfully loaded yet for this target
        }
        const token = ++loadMonthTokenRef.current;
        void handleLoadExistingMonth(
          { month: globalMonth.month, year: globalMonth.year, folderName: globalMonth.folderName },
          token,
          { silent: true }
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleLoadExistingMonth is stable per render cycle (same rationale as the effect above); isWizardBusyRef/loadInFlightRef are ref objects, deliberately excluded so their .current is always read fresh rather than closed over
    [directoryHandle, globalMonth]
  );

  return { isLoadingMonthData, hasUnsavedSessionWorkRef };
}
