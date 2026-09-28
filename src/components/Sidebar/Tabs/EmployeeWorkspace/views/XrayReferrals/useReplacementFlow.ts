import { useState } from "react";
import { logError } from "../../../../../../data/storage/errorLogger";
import { userFacingErrorText } from "../../../../../../data/storage/writeErrorText";
import { MonthClosedError } from "../../../../../../data/population/monthLock";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import {
  loadOrDeriveDistributionCurrent,
  loadOrDeriveDistributionCurrentStrictForRead,
} from "../../../../../../data/distribution/distributionStorage";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import {
  classifyReplacementRowAvailability,
  executeReplacement,
} from "../../../../../../data/distribution/replacement";
import { recordAction } from "../../../../../../data/audit/actionLog";
import { getReplacementCandidatesIndexed } from "../../../../../../data/distribution/replacementCandidateLookup";
import {
  findPopulationRowById,
  type PopulationRowLookupResult,
} from "../../../../../../data/population/populationRowLookup";
import { PopulationUnreadableError } from "../../../../../../data/population/populationStorage";
import type { ReplacementIndexRow } from "../../../../../../data/population/replacementIndexTypes";
import type { StageAliasMappings } from "../../../../../../data/population/populationConfig";
import type { PreparedPopulationRow } from "../../../../../../data/population/populationTypes";
import { loadSampleMaster } from "../../../../../../data/sampling/sampleStorage";
import type { SampleMasterData } from "../../../../../../data/sampling/sampleTypes";
import { isAdhocEntry } from "../../../../../../data/adhocImport/adhocImportEmployeeView";
import { appendReplacementRequest } from "../../../../../../data/referral/referralStorage";
import type { ReplacementRequest } from "../../../../../../data/referral/referralTypes";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import type { ReplacementDialogState, StatusMsg } from "../XrayReferrals";

/**
 * T-08 -- a lookup MISS is staleness; a failed READ is not.
 *
 * `findPopulationRowById` answers `absent` only when the month genuinely has no
 * `population.final.json`. `unreadable`/`worker` mean the row may well be there
 * and this call could not see it, so telling the user "البيانات تغيّرت" would
 * report a data change that never happened -- and send them looking for a row
 * that is fine.
 */
export function isPopulationReadFailure(lookup: PopulationRowLookupResult): boolean {
  return !lookup.ok && lookup.reason !== "absent";
}

export type ReplacementFlowInput = {
  directoryHandle: DirectoryHandleLike;
  username: string;
  role: string;
  selMonth: string;
  canRequestReplacement: boolean;
  sampleMaster: SampleMasterData | null;
  allEntries: DistributionEntry[];
  pendingReplacementIds: Set<string>;
  stageMappings: StageAliasMappings | undefined;
  setSampleMaster: (sample: SampleMasterData | null) => void;
  setAllEntries: (entries: DistributionEntry[]) => void;
  setStatusMsg: (msg: StatusMsg) => void;
  folderForRow: (xrayImageId: string) => string;
  loadData: (opts?: { silent?: boolean }) => Promise<void>;
  selectEntry: (xrayImageId: string | null) => void;
};

/**
 * The replacement dialog's state and its two handlers (open + confirm),
 * moved verbatim out of `XrayReferrals` to keep that component inside the
 * `max-lines-per-function` budget. Behaviour is unchanged: the same three
 * `useState`s, the same functions, now closing over an explicit input object.
 */
export function useReplacementFlow(input: ReplacementFlowInput) {
  const {
    directoryHandle, username, role, selMonth, canRequestReplacement,
    sampleMaster, allEntries, pendingReplacementIds, stageMappings,
    setSampleMaster, setAllEntries, setStatusMsg, folderForRow, loadData, selectEntry,
  } = input;
  const [replacementDialog, setReplacementDialog] = useState<ReplacementDialogState>(null);
  const [replacementError, setReplacementError] = useState<string | null>(null);
  const [replacementBusy, setReplacementBusy] = useState(false);

  /**
   * The sample master + every-employee entry set the replacement dialog needs.
   * Returns what `loadData` already put in state when the full read ran, and
   * pays for it on demand when the mirror fast path skipped it (a null
   * `sampleMaster` is precisely that signal — the fast path clears it, and the
   * full path only leaves it null when the month genuinely has no sample, in
   * which case this correctly returns null and the caller bails as before).
   */
  async function ensureReplacementContext(): Promise<
    { sample: SampleMasterData; entries: DistributionEntry[] } | null
  > {
    if (sampleMaster) return { sample: sampleMaster, entries: allEntries };
    if (!selMonth) return null;
    try {
      const sample = await loadSampleMaster(directoryHandle, selMonth);
      if (!sample) return null;
      // STRICT: this exclusion set must be EVERY employee's rows, so a failed read must not fold to `[]` and offer a row someone owns.
      const dist = await loadOrDeriveDistributionCurrentStrictForRead(directoryHandle, selMonth, (sample.rows ?? []) as PreparedPopulationRow[]);
      setSampleMaster(sample);
      // Ad-hoc entries live outside this month's derivation, so carry the ones
      // already loaded rather than dropping them from the exclusion set.
      const merged = [...(dist?.entries ?? []), ...allEntries.filter(isAdhocEntry)];
      // BOTH halves must be committed, not just the sample. The short-circuit at
      // the top of this function pairs a cached `sampleMaster` with component
      // state `allEntries`; committing only the sample meant every subsequent
      // open re-paired the fresh sample with the mirror-only entry list, so the
      // exclusion set silently lost every other employee's rows and the dialog
      // offered rows they already owned.
      setAllEntries(merged);
      return { sample, entries: merged };
    } catch (error) {
      logError("xrayReferrals:ensureReplacementContext", error);
      return null;
    }
  }

  async function openReplacementDialog(entry: DistributionEntry): Promise<void> {
    if (!canRequestReplacement) { setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب الاستبدال، أو أن مساحة العمل للقراءة فقط." }); return; }
    // pendingReplacementIds, not entry.status — see canOpenReplacementDialog's doc comment.
    if (pendingReplacementIds.has(entry.xrayImageId)) { setStatusMsg({ type: "error", text: "يوجد طلب استبدال قيد الموافقة لهذه العينة بالفعل." }); return; }
    if (!selMonth) return;
    // Design B step 3: on the mirror fast path `loadData` reads neither
    // `sample.master.json` nor the workspace-wide derivation, so both are
    // resolved HERE, on demand. They are genuinely needed and cannot be
    // approximated from the mirror: `sampleMaster` is the drawn-row set the
    // candidate pool is filtered against, and `allEntries` must be EVERY
    // employee's entries — an exclusion set built from this employee's mirror
    // alone would offer rows another employee already owns.
    const context = await ensureReplacementContext();
    if (!context) return;
    // Reads only the matching replacement-index bucket when one exists for
    // this month, instead of the full population.final.json — falls back to
    // a full read (and rebuilds the index in the background) for months
    // processed before this index existed.
    let candidates: Awaited<ReturnType<typeof getReplacementCandidatesIndexed>>;
    try {
      candidates = await getReplacementCandidatesIndexed(
        directoryHandle, selMonth, entry, context.sample, context.entries, stageMappings, username
      );
    } catch (error) {
      logError("xrayReferrals:getReplacementCandidatesIndexed", error);
      // T-08: an empty pool would assert "no eligible replacement exists" — a
      // claim about the data that an unreadable population cannot support.
      if (error instanceof PopulationUnreadableError) {
        setStatusMsg({ type: "error", text: getLabels().msg_population_unreadable });
        return;
      }
      candidates = { recommended: [], all: [] }; // dialog will show empty candidates gracefully
    }
    setReplacementError(null);
    setReplacementDialog({
      entry,
      ...candidates,
      // Generated once per dialog open, not per confirm click — see the type's
      // own doc comment (B-XQIO032 peer finding: this used to be regenerated
      // inline on every `handleReplace` call, so a retry after a failed write
      // could never be recognized as a replay by appendReplacementToEmployee's
      // requestId dedup, and risked writing a duplicate request).
      requestId: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    });
  }

  async function handleReplace(
    entry: DistributionEntry,
    replacement: ReplacementIndexRow,
    reason: string,
    fromRecommended: boolean,
    /** `replacementDialog.requestId` — see that type's own doc comment. Passed
     *  explicitly rather than read from the closure, matching how `entry`
     *  itself already arrives as a param instead of via `replacementDialog.entry`. */
    requestId: string
  ): Promise<void> {
    if (!canRequestReplacement) {
      setStatusMsg({ type: "error", text: "لا تملك صلاحية طلب الاستبدال، أو أن مساحة العمل للقراءة فقط." });
      return;
    }
    if (!selMonth || replacementBusy) return;

    setReplacementBusy(true);
    setReplacementError(null);

    try {
      if (fromRecommended) {
        // Freshness re-check (mirror approveReferral): the rendered candidate
        // list can be seconds stale on a shared folder. Reload the live state
        // and confirm (a) the dead row is still owned by the same employee and
        // still replacement-eligible, and (b) the chosen replacement is not
        // already sampled or owned — otherwise a concurrent action already used
        // one side and committing would double-assign / orphan.
        const rowFolder = folderForRow(entry.xrayImageId);
        const freshSample = await loadSampleMaster(directoryHandle, rowFolder);
        const freshRows = (freshSample?.rows ?? []) as PreparedPopulationRow[];
        const freshDist = await loadOrDeriveDistributionCurrent(directoryHandle, rowFolder, freshRows);
        const STALE_MSG = "البيانات تغيّرت، حدّث الصفحة";

        const freshDead = freshDist?.entries.find((e) => e.xrayImageId === entry.xrayImageId);
        const deadStillEligible =
          !!freshDead &&
          freshDead.assignedTo === entry.assignedTo &&
          (freshDead.status === "pending" || freshDead.status === "replacement-requested");

        // "resume-partial" (an earlier attempt appended the sample row for this
        // very substitution and then failed to write the events — XQ-DIST-005)
        // must pass: retrying with the same candidate is the designed recovery,
        // and the dialog stays open with the same candidate for exactly that.
        const replacementTaken =
          classifyReplacementRowAvailability({
            replacementXrayImageId: replacement.xrayImageId,
            deadXrayImageId: entry.xrayImageId,
            sample: { rows: freshRows, replacedRowIds: freshSample?.replacedRowIds },
            entries: freshDist?.entries,
          }) === "taken";

        if (!deadStillEligible || replacementTaken) {
          setReplacementError(STALE_MSG);
          setStatusMsg({ type: "error", text: STALE_MSG });
          await loadData({ silent: true });
          return;
        }

        // The candidate list only ever carries the slim replacement-index
        // projection (see replacementIndexTypes.ts) — the sample master needs
        // the FULL population row, so resolve it here by id. This is the one
        // full-population read on the immediate-replace path, and it's paid
        // for exactly one row (the chosen candidate), never the whole pool.
        //
        // The read still happens; the PARSE of it does not happen here (1.12).
        // Parsing a large month on the main thread is the freeze users report on
        // this exact click, so the file text goes to the query worker instead and
        // only the one matching row comes back. A miss and a failure are both
        // treated as "stale", exactly as the previous inline `.find()` was.
        const lookup = await findPopulationRowById(directoryHandle, selMonth, replacement.xrayImageId);
        if (isPopulationReadFailure(lookup)) {
          const text = getLabels().msg_population_unreadable;
          setReplacementError(text);
          setStatusMsg({ type: "error", text });
          return;
        }
        const fullReplacementRow = lookup.ok ? lookup.row ?? undefined : undefined;
        if (!fullReplacementRow) {
          setReplacementError(STALE_MSG);
          setStatusMsg({ type: "error", text: STALE_MSG });
          await loadData({ silent: true });
          return;
        }

        // Immediate replacement — no approval needed.
        const result = await executeReplacement({
          directoryHandle,
          // The same store the freshness re-check above read from. Routed on
          // `selMonth` this appended a `replaced` event for an ADHOC-* id into a
          // real month's immutable log (which its fold can never interpret),
          // appended a real population row to an already-drawn sample master,
          // and left the ad-hoc row live — the employee owned both.
          monthFolderName: rowFolder,
          deadEntry: entry,
          replacementRow: fullReplacementRow,
          reason,
          eventBy: username,
          stageMappings,
        });
        if (!result.ok) {
          setReplacementError(userFacingErrorText(result.error, "xrayReferrals:replace"));
          setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
          return;
        }
        if (result.ok) setSampleMaster(result.updatedSample);
        recordAction(directoryHandle, username, role, "replacement-applied", { monthFolderName: rowFolder, target: entry.xrayImageId, details: { replacement: replacement.xrayImageId, employee: entry.assignedTo, reason } });
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم استبدال العينة وإسناد البديل." });
        // Silent: this refresh follows a successful action already reflected in
        // local state (setSampleMaster/setReplacementDialog above) — it must
        // update the underlying rows in place, not flash the loading state or
        // force-close the panel the way the periodic/manual refresh signal would
        // if it weren't passed { silent: true } either (see loadData's own
        // docblock further up).
        await loadData({ silent: true });
        // Deliberate navigation to the replacement row — the old row's panel is
        // being closed on purpose, so any draft protection for it is dropped too.
        selectEntry(replacement.xrayImageId);
      } else {
        // Non-recommended — requires supervisor approval.
        // Store only the id (not the full row) to avoid stale copies.
        const request: ReplacementRequest = {
          // Stable across retries of this same confirm click (the dialog's own
          // requestId, generated once when it opened) — never regenerated here,
          // so a retry after a failed write is recognized as a replay by
          // appendReplacementToEmployee's requestId dedup instead of writing a
          // second request. See ReplacementDialogState's own doc comment.
          requestId,
          // Must match the folder the request is appended to (below): every
          // distribution read/write approveReplacement performs is keyed off
          // this field, so a record stored in the ad-hoc store while naming the
          // selected month would apply the replacement to the wrong population.
          monthFolderName: folderForRow(entry.xrayImageId),
          employeeUsername: entry.assignedTo,
          originalXrayImageId: entry.xrayImageId,
          replacementXrayImageId: replacement.xrayImageId,
          reason,
          requestedAt: new Date().toISOString(),
          requestedBy: username,
          status: "pending",
        };
        const result = await appendReplacementRequest(directoryHandle, folderForRow(entry.xrayImageId), request);
        if (!result.ok) {
          setReplacementError(userFacingErrorText(result.error, "xrayReferrals:replace"));
          setStatusMsg({ type: "error", text: userFacingErrorText(result.error, "xrayReferrals:result") });
          return;
        }
        recordAction(directoryHandle, username, role, "replacement-requested", { monthFolderName: request.monthFolderName, target: request.requestId, details: { original: entry.xrayImageId, replacement: replacement.xrayImageId, employee: entry.assignedTo } });
        setReplacementDialog(null);
        setStatusMsg({ type: "ok", text: "تم إرسال طلب الاستبدال — بانتظار موافقة المشرف." });
        // Silent for the same reason as the recommended-replacement branch above —
        // this is a background refresh after an already-successful write, not a
        // month/user change, so it must not flash the loading state or force-close
        // the currently open inspection panel.
        await loadData({ silent: true });
      }
    } catch (error) {
      // This block used to be `try { … } finally { … }` with no catch at all.
      // executeReplacement can throw rather than return `{ ok: false }` — its
      // month-lock gate and its directory resolution both run outside
      // appendDistributionEvents' inner try (distributionStorage.ts) — and so
      // can loadSampleMaster / loadMonthPopulationFinal above. Every one of
      // those became an unhandled promise rejection that left the user staring
      // at a dialog with no message and no idea whether the replacement had
      // been applied. Surface it in Arabic and keep the raw detail in the
      // admin error log.
      let text: string;
      if (error instanceof MonthClosedError) {
        text = getLabels().msg_month_closed_write_blocked;
      } else {
        logError("xrayReferrals:handleReplace", error);
        text = getLabels().msg_unexpected_write_error;
      }
      setReplacementError(text);
      setStatusMsg({ type: "error", text });
    } finally {
      setReplacementBusy(false);
    }
  }

  return {
    replacementDialog, setReplacementDialog,
    replacementError, setReplacementError,
    replacementBusy,
    openReplacementDialog, handleReplace,
  };
}
