# XQ-IO-032 Production Incident — Multi-Model Findings

**Incident date:** 2026-08-25 · **Repo:** `x-ray-quality-app-v1` · **Analysis date:** 2026-08-25
**Analysts:** 5 models (3× Opus, 1× Sonnet, 1× Haiku) analysed independently; **Fable** then revised all five at max effort and designed the fix.
Four verdicts reached the synthesiser. Haiku's was rejected by schema validation and **recovered from its agent transcript** — see §2.5.
**Verification:** every top claim below was re-checked against the working tree and against `git show HEAD:` by the synthesizing agent. Claims that failed verification are marked **[disputed by verification]** and left in place inside the model's own section.

---

## 1. Executive summary

### What broke

Between 05:36 and 08:52 on 2026-08-25, four users on the shared SMB/UNC workspace (`file:///Y:/`, `file:///Z:/`) hit repeated write failures reported to them as error code **XQ-IO-032** — «تعذّر حفظ التغيير بعد عدة محاولات…».

Two distinct user-visible symptoms:

| User | Page | Failing operation | Window | Impact |
|---|---|---|---|---|
| `jalgahamdi` | employee-workspace | `answerStorage:answer-save` | 05:36:35 → 07:04:53 (~88 min, 11 rounds) | Inspection answers never reached disk |
| `saalhijji` | employee-workspace | `answerStorage:answer-save`, then `feedback:repairThreadsIndex` | 08:44 → 08:51 (7 answer rounds + 1 feedback) | Same, plus feedback-index repair |
| `amonem` | **reports/kpi** | `feedback:repairThreadsIndex` | 08:51:51, 08:52:11 | Cosmetic (background poll) |
| `admin` | employee-workspace | `casLoop:exhausted` only, **no paired action entry** | — | Unidentifiable caller |

### Consensus root cause

All four models independently converged on the same mechanism, and it verifies:

> Chromium's DOMException **`InvalidStateError`** — *"An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk."* — is raised when a `File` or writable-stream's cached `(size, mtime)` snapshot no longer matches disk at the moment the bytes are touched. On a Windows SMB share this is routine (the redirector's `FileInfoCacheLifetime` is ~10 s by default, and `safeWriteJson` commits then reads back within milliseconds).
>
> At incident time that DOM name was classified **nowhere** in the storage layer:
> - not in `classifyFileSystemError`'s switch → `default: return null` (`src/data/storage/errorCodes.ts:645` @ HEAD) — **verified**
> - not in `isTransientWriteError` (`src/data/storage/transientFileErrors.ts:79-83` @ HEAD) — **verified**
> - not in any of the six read-retry loops in `safeWrite.ts`, all of which gate on `isNotReadableError` alone (HEAD lines 187, 260, 302, 461, 497, 1406) — **verified**
>
> So the exception was retried by **no** purpose-built ladder, received **no** error code, and fell through to `casLoop.ts:167`'s `resolveErrorCode(lastCause) ?? "XQ-IO-032"` — a code whose own catalog meaning is literally *"the exception carried no more specific code."*

The failure was therefore simultaneously **un-retried at the right granularity, unclassified, and mis-advised** — and, because `errorLogger` recorded only `.message` and `.stack` and never `.name`, structurally **invisible in the very artifact meant to reveal it**.

### Current state of the fix

An **uncommitted working-tree change** already implements the classification half:

```
 M src/data/labels/labelsStore.ts          (+ err_io_036_stale_snapshot)
 M src/data/storage/errorCodes.ts          (+ XQ-IO-036, + case "InvalidStateError")
 M src/data/storage/errorLogger.ts         (+ ErrorEntry.errorName)
 M src/data/storage/fileSystemAccess.ts
 M src/data/storage/memoryDirectory.ts     (+ "readFile" fault operation)
 M src/data/storage/safeWrite.ts           (unified readRetryDelayMs at all 6 read loops)
 M src/data/storage/transientFileErrors.ts (+ isSnapshotStaleError, SNAPSHOT_STALE_RETRY_DELAYS_MS)
?? src/data/storage/staleSnapshot.test.ts
```

**Verified merge-readiness (run by the synthesizing agent):**

- `npx tsc -b` → **exit 0, clean**
- `npx vitest run src/data/answers/ src/data/feedback/` → **85/85 passing**
- `npx vitest run src/data/storage/` → **394/395 passing, 1 failure**: `errorCodes.test.ts > matches the pinned code -> meaning map exactly` — the pinned catalog snapshot needs `XQ-IO-036` added. That is the intended tripwire for an append-only catalog, not a defect.

The fix is one snapshot update from green. **But it is not the whole incident** — see §4 (contested) and §6 (register).

---

## 2. Per-model verdicts

### 2.1 Opus (classification lens) — `opus-classification`

**Verdict.** The name is `InvalidStateError`, and it appears nowhere in this codebase. It falls through *three closed allowlists at once* — `isPermissionLostError`, `isTransientWriteError`, `classifyFileSystemError` — and lands by fallback on `casLoop.ts:167`. Consequences in order: (a) every SMB retry ladder this repo built is bypassed with **zero** attempts; (b) the only thing that retries it is casLoop's unconditional `catch`, re-running the entire eight-round-trip write 14× (answers) or 10× (feedback index) — the coarsest, most write-amplifying retry available; (c) it is reported under a code that means *unclassified* but wears a label asserting a diagnosis. The root defect is **architectural, not this one missing name**: a closed switch with a silent `default: return null` and no telemetry.

| # | Title | Kind | Sev | file:line | Conf | Verification |
|---|---|---|---|---|---|---|
| 1 | `isTransientWriteError`'s closed allowlist excludes `InvalidStateError` | root-cause | critical | `transientFileErrors.ts:81` | certain | ✅ verified at HEAD |
| 2 | `classifyFileSystemError`'s `default: return null` silently drops unrecognized names | root-cause | critical | `errorCodes.ts:645` | certain | ✅ verified at HEAD |
| 3 | XQ-IO-032's Arabic label asserts a diagnosis the code never made | design-flaw | high | `labelsStore.ts:1379` | certain | ⚠️ **partially disputed** — see below |
| 4 | Read path retries only `NotReadableError`; widening the write predicate is insufficient | latent-bug | high | `safeWrite.ts:187` | certain | ✅ verified at HEAD (though it lists 5 of 6 sites — missed line 497 `streamFileChunks`) |
| 5 | `logError` records `.message`/`.stack` but never `error.name` | observability-gap | high | `errorLogger.ts:189` | certain | ✅ verified at HEAD |
| 6 | casLoop is the only layer that retries this class, at the coarsest granularity | aggravating | medium | `casLoop.ts:135` | high | ✅ verified |
| 7 | `updateThreadsIndex` has no `onExhausted`, so the feedback half logged only translated Arabic | observability-gap | medium | `feedbackStorage.ts:246` | certain | ✅ verified — only `answerStorage.ts:246` passes `onExhausted`, out of ~25 call sites |
| 8 | Failing threads-index repair never self-heals; re-runs a 10-attempt ladder per panel open | aggravating | medium | `feedbackStorage.ts:451` | high | ✅ verified |
| 9 | 7 answer saves and 11 referral saves silently never persisted | symptom | critical | `XrayReferrals.tsx:535` | high | ✅ verified — `setAnswers`/`setDirtyEntryId(null)` are inside the `ok` branch only; the failure branch sets `setStatusMsg` and nothing else |
| 10 | casLoop's exhaustion path is correct and is **not** the defect | symptom | low | `casLoop.ts:167` | certain | ✅ verified |

**[disputed by verification] — finding #3.** The label is *hedged*, not assertive: `err_io_032_cas_write_failed` reads «**قد يكون** الملف قيد الاستخدام من جهاز آخر أو تعذّر الوصول إليه» — *"the file **may be** in use by another device or could not be reached."* The comment block immediately above it in `labelsStore.ts` records that this wording is itself a *previous* correction: the older text asserted «وليس بسبب تعارض مع مستخدم آخر» and was replaced precisely because "casLoop reaches XQ-IO-032 precisely BECAUSE it could not classify the exception, so that claim was unsupportable at the throw site." The label is honest about uncertainty. What survives of the finding is narrower and still valid: the label's *remedy* («أعد المحاولة بعد قليل») is falsified by an 88-minute retry history, and a catch-all should not offer a remedy at all. Severity **high → medium**.

**What this model says others will get wrong.**
- *"It isn't retried at all"* — wrong. `casLoop.ts:135` catches unconditionally; it **was** retried, 14× (answers) / 10× (feedback). The precise claim is that it was retried only by the outermost loop and by none of the three inner SMB ladders.
- *"Just add `InvalidStateError` to `isTransientWriteError` and it's fixed"* — necessary but not sufficient; leaves the read-path sites and the classification untouched.
- *"The retry will now clear it"* — the logs argue otherwise. 11 rounds / ~154 exhausted attempts, and `saalhijji`'s failures cross **two different workspace roots**. This model proposes at **medium** confidence a sticky, session-scoped condition (the long-lived `WorkspaceProvider` root handle going stale after an SMB session re-establishment), and explicitly flags that it cannot prove the Windows-side trigger from this repo.
- *"It's cross-machine file-lock contention"* — no; that is `NoModificationAllowedError` / XQ-IO-035, a different name with its own predicate.
- *"The workspace grant was lost"* — disproved by `casLoop.ts:52-56`: `NotAllowedError`/`SecurityError` abort at attempt 1 with a different message.
- *"Bump `maxRetries`"* — falsified by the logs and actively harmful.
- *"Answers were corrupted"* — no; `createWritable()` with no `keepExistingData` stages into a `.crswap` sibling, and `snapshotToBak` is skipped when the current file fails `parseValidJson`. A clean failure, not a corrupt one.
- *"Repurpose XQ-IO-032"* — forbidden; the catalog is append-only and `errorCodes.test.ts` pins the meanings. (Verified: that pin is the single failing test today.)
- **Self-caveat:** rates the DOM-name identification at *high*, not certain, because it could not grep Chromium's source.

---

### 2.2 Opus (answer-save lens) — `opus-answer-save`

**Verdict.** The share did not fail, and this is not a write conflict. Same `InvalidStateError` classification gap — but the reason the failure was **total** rather than occasional is *amplification on the answer-save path*: one `upsertItemAnswer` attempt performs ~9 whole-file passes over the monolithic per-user `{username}.answers.json` (5 full reads of the live file, 1 of the `.tmp`, 3 whole-file writes), and `ANSWER_SAVE_MAX_RETRIES = 14` repeats all of it — ~126 whole-file SMB passes per failed save, any single one of which aborts the whole attempt with no partial progress.

**Decisive counter-evidence this model contributes:** `jalgahamdi`'s own error log is `revision: 11` with 22 entries — i.e. **11 successful CAS writes** to `5-system/system-errors/` through the *identical* `safeWriteJson` + `casLoop` + read-back stack, each landing within ~5 s of an answer-save that had just failed 14 times. **The share was writable throughout.**

| # | Title | Kind | Sev | file:line | Conf | Verification |
|---|---|---|---|---|---|---|
| 1 | `InvalidStateError` is not a transient write error → no safeWrite-layer retry | root-cause | critical | `transientFileErrors.ts:79` | certain | ✅ verified |
| 2 | `classifyFileSystemError` has no case → user given actively wrong advice | root-cause | high | `errorCodes.ts:625` | certain | ✅ verified |
| 3 | **`readContent` consumes ONE `File` snapshot twice with awaits between** | design-flaw | high | `safeWrite.ts:228` | certain | ✅ **verified, novel** — `openFile` → `file.slice(0,HEAD).arrayBuffer()` → `classifyHeadWindow` → later `await file.text()`, all against one snapshot |
| 4 | Post-commit verification read snapshots in the window the repo already knows is unreliable | root-cause | high | `safeWrite.ts:1814` | high | ✅ verified (`retryMissing: true` exists for exactly this lag, but covers only NotFound) |
| 5 | One answer save = 9 whole-file passes; 14 retries ≈ 126, no partial progress | aggravating | high | `answerStorage.ts:202` | certain | ✅ verified in shape — 3 full `loadEmployeeAnswers` per attempt (base, verify, delayed re-verify) plus `safeWriteJson`'s own read-current/`.bak`/`.tmp`/read-backs. The exact "9" is a reasonable count, not independently re-derived here |
| 6 | **casLoop treats a THROW from the delayed `verify` as a lost update** | design-flaw | high | `casLoop.ts:131` | certain | ✅ **verified, novel** — `const stillMine = await r.verify()` sits inside the try; `answerStorage`'s verify calls `loadEmployeeAnswers`, which throws by design on an inconclusive read. A throw becomes `lastCause` and discards a write that already read back clean |
| 7 | Durable log records `.message` but never `error.name` | observability-gap | high | `errorLogger.ts:189` | certain | ✅ verified — and **still open**: the working-tree fix adds `errorName` to the in-memory ring only; `errorLogSink.toPersisted`, `PersistedErrorEntry` and `ERROR_EXPORT_HEADERS` are all untouched |
| 8 | A persisted entry names no sample, month or file — blast radius unmeasurable | observability-gap | medium | `errorLogTypes.ts:12` | certain | ✅ verified |
| 9 | Answers file read whole twice, microseconds apart, at the start of every attempt | aggravating | medium | `safeWrite.ts:1638` | certain | ✅ verified in shape |
| 10 | Typed answers survive only in React state; no `beforeunload`, 3-tab mount LRU | design-flaw | high | `InspectionPanel/index.tsx:88` | high | ✅ verified — zero `beforeunload` handlers anywhere in `src/`; `tabMountLru.ts:12` `limit = 3` |
| 11 | The 14×150 ms ladder cannot outlast the condition, and pays 126 passes to find out | aggravating | medium | `answerStorage.ts:41` | high | ✅ constants verified |
| 12 | `readEnvelopeMetadataTolerant` still guards on NotReadable alone | latent-bug | low | `safeWrite.ts:1406` | certain | ❌ **[disputed by verification]** — see below |

**[disputed by verification] — finding #12.** True at HEAD (line 1406 gates on `isNotReadableError`), but **false in the working tree**. `readEnvelopeMetadataTolerant` now begins at line 1447 and its retry at line **1456** goes through the unified `readRetryDelayMs(error, retries)`, exactly like the other five loops. Its doc comment was even extended to name XQ-IO-036 explicitly: *"It is also the read most likely to meet a stale snapshot (XQ-IO-036)."* All **six** read loops (lines 228, 301, 343, 502, 544, 1456) are covered. The model's own note that "the in-flight fix touched the other five" is the error.

**What this model says others will get wrong.**
- *"The SMB share went down / the handle went stale"* — disproved by the error-log revisions: `appendUserErrors` is structurally identical to `updateEmployeeAnswerFile` (same `safeWriteJson`, same casLoop, same verify) and succeeded 11-for-11 and 8-for-8 in the same windows.
- *"Two machines were racing the answers file"* — `{username}.answers.json` has exactly one routine writer, and the write is serialized in-tab by `withResourceLock`. A race is intermittent; this was 11-for-11 and 7-for-7. Note the **second** failure shape (`threads.index.json`) is genuinely multi-writer and produced the identical exception — one error, two opposite contention profiles ⇒ the gap is in classification, not in a particular race.
- *"Answers were lost / truncated"* — no. `readOptionalJson` propagates inconclusive reads (verified at `safeWrite.ts:2275`, `if (inconclusive !== null) throw inconclusive`), and `updateEmployeeAnswerFile`'s base read aborts rather than truncates (verified in the comment at `answerStorage.ts:196-201`). The real exposure is (a) typed work in `useState`, and (b) possibly **the opposite of data loss** — writes that landed reported as failures (finding 6).
- *"XQ-IO-032 means a write conflict"* — its catalog meaning says the exact opposite.
- *"The working-tree fix closes this"* — it covers more than expected, but `casLoop.ts` and `answerStorage.ts` are untouched, so the verify-throw amplifier, the 9-passes amplification, the dropped `errorName` in the *persisted* log, and draft volatility all survive.
- **Self-caveat:** rates the Chromium mechanism at *high*, not certain — "not something I verified by executing anything."

---

### 2.3 Opus (feedback-index lens) — `opus-feedback-index`

**Verdict.** Two failure signatures, one shared platform fault — but for `feedback:repairThreadsIndex` the classification patch is *not* the fix, and this model proves why. The reason a **manager sitting on `reports/kpi`** writes to a feedback file at all is that `listThreadSummaries` performs a CAS **write** to the single shared `threads.index.json` **from the read path**, and that read path is mounted app-wide by `FeedbackUnreadProvider` for every signed-in user on every page — on mount, on window focus, on a 60 s interval, and on every `feedback` refresh broadcast. The write it attempts is the repair for the index being stale, so *the moment that write starts failing it can never succeed*: every machine rediscovers the same stale index on its next poll, forever. Retrying harder against a self-inflicted, herd-synchronised write storm makes each machine hold the file **longer**.

| # | Title | Kind | Sev | file:line | Conf | Verification |
|---|---|---|---|---|---|---|
| 1 | **CAS write to the shared feedback index runs on the read path, for every user, on every page, every ≤60 s** | root-cause | critical | `feedbackStorage.ts:453` | certain | ✅ **verified, novel** — `updateThreadsIndex(dir, () => repaired)` inside `listThreadSummaries`; `FeedbackUnreadProvider` mounted at `AuthGate.tsx:725` wrapping the whole authenticated tree; `POLL_INTERVAL_MS = 60_000` + focus listener + `subscribeToDataChange(["feedback"])` |
| 2 | `InvalidStateError` classified nowhere → XQ-IO-032 catch-all | root-cause | critical | `casLoop.ts:167` | certain | ✅ verified |
| 3 | **`loadThreadsIndex` maps a thrown read failure to an EMPTY index** | latent-bug | high | `feedbackStorage.ts:183` | certain | ✅ **verified, novel** — the `try` spans `getFeedbackDir` *and* `safeReadJson`; its bare `catch {}` returns `{ threads: [] }`, so one transient read fault makes every thread "missing" ⇒ full-directory read + full shared-file rewrite |
| 4 | **The index repair discards the value CAS just read — blind overwrite** | design-flaw | high | `feedbackStorage.ts:453` | certain | ✅ **verified, novel** — `updateThreadsIndex(dir, () => repaired)` takes no parameter, so `apply(current.threads)` throws away the fresh re-read. Every other caller merges: `createThread` filters-and-appends, `appendReply` maps |
| 5 | **A failed write to a rebuildable CACHE aborts `createThread`** and tells the user their message was not saved | design-flaw | high | `feedbackStorage.ts:301` | certain | ✅ verified — thread file written at 299, then `await updateThreadsIndex(...)` with no try/catch; `updateThreadsIndex` throws on exhaustion |
| 6 | The durable, admin-exportable error log silently drops `errorName` | observability-gap | high | `errorLogSink.ts:65` | certain | ✅ **verified and STILL OPEN** — `toPersisted` copies id/at/username/role/page/action/context/message/errorCode/stack, no `errorName`; `PersistedErrorEntry` has no such field; `ERROR_EXPORT_HEADERS` has no column |
| 7 | The only untuned casLoop in the data layer sits on the most contended shared file | aggravating | medium | `feedbackStorage.ts:247` | high | ✅ verified — only `conflictError` passed ⇒ inherits `DEFAULT_MAX_RETRIES = 10`, `DEFAULT_BASE_DELAY_MS = 200` |
| 8 | The unread badge opens EVERY thread file, on every machine, every 60 s | aggravating | medium | `feedbackStorage.ts:553` | high | ✅ verified — `loadFeedback` → `loadThreads(dir, summaries.map(...))`, unconditional |
| 9 | Opening the feedback panel runs the reconcile twice concurrently in one tab | aggravating | low | `FeedbackWidget.tsx:89` | high | ✅ verified — `Promise.all([listThreadSummaries(dir), …, reloadUnread()])`, and `reloadUnread` → `loadFeedback` → `listThreadSummaries` |
| 10 | Background-poll failures stamped with whatever tab the user happened to be on | observability-gap | medium | `errorLogger.ts:222` | high | ✅ verified — this is exactly why `amonem`'s entries read `page: "reports/kpi"` |

**Note on finding #1's CLAUDE.md claim.** The model says CLAUDE.md's *"written only on create/status-change"* is "simply false in code." **Partially disputed:** the repair write is not undocumented — `listThreadSummaries`' own doc comment states *"the repaired index is written back best-effort … that is what makes a create that lost the index race, a half-finished migration, and a hand-copied thread file all self-healing."* What is fair: CLAUDE.md's one-line summary is **incomplete**, and `updateThreadsIndex`'s own header ("this file is now touched only on thread CREATE and on a STATUS CHANGE") describes only the mutation API, not the reconciling reader. The design intent is documented; the summary is not.

**What this model says others will get wrong.**
- *"The obvious answer is the whole answer."* The working-tree patch fixes the error **message**, not the load. On the repairThreadsIndex path it adds ~1.5 s of inner ladder inside a 10-attempt outer ladder **for each of N contenders**, and is plausibly a net negative unless the read-path write goes away with it. Proof it cannot fix the loop: the write's failure is what leaves the index stale, and the index being stale is what schedules the write.
- *"The SMB share is flaky / environmental."* `listThreadSummaries` **manufactures** the concurrency it then blames the share for.
- *"The `saalhijji` 08:51 flip is an escalation."* No — confirmed as a call chain: entry 15 (`casLoop:exhausted`, 08:51:37.799) and entry 16 (`feedback:repairThreadsIndex`, 08:51:37.**800**) are 1 ms apart. And the two log shapes are **not symmetric**, which misleads: the answer-save pair's second entry carries the *raw English DOMException* (from `onExhausted`), while the feedback pair's second entry carries the *Arabic coded message* and a bundle stack (from `new Error(outcome.error)`).
- **Self-caveat:** could not establish *why* the index was stale in the first place. Hypothesis (plausible, **not** established): the v116 lazy `migrateLegacyMessages` wrote N thread files and lost its single index write, orphaning every migrated thread at once.

---

### 2.4 Sonnet (blast-radius lens) — `sonnet-blast-radius`

**Verdict.** Same root cause, already correctly identified and half-fixed but not committed. The distinguishing contributions are (a) the **timeline check on the previous fix** and (b) the **blast-radius count**. `casLoop`'s generic catch retries the *whole* read-modify-write — a fresh write every time — so a wider outer ladder cannot fix a failure whose trigger is re-armed by every retry's own write. Crucially: commit `85a965a` (*"Fix (answers/casLoop): preserve typed answers, widen the answer-save retry ladder…"*, **2026-08-24**) had **already shipped the evening before** the incident, and the incident happened anyway under the widened ladder.

| # | Title | Kind | Sev | file:line | Conf | Verification |
|---|---|---|---|---|---|---|
| 1 | `InvalidStateError` unclassified → XQ-IO-032 catch-all | root-cause | critical | `errorCodes.ts:645` | certain | ✅ verified |
| 2 | **Widening the outer retry count cannot fix a self-inflicted write-then-verify race** | design-flaw | high | `answerStorage.ts:220` | high | ✅ **verified, and the timeline check is the strongest single piece of evidence in the whole set** — `git log` confirms `85a965a`, dated 2026-08-24, widened `ANSWER_SAVE_MAX_RETRIES` to 14 / base 150 ms specifically for XQ-IO-032 answer-save failures |
| 3 | The uncommitted fix's own fixture change breaks 31 tests | latent-bug | high | `memoryDirectory.ts:347` | certain | ❌ **[disputed by verification]** — see below |
| 4 | **~25 casLoop call sites equally exposed; almost none carry call-site diagnostics** | observability-gap | high | `casLoop.ts:168` | certain | ✅ **verified** — 32 `casLoop(` invocation lines across ~25 distinct sites; **exactly one** (`answerStorage.ts:246`) passes `onExhausted`. This is also the cleanest explanation of `admin`'s single orphan entry |
| 5 | `threads.index.json` is a genuine cross-machine hotspot: every tab polls every 60 s | aggravating | medium | `FeedbackUnreadProvider.tsx:18` | high | ✅ verified |
| 6 | `casLoop:exhausted` entries are not equally severe but read identically | symptom | medium | `feedbackStorage.ts:451` | high | ✅ verified |
| 7 | No durable client-side draft for typed answers | latent-bug | high | `InspectionPanel/index.tsx:101` | high | ✅ verified — zero `localStorage`/`sessionStorage`/`beforeunload` in the panel or `src/` at large |
| 8 | Worst-case retry wall time ~13.5–20.5 s with zero progress feedback | observability-gap | medium | `casLoop.ts:159` | medium | ✅ arithmetic verified: `withJitter(baseDelay*(attempt+1))`, jitter ∈ [0.5×,1.5×]; Σ 150·(n+1) for n=0..12 = 13 650 ms, ×1.5 = 20 475 ms |

**[disputed by verification] — finding #3.** The claim is that `withReadFaults`' guard `if (!faultState && !operationLog) return file;` is dead code (because `createMemoryDirectory` always allocates `faultState`), so `wrapBlob` runs unconditionally and `blob.stream.bind(blob)` throws `TypeError: Cannot read properties of undefined (reading 'bind')`, failing 31 tests in 3 files.

The **guard is indeed effectively dead** — `faultState` is always non-null — and that part of the observation stands. But the consequence does not: `wrapBlob` binds each method **only after a `typeof native !== "function"` check** (`memoryDirectory.ts:357-358`), and the code carries an explicit comment about jsdom Blobs lacking the full method set. A re-run today gives:

```
npx vitest run src/data/storage/
Test Files  1 failed | 33 passed (34)
     Tests  1 failed | 394 passed (395)
```

The single failure is `errorCodes.test.ts > matches the pinned code -> meaning map exactly` — the append-only catalog snapshot, unrelated to `memoryDirectory`. **`directoryScan.test.ts` and `directoryScan.notFound.test.ts` both pass.** `npx tsc -b` is clean. The most likely explanation is that this model analysed an earlier state of the working tree, before the `typeof native` guard was added. The finding's *conclusion* — "not mergeable as-is" — is now wrong; the correct statement is "one pinned-snapshot line from mergeable."

**What this model says others will get wrong.**
- Others will find the uncommitted diff and declare the incident fixed **without running the suite**. (Ironically this is where its own finding #3 went wrong in the other direction — but the underlying instruction, *run the gates*, was right, and doing so is what produced the correct merge-readiness answer.)
- Others will credit `85a965a`'s wider ladder as a mitigation **without checking its timestamp against the incident window**.
- Others will frame this as "4 users contending on a shared drive" and miss that the dominant, always-present trigger is the app's **own** write making its **own** verification read look stale — a single-user-reproducible artifact — with genuine cross-machine contention narrower and concentrated on `threads.index.json`.
- Others will treat every `casLoop:exhausted [XQ-IO-032]` as equal data loss. The `feedback:repairThreadsIndex` ones are cosmetic and self-healing; only the answer-save ones block work — and even those are more likely a **false "save failed"** report than guaranteed loss.
- **Self-caveat (important and correct):** `staleSnapshot.test.ts` only exercises a **count**-based fault model ("fail N times then succeed"), never a **time**-based one matching the hypothesized ~10 s SMB metadata-cache mechanism — so the suite cannot prove the fix closes the worst case.

---

### 2.5 Haiku (log forensics) — verdict RECOVERED, with a caveat that changes how to read it

The synthesiser was told no Haiku verdict was returned, and wrote §2.5 accordingly. That was
correct about the orchestration: Haiku's structured output was **rejected by schema validation**
(`/rootCause: must NOT have additional properties`) and it exhausted its retries, so nothing
reached the synthesiser. The analysis itself survived in the agent transcript and is reproduced
here so the model's own view is on the record rather than lost to a validation error.

**Read it with this caveat.** Haiku ran LAST, against a working tree that already contained the
in-progress fix. Its "forensics" therefore describe a codebase where `isSnapshotStaleError` and
`XQ-IO-036` already exist, and it correctly notes they "were not present on 2026-08-25" — but the
line numbers it cites (`transientFileErrors.ts:127`, `errorCodes.ts:655`) are POST-fix, not the
HEAD lines the other four cite. It also asserts the retry ladder is "proven sufficient", which
nothing in evidence establishes; that claim is rejected below and the ladder was subsequently
shortened for a different reason (see §7).

**Verdict.** Same mechanism as the other four, reached independently: Chromium's
`InvalidStateError` — a stale `(size, mtime)` snapshot — was not in `isTransientWriteError`, so
`retryTransientWrite` rethrew it on the first attempt, `safeWriteJson` did not catch it, and it
reached `casLoop`, which reported XQ-IO-032. Haiku is the only model to trace the failure
specifically through `writeText` → `createWritable().close()` rather than through a read.

| Finding | Kind | Severity | Location (post-fix lines) | Confidence |
|---|---|---|---|---|
| InvalidStateError not in transient write error classification | root-cause | critical | `src/data/storage/transientFileErrors.ts:127` | certain |
| error-code classification missing for InvalidStateError | aggravating-factor | critical | `src/data/storage/errorCodes.ts:655` | certain |
| generic XQ-IO-032 masks the retry-able nature of the fault | symptom | high | `src/data/storage/casLoop.ts:168` | high |
| casLoop onExhausted callback receives unclassified exception code | symptom | medium | `src/data/answers/answerStorage.ts:249` | high |
| feedback thread index repair silently fails when update throws | symptom | high | `src/data/feedback/feedbackStorage.ts:458` | high |
| jalgahamdi errors span 1.5-hour window with large inter-failure gaps | symptom | medium | `src/data/answers/answerStorage.ts:223` | high |
| saalhijji and amonem error entries include stack traces from minified bundle | observability-gap | medium | `src/data/errorLog/errorLogStorage.ts:120` | medium |
| role field is inconsistently populated across user error logs | observability-gap | low | `src/data/errorLog/errorLogStorage.ts:35` | low |

**What Haiku expected others to get wrong:** *"Support teams might initially blame SMB share
instability or network configuration… However, this misunderstands the incident: the code was
already written to retry transient errors, but InvalidStateError was not in the list. Every other
transient error was already retried. The defect is in the classification, not in the presence of
retries."* — This is the sharpest one-sentence statement of the root cause any model produced.

**Where Haiku is wrong:** it claims the ladder is "proven sufficient because… this same ladder is
already used successfully for NotReadable and NotFound errors". It is not proven, and the
premise is false — `NOT_READABLE_RETRY_DELAYS_MS` is 2 rungs, not 5. Marked
**[disputed by verification]**.

**Unique contribution:** two observations no other model made, both verified —
`role` is populated inconsistently across the four user logs (present for `jalgahamdi` and
`saalhijji`'s early entries, absent later and for `admin`), and only some entries carry a stack
from the minified bundle. Both are session-state and capture-path artifacts worth understanding
before anyone reads the logs as a complete record.

---

## 3. Cross-model consensus

### 3.1 Reached independently by 4 of 4 models (strongest signal)

| Finding | Verified |
|---|---|
| **C1.** The exception is Chromium's `InvalidStateError` (stale cached `(size, mtime)` snapshot on a `File` / writable stream), endemic to UNC/SMB. | Mechanism not executable here; **all four** models flag it as external knowledge. The message string is verbatim-consistent across all four and matches the new XQ-IO-036 catalog text. |
| **C2.** `classifyFileSystemError` has no `InvalidStateError` case → `resolveErrorCode` returns null → `casLoop.ts:167` reports the XQ-IO-032 catch-all. | ✅ verified at HEAD, `errorCodes.ts:645` |
| **C3.** `isTransientWriteError` omits it → `retryTransientWrite` rethrows on attempt 0; the write path gets **zero** in-place retries. | ✅ verified at HEAD, `transientFileErrors.ts:79-83` |
| **C4.** casLoop's whole-attempt retry is the *only* thing that retried it — the coarsest and most write-amplifying granularity available. | ✅ verified, `casLoop.ts:135` |
| **C5.** Widening the outer retry ladder is not the fix and should not be attempted again. | ✅ verified — reinforced by `85a965a` having already done exactly that on 2026-08-24 |

### 3.2 Reached by 3 of 4 models

| Finding | Models | Verified |
|---|---|---|
| **C6.** The durable error log never records `error.name` — the one field that identifies a DOMException. | cls, ans, fb | ✅ verified, and **still open after the in-flight fix**: `errorLogger.ts` gained `errorName`, but `errorLogSink.toPersisted`, `PersistedErrorEntry` and `ERROR_EXPORT_HEADERS` did not. The exported XLSX admins actually send still cannot carry it. |
| **C7.** Typed inspection answers live only in React `useState` — no draft persistence, no `beforeunload`, 3-tab mount LRU. | ans, sonnet, cls (as symptom #9) | ✅ verified: zero `beforeunload` in `src/`; `tabMountLru.ts:12` `limit = 3`; `setAnswers`/`setDirtyEntryId(null)` inside the `ok` branch only |
| **C8.** `threads.index.json` is a real cross-machine hotspot driven by an app-wide 60 s poll mounted for every user on every page. | fb, sonnet, ans | ✅ verified: `AuthGate.tsx:725`, `POLL_INTERVAL_MS = 60_000` + focus + refresh-signal |
| **C9.** The read path's retries gate on `isNotReadableError` specifically, so a write-only fix would appear not to work. | cls, ans, sonnet | ✅ verified at HEAD (6 sites); ✅ **all six now unified** in the working tree via `readRetryDelayMs` |

### 3.3 Reached by 2 of 4 models

| Finding | Models |
|---|---|
| **C10.** XQ-IO-032's label offers a remedy the code never earned. (cls rates it high; ans concurs it is "the NoModificationAllowedError story, not this one".) — *partially disputed, see §2.1* | cls, ans |
| **C11.** Only `answerStorage` passes `onExhausted`; every other casLoop site logs a context-free `casLoop:exhausted`. | cls (as feedback-specific), sonnet (as fleet-wide) — ✅ verified: 1 of ~25 |
| **C12.** The two log shapes (raw English vs. translated Arabic) are the *same* fault surfacing through different call sites and must not be read as two problems. | fb, sonnet |

### 3.4 Singleton findings (one model each) — all verified, all novel

| ID | Finding | Model | Verified |
|---|---|---|---|
| S1 | `readContent` consumes one `File` snapshot twice with awaits between (`safeWrite.ts:262-299`) | ans | ✅ |
| S2 | casLoop treats a **throw** from `verify()` as a lost update, discarding a write that already read back clean (`casLoop.ts:131`) | ans | ✅ — arguably the most under-appreciated finding in the set; **untouched by the in-flight fix** |
| S3 | `safeWriteJson` re-reads the whole file the caller just read, to recover `previousRevision` (`safeWrite.ts:1638`) | ans | ✅ in shape |
| S4 | `loadThreadsIndex`'s bare `catch {}` maps a *thrown* read failure to an EMPTY index, converting one blip into a full-directory read + full shared-file rewrite (`feedbackStorage.ts:177-187`) | fb | ✅ — a direct violation of the module's own doctrine at `safeWrite.ts` (`readOptionalJson` throws inconclusive rather than defaulting) |
| S5 | The index repair blind-overwrites: `updateThreadsIndex(dir, () => repaired)` discards the CAS re-read (`feedbackStorage.ts:453`) | fb | ✅ |
| S6 | `createThread` fails user-visibly when a *rebuildable cache* write fails, after the durable thread file already landed (`feedbackStorage.ts:299-304`) | fb | ✅ — and the retry the user is then advised to make mints a **new** thread id, duplicating the feedback |
| S7 | `FeedbackWidget.refresh` runs the reconcile twice concurrently in one tab (`FeedbackWidget.tsx:89-95`) | fb | ✅ |
| S8 | Background-poll failures inherit the active tab's `page` label — the reason `amonem` reads `reports/kpi` | fb | ✅ |
| S9 | ~25 casLoop sites, one with call-site telemetry — `admin`'s orphan entry is unattributable | sonnet | ✅ |
| S10 | Up to ~20.5 s of blocked UI with no retry-progress feedback | sonnet | ✅ arithmetic |

---

## 4. Contested points

These are the real disagreements. They are not resolved by the code alone, and each is stated with both sides.

### CP-1 — Is the fault self-inflicted (single-machine) or genuine cross-machine contention?

- **Sonnet + opus-answer-save:** dominantly **self-inflicted**. `safeWriteJson` commits and reads back within milliseconds, so the app's own write invalidates the metadata its own verification snapshot is built from. Evidence: `retryMissing: true` already exists because this repo knows the directory metadata lags a just-completed `close()`; `{username}.answers.json` has one routine writer, serialized in-tab by `withResourceLock`; `admin`'s log has a single orphan entry with no second writer implied.
- **opus-feedback-index:** for the *feedback half*, genuinely **cross-machine and self-manufactured by the app's design** — `saalhijji` (drive Z:) and `amonem` (drive Y:) attempt the identical write on the identical file 14 s apart, from two machines, neither of whom opened a feedback panel.
- **opus-classification:** neither exactly — proposes a **sticky session-scoped** condition (a long-lived `WorkspaceProvider` root handle going stale after an SMB session re-establishment), because 11 rounds over 88 minutes with fresh snapshots each time does not fit a millisecond race, and `saalhijji`'s failures cross two workspace roots.
- **Verification says:** all three are partially right and they are describing *different files*. Per-user answer files have one writer (self-inflicted fits); `threads.index.json` has N writers by construction (cross-machine fits). Nothing in the repo can adjudicate the sticky-handle hypothesis — and opus-classification says so itself, at medium confidence.

### CP-2 — Does the uncommitted fix close the incident?

- **opus-classification / Sonnet:** necessary, not sufficient; land it, then keep going.
- **opus-answer-save:** "classification alone converts a certain failure into a probable one; it does not make the save cheap enough to reliably succeed."
- **opus-feedback-index, most sharply:** on the `repairThreadsIndex` path the patch is **plausibly a net negative** — it adds ~1.5 s of inner ladder inside a 10-attempt outer ladder for each of N contending machines, i.e. each machine holds the contended file *longer*. The loop has no exit that does not require the failing write to succeed.
- **Verification:** the patch's own comment argues the opposite — that ~1.5 s inner × casLoop's outer ladder "spans well past a default ~10 s Windows metadata-cache lifetime without any single read blocking for that long." That reasoning is sound *for a single-writer file* and does not address N-writer contention. **Unresolved. This is the most consequential open disagreement.**

### CP-3 — Is the fix mergeable today?

- **Sonnet:** no — 31 tests / 3 files fail via a `memoryDirectory` fixture bug.
- **Verified:** **1 test / 1 file** fails (`errorCodes.test.ts` pinned-meanings map, which must gain `XQ-IO-036`). `tsc -b` clean; answers + feedback suites 85/85. Sonnet's dead-guard *observation* is correct; its *consequence* is not reproducible against the current tree. Sonnet likely read an earlier state.

### CP-4 — Was there data loss?

- **opus-classification:** yes in effect — 7 answer saves and 11 referral saves never persisted; recoverable only until a reload or an LRU eviction.
- **opus-answer-save:** possibly **the opposite** — via S2 (casLoop treating a `verify()` throw as a lost update), writes that *did* land may have been reported as failures, with the file ending at revision N+14 carrying 14 identical `valueHistory` entries.
- **Sonnet:** false-failure is the more likely reading, and neither can be proven from the error logs alone.
- **All four agree** on what did **not** happen: no truncation and no corruption. `readOptionalJson` throws on inconclusive reads rather than substituting an empty default (verified, `safeWrite.ts:2275`); `updateEmployeeAnswerFile` aborts rather than truncates (verified); `createWritable()` without `keepExistingData` stages into a `.crswap` sibling. **Unresolved without a workspace snapshot** — and resolvable in future only if S2 is fixed or `errorName` reaches the persisted log.

### CP-5 — Is XQ-IO-032's Arabic label a defect?

- **opus-classification:** yes, high severity — it "asserts a confident diagnosis the code never established."
- **Verified:** overstated. The label is hedged («قد يكون» = "may be"), and its current wording is *itself* a prior correction of a stronger claim, documented in a comment immediately above it. What survives: a catch-all should not offer a *remedy* («أعد المحاولة بعد قليل») that an 88-minute retry history falsifies. Downgraded to medium.

### CP-6 — How many answer-save rounds did `saalhijji` suffer?

`opus-classification` says 8; `opus-answer-save` and `opus-feedback-index` say 7 answer saves + 1 feedback repair (16 entries = 8 pairs, revision 8). The 7+1 reading is internally consistent with the 1 ms-apart pair at 08:51:37 that `opus-feedback-index` documents. **Minor, but it means any "N answers lost" figure quoted downstream should be 7, not 8.**

---

## 5. Verified evidence — merged timeline

> **Provenance caveat.** The raw log files are **not** in this repository (searched; absent). The Haiku log-forensics verdict was not returned. Everything below is reconstructed from points where **two or more** of the four returned verdicts cite the same artifact, and is marked accordingly. It is *corroborated testimony*, not first-party verification.

| Time (2026-08-25) | User / drive | Page | Entry | Cited by |
|---|---|---|---|---|
| 05:36:35 | jalgahamdi (Y:) | employee-workspace | `casLoop:exhausted [XQ-IO-032]` + `answerStorage:answer-save` | cls, ans |
| 06:00 – 06:37 | jalgahamdi | employee-workspace | 8 further pairs (06:00, 06:30, 06:31, 06:32, 06:34, 06:36, 06:36, 06:37) | cls |
| 06:55, 07:04:53 | jalgahamdi | employee-workspace | final 2 pairs — **11 rounds / 88 min** | cls, ans |
| 08:44 – 08:51 | saalhijji (Z:) | employee-workspace | 7 answer-save pairs (entries 1–14) | ans, fb |
| 08:51:37.799 | saalhijji | employee-workspace | `casLoop:exhausted [XQ-IO-032]` (entry 15) | fb, sonnet |
| 08:51:37.**800** | saalhijji | employee-workspace | `feedback:repairThreadsIndex` (entry 16) — **1 ms later** | fb |
| 08:51:51.881 | amonem (Y:) | **reports/kpi** | `feedback:repairThreadsIndex` | cls, fb |
| 08:52:11.616 | amonem | reports/kpi | second identical repair, ~20 s later | fb, sonnet |
| (unstated) | admin | employee-workspace | **single** `casLoop:exhausted [XQ-IO-032]`, no paired action entry | sonnet |

### What the timeline proves

1. **The share was writable throughout.** `jalgahamdi`'s error file is `revision: 11` / 22 entries and `saalhijji`'s `revision: 8` / 16 — meaning 11 and 8 *successful* CAS writes to `5-system/system-errors/` through the identical `safeWriteJson` + `casLoop` + verify stack, interleaved with the failures. This is the single strongest refutation of "the network share went down." (ans; structurally verified — `appendUserErrors` uses the same stack.)
2. **The 1 ms gap at 08:51:37 is a call chain, not an escalation.** `casLoop.ts:168` logs the exhaustion, returns `{ok:false}`, `updateThreadsIndex` rethrows, `listThreadSummaries` catches and logs. Same fault, two log lines. (fb; code path verified.)
3. **The two log shapes are asymmetric and mislead.** Answer-save pairs carry the **raw English DOMException** (via `answerStorage`'s `onExhausted`, verified at `answerStorage.ts:246-252`); feedback pairs carry the **Arabic coded message** and a bundle stack (via `new Error(outcome.error)`). One fault, two appearances.
4. **`amonem` on `reports/kpi` is not a Reports-tab bug.** `FeedbackUnreadProvider` is mounted at `AuthGate.tsx:725` around the entire authenticated tree, and `logError` fills `page` from ambient context — so a background poll's failure is stamped with whatever tab was open. Verified.
5. **Two machines, two drive letters, one file, 14 s apart** (`saalhijji` Z: 08:51:37, `amonem` Y: 08:51:51) is exactly the signature of near-synchronized 60 s polls plus the 45 s `workspaceSync` broadcast. Verified in code.
6. **`admin`'s orphan entry is unattributable** — with 1 of ~25 casLoop sites carrying `onExhausted`, there is no way to name which writer failed. Verified by count.
7. **Arithmetic does not fully close.** `opus-feedback-index` states "42 entries across all four logs"; the per-user counts the models cite sum to 22 + 16 + 2 + 1 = **41**. Treat any total as ±1 until the logs are inspected directly.
8. **The previous fix was already live.** `git log` confirms `85a965a` (2026-08-24) widened `ANSWER_SAVE_MAX_RETRIES` to 14 / base 150 ms *specifically for XQ-IO-032 answer-save failures*. The incident occurred the next morning under that ladder. **Verified — this is the decisive argument against retry-count tuning as a remedy.**

---

## 6. Issue register (prioritized)

| ID | Title | Sev | Class | file:line | Models |
|---|---|---|---|---|---|
| **XQ-F-01** | `InvalidStateError` unclassified in `classifyFileSystemError` → XQ-IO-032 catch-all | critical | root-cause | `src/data/storage/errorCodes.ts:645` (HEAD) | **4/4** |
| **XQ-F-02** | `isTransientWriteError` omits it → write path gets zero in-place retries | critical | root-cause | `src/data/storage/transientFileErrors.ts:79-83` (HEAD) | **4/4** |
| **XQ-F-03** | All six `safeWrite.ts` read loops gate on `isNotReadableError` alone → read path equally unretried | high | root-cause | `safeWrite.ts:187,260,302,461,497,1406` (HEAD) | 3/4 |
| **XQ-F-04** | CAS **write** to shared `threads.index.json` on the **read** path, for every user on every page every ≤60 s — self-perpetuating, herd-synchronised | critical | root-cause | `src/data/feedback/feedbackStorage.ts:453` + `src/auth/AuthGate.tsx:725` | 1/4 (corroborated by 2 more as aggravating) |
| **XQ-F-05** | casLoop treats a **throw** from `verify()` as a lost update → discards writes that already read back clean; false "save failed" | high | design-flaw | `src/data/storage/casLoop.ts:131` | 1/4 · **open after the in-flight fix** |
| **XQ-F-06** | `errorName` never reaches the **persisted** log or the XLSX export | high | observability | `src/data/errorLog/errorLogSink.ts:65`, `errorLogTypes.ts:12`, `errorLogExport.ts:34` | 3/4 · **open after the in-flight fix** |
| **XQ-F-07** | No durable draft for typed answers: React `useState` only, no `beforeunload`, 3-tab mount LRU | high | design-flaw | `src/components/InspectionPanel/index.tsx`, `tabMountLru.ts:12` | 3/4 |
| **XQ-F-08** | `loadThreadsIndex`'s bare `catch {}` maps a *thrown* read failure to an EMPTY index → one blip becomes a full rewrite | high | latent-bug | `feedbackStorage.ts:177-187` | 1/4 |
| **XQ-F-09** | Index repair blind-overwrites — `updateThreadsIndex(dir, () => repaired)` discards the CAS re-read | high | design-flaw | `feedbackStorage.ts:453` | 1/4 |
| **XQ-F-10** | `createThread` surfaces a failed **cache** write as a user-facing save failure → retry duplicates the thread | high | design-flaw | `feedbackStorage.ts:299-304` | 1/4 |
| **XQ-F-11** | `readContent` consumes one `File` snapshot twice with awaits between | high | design-flaw | `safeWrite.ts:262-299` | 1/4 |
| **XQ-F-12** | ~25 casLoop sites, exactly 1 with `onExhausted` → `admin`'s failure unattributable | high | observability | `casLoop.ts:168`; only `answerStorage.ts:246` | 2/4 |
| **XQ-F-13** | Answer-save amplification: ~9 whole-file passes/attempt × 14 attempts, no partial progress | high | aggravating | `answerStorage.ts:186-232`, `safeWrite.ts:1638` | 2/4 |
| **XQ-F-14** | Failed index repair never self-heals; re-fires a full 10-attempt ladder every poll and every panel open | medium | aggravating | `feedbackStorage.ts:441-459` | 2/4 |
| **XQ-F-15** | `updateThreadsIndex` is the only untuned casLoop in the data layer (defaults 10 × 200 ms) on the most contended file | medium | aggravating | `feedbackStorage.ts:247` | 1/4 |
| **XQ-F-16** | Background-poll failures stamped with the active tab (`page: reports/kpi`) | medium | observability | `errorLogger.ts` `readErrorContext()` | 1/4 |
| **XQ-F-17** | Persisted entry names no sample, month or file → blast radius unmeasurable | medium | observability | `errorLogTypes.ts:12` | 1/4 |
| **XQ-F-18** | Unread badge opens **every** thread file on every machine every 60 s | medium | aggravating | `feedbackStorage.ts:553` | 1/4 |
| **XQ-F-19** | XQ-IO-032's label offers a remedy the code never earned (label is hedged; *remedy* is the defect) | medium | design-flaw | `labelsStore.ts` `err_io_032_cas_write_failed` | 2/4 · downgraded on verification |
| **XQ-F-20** | Up to ~20.5 s of blocked UI with no retry-progress feedback | medium | observability | `casLoop.ts:159`, `InspectionPanel/index.tsx:402` | 1/4 |
| **XQ-F-21** | `FeedbackWidget.refresh` runs the reconcile twice concurrently in one tab | low | aggravating | `FeedbackWidget.tsx:89-95` | 1/4 |
| **XQ-F-22** | `withReadFaults`' `if (!faultState && !operationLog)` guard is effectively dead code | low | latent-bug | `memoryDirectory.ts:347` | 1/4 · consequence **disputed** (see §2.4) |
| **XQ-F-23** | `staleSnapshot.test.ts` exercises only a **count**-based fault model, never a **time**-based one | low | test-gap | `src/data/storage/staleSnapshot.test.ts` | 1/4 |

### Suggested sequencing

1. **Unblock the in-flight fix** (one line): add `XQ-IO-036` to `errorCodes.test.ts`'s pinned meanings map. That takes `src/data/storage/` to 395/395. Then run the tier-2 gates (`lint`, `typecheck`, `test:run`) **plus `npm run build`** per CLAUDE.md, and generate the entry with `npm run editlog -- --tier=2`. Closes **XQ-F-01 / XQ-F-02 / XQ-F-03**.
2. **Do not close the incident there.** Land **XQ-F-04** (delete the read-path index write, or gate it once-per-session to the client that created the orphan) alongside it — per §4/CP-2, the classification patch on its own may make the feedback path slower rather than better.
3. **XQ-F-06** is a four-line additive change (`errorName?` on `PersistedErrorEntry`, one spread in `toPersisted`, one export header, one row cell) and is the difference between the next incident taking ten minutes and taking a full-stack read. `errorLogTypes.ts`'s own schema contract states an optional addition needs no migration. `errorLogExport.ts` is deterministic-by-contract — snapshot first, then change, then diff.
4. **XQ-F-05** is the quietest high-severity item in the set and is untouched by the in-flight fix. Until a `verify()` throw is distinguishable from `verify() === false`, "the save failed" is not a trustworthy statement.
5. **XQ-F-07** is the only change that protects the employee's typed work while the underlying I/O fault is still being chased. Any browser-storage key must be registered in `storageRegistry.ts` per CLAUDE.md.
6. **Explicitly do not** raise `ANSWER_SAVE_MAX_RETRIES` above 14 or `DEFAULT_MAX_RETRIES` above 10. `85a965a` already ran that experiment on 2026-08-24 and this incident is its result.


---

## 7. Fable's revision (max effort) — rulings on everything above

Fable read the whole dossier and re-derived the root cause from the code itself, ruling on every
significant claim the other five made. Its own section headings are preserved below; this table is
the summary.

| Claim | Ruling |
|---|---|
| Consensus root cause: DOMException `InvalidStateError` was classified nowhere — not in classifyFileSystemError (default: return null), not in isTransientWriteError, not in any of safeWrite's | **CONFIRMED** |
| Adding InvalidStateError to the classifier is sufficient to close the incident. | **REFUTED** |
| Synthesis §1/§6: the uncommitted fix leaves casLoop's verify-throw (XQ-F-05), persisted errorName (XQ-F-06), the feedback read-path write (XQ-F-04), createThread's cache-write abort (XQ-F-10 | **REFUTED** |
| Sonnet CP-3: the fix breaks 31 tests in 3 files because memoryDirectory's withReadFaults guard is dead code and wrapBlob's bind throws. | **REFUTED** |
| Log arithmetic: saalhijji suffered 7 answer-save rounds + 1 feedback repair (not 8 answer rounds); totals across the four logs are 42 (opus-feedback-index) or 41 (synthesizer). | **PARTLY-CORRECT** |
| The share was writable throughout — the error-log files' own revisions prove successful CAS writes through the identical stack interleaved with the failures. | **CONFIRMED** |
| opus-classification's sticky session-scoped condition: the long-lived WorkspaceProvider root handle went stale after an SMB session re-establishment (offered at medium confidence as unprovab | **REFUTED** |
| opus-feedback-index: a CAS write to the shared threads.index.json ran on the read path for every user on every page every ≤60 s, self-perpetuating and herd-synchronised; loadThreadsIndex's b | **CONFIRMED** |
| S2 (opus-answer-save): casLoop treats a THROW from the delayed verify() as a lost update, discarding a write that already read back clean — false 'save failed'. | **CONFIRMED** |
| Answer-save amplification: ~9 whole-file passes per attempt × 14 retries, with the month-lock check among the per-attempt costs (opus-classification). | **PARTLY-CORRECT** |
| ~25 casLoop call sites with exactly one passing onExhausted, making admin's orphan entry unattributable (XQ-F-12/S9). | **CONFIRMED** |
| Commit 85a965a had already widened the answer-save ladder (14×150 ms) the evening before, and the incident happened under it — so further retry widening is disproven as a remedy (Sonnet's ti | **CONFIRMED** |
| CP-5: XQ-IO-032's Arabic label asserts a diagnosis the code never made (opus-classification, high severity). | **PARTLY-CORRECT** |
| opus-answer-save's specifics: readContent consumes one File snapshot twice (S1); safeWriteJson re-reads the file the caller just read to recover previousRevision (S3); 'next free code is XQ- | **PARTLY-CORRECT** |
| CP-4: data was lost (opus-classification: 7+11 saves never persisted) vs the opposite (writes landed but were reported failed); no truncation or corruption either way. | **UNVERIFIABLE** |

### Fable's full write-up

# XQ-IO-032 Production Incident — Final Revision & Solution Design

**Reviewer basis:** every claim below was re-verified first-hand against the four raw error logs (read in full), `git show HEAD:`, the live working tree, `git log`, and by actually running the gates. **Important context discovered during review: the working tree was being actively modified by another agent while I reviewed** — files appeared mid-review (`casLoop.ts` verify fix, `useUnloadGuard`, extra feedback tests). Everything below is pinned to the final state I inspected: 18 modified + 3 untracked files, on which I ran `tsc -b` (clean), `npm run lint` (clean), `npm run test:run` (**418 files / 3965 tests, all passing**), and `npm run build` (clean; I restored `dist/index.html` to HEAD afterwards so the tree is as I found it).

---

## 1. The logs, first-hand (settling the arithmetic disputes)

| User | File | Entries / revision | Content |
|---|---|---|---|
| jalgahamdi (Y:) | `e6437a5b-…` | 22 / rev 11 | **11** `casLoop:exhausted [XQ-IO-032]` + `answer-save` pairs, 05:36:35 → 07:04:53 (~88 min), page `employee-workspace/xray-referrals`, role employee |
| saalhijji (Z:) | `8603f12d-…` | 16 / rev 8 | **7** answer-save pairs (08:44:47 → 08:50:56) + **1** feedback pair: `casLoop:exhausted` 08:51:37.**799** → `feedback:repairThreadsIndex` 08:51:37.**800** (1 ms — a call chain, not an escalation) |
| amonem (Y:) | `b03178c6-…` | 4 / rev 2 | 2 feedback pairs (08:51:51, 08:52:11), page `reports/kpi`, role manager |
| admin | `8d956684-…` | 1 / rev 1 | one orphan `casLoop:exhausted [XQ-IO-032]` at 08:29:53, **no paired action entry** |

- **Grand total is 43 entries** — opus-feedback-index's "42" and the synthesizer's "41" are both wrong. saalhijji's count is **7 answer saves + 1 feedback repair** (the 7+1 camp was right; opus-classification's "8" was wrong).
- Every entry carries the identical English sentence; **40 of 43 have no stack**; the 3 with stacks are exactly the feedback-pair second entries (`new Error(outcome.error)` — Arabic coded message + minified bundle stack at `file:///Y:/…html` / `file:///Z:/…html`). The two log shapes are asymmetric exactly as opus-feedback-index described: answer-save pairs carry the **raw English DOMException** via `answerStorage.ts:246–252`'s `onExhausted`; feedback pairs carry the **translated Arabic** via `feedbackStorage`'s catch. One fault, two appearances — confirmed.
- The **share was writable throughout**: jalgahamdi's own error file is revision 11 with 22 entries — 11 *successful* CAS writes to `5-system/system-errors/` through `appendUserErrors` (`errorLogStorage.ts:186–227`), which is structurally identical to `updateEmployeeAnswerFile` (same `safeWriteJson` + `casLoop` + read-back verify + delayed verify; 6×100 ms tuning at line 227), interleaved within seconds of the failing saves. This is the strongest single piece of evidence in the incident and it verifies completely.

## 2. Root cause — re-derived and confirmed

**Root cause (mechanism):** the DOMException named `InvalidStateError` — Chromium's stale cached `(size, mtime)` snapshot on a `File`/writable stream, raised when the bytes are touched, and routine on a Windows SMB/UNC share — was, at HEAD, classified **nowhere**:

- `classifyFileSystemError` enumerates six names and falls to `default: return null` — **verified at HEAD `errorCodes.ts:645–646`**; the catalog runs XQ-IO-001…035 with no 036 (opus-answer-save's "next free is XQ-IO-037" is wrong; opus-classification's 036 is right).
- `isTransientWriteError` = NotFound ∨ NotReadable ∨ NoModificationAllowed — **verified at HEAD `transientFileErrors.ts:79–83`** — so `retryTransientWrite` (`:492–511`) rethrew on attempt 0 and `writeText` (`safeWrite.ts:587–604`) got zero in-place retries.
- All **six** read loops gated on `isNotReadableError` alone — **verified at HEAD `safeWrite.ts:187, 260, 302, 461, 497, 1406`** (`readText`, `readContent`, `classifyFile`, `openFile`, `streamFileChunks.readWindow`, `readEnvelopeMetadataTolerant`).
- So the exception escaped every purpose-built ladder, was retried only by `casLoop`'s unconditional catch (the coarsest granularity: the whole read-modify-write, 14× for answers per `answerStorage.ts:40–41`, 10×200 ms defaults for the feedback index), and landed on `casLoop.ts:167`'s `resolveErrorCode(lastCause) ?? "XQ-IO-032"` — a code whose catalog meaning (**HEAD `errorCodes.ts:319–323`**) is literally "the exception carried no more specific code".
- And the durable log recorded `.message`/`.stack` but never `.name` (**HEAD `errorLogger.ts` + `errorLogTypes.ts`**), so the one classifying attribute never reached the artifact admins export.

**Symptoms:** the XQ-IO-032 pairs themselves; the Arabic advice loop; the unattributable admin orphan (1 of **32** `casLoop<` call lines across 23 files passes `onExhausted` — recounted first-hand).

**Aggravating factors, each verified:**
- **Answer path amplification**: one attempt = ~9 whole-file passes over `{username}.answers.json` — 5 full live reads (`answerStorage.ts:202` base, `safeWriteJson`'s pre-write read at working-tree `safeWrite.ts:1688`, post-commit verify `:1864`, CAS verify `answerStorage.ts:221`, delayed verify `:228`) + 1 `.tmp` read (`:1848`) + 3 writes (`.bak`, `.tmp`, live) — ×14 retries. One correction to opus-classification: `ensureMonthWritable` runs **once per save** (`answerStorage.ts:193`), not per attempt.
- **casLoop verify-throw** (S2): at HEAD `casLoop.ts:131` the delayed `verify()` sat inside the try, so a *throw* from the confirmation read was treated as a lost update and discarded a write that had already read back clean — a false-"save failed" manufacturer. Verified at HEAD; **fixed in the working tree** (`casLoop:verify-inconclusive`, keeps the result, with two new tests).
- **Feedback index architecture** (XQ-F-04/08/09): at HEAD, `listThreadSummaries` performed a CAS **write** to the one shared `threads.index.json` from the **read** path (HEAD `feedbackStorage.ts:450–459`), reached by `loadFeedback` ← `FeedbackUnreadProvider` (mounted around the whole authenticated tree at `AuthGate.tsx:725`; poll 60 s at `FeedbackUnreadProvider.tsx:18` + focus + `feedback` broadcast, with `workspaceSync` probing the `threads/` signature every tick, `workspaceSync.ts:458–478`). The repair's failure leaves the index stale, and the stale index re-schedules the repair — self-perpetuating and herd-synchronised; this is exactly why a manager on `reports/kpi` (page stamped from ambient `readErrorContext()` at `errorLogger.ts:222`) wrote a feedback file 14 s after saalhijji did from another drive letter. Additionally HEAD's `loadThreadsIndex` bare `catch {}` mapped a *thrown* read to an EMPTY index (one blip → full directory read + full shared rewrite), violating the module's own doctrine at `safeWrite.ts:2184–2188`/`2275`.
- **85a965a timeline**: `git show` confirms *"Fix (answers/casLoop): preserve typed answers, widen the answer-save retry ladder…"*, **2026-08-24 20:28 +0300** — the widened 14×150 ms ladder was live the evening before and the incident happened under it. Retry-count tuning is conclusively not the remedy.

**On CP-1 (self-inflicted vs cross-machine vs sticky handle):** the per-file split stands — answers files are single-writer (self-poisoning fits: each attempt's own commit re-arms the stale window for the next attempt's read, which makes *every* save fail deterministically while the condition holds — matching 11/11 and 7/7); `threads.index.json` is N-writer by construction. But opus-classification's **sticky root-handle hypothesis is refuted, not merely unverifiable**: the successful error-log CAS writes went through the *same* `WorkspaceProvider` root handle within seconds of each exhaustion. What still cannot be adjudicated client-side is the precise Windows-side trigger of the first stale read-back; the fix rightly does not depend on it.

**On CP-4 (data loss):** unresolvable from the logs. The code proves no truncation/corruption (`readOptionalJson` throws inconclusive, `safeWrite.ts:2275`; abort-not-truncate, `answerStorage.ts:196–202`; `.crswap` staging) — but a "failed" save may have *committed and then failed its verification read*, so the answers files may hold the data at revision N+k with duplicate `valueHistory` entries. Only a workspace inspection settles it (see solution S-11).

## 3. The sufficiency ruling — say plainly which it is

**Adding `InvalidStateError` to `classifyFileSystemError` alone would have been a better label on the same failed save** — the user still fails, now under XQ-IO-036. That is not the fix and no returned model claimed it was. What actually makes the save **succeed** is the compound the working tree now implements: (a) the name added to `isTransientWriteError` so the write ladder retries `createWritable`/`close` in place; (b) all six read loops retrying it through the unified `readRetryDelayMs` with a **fresh handle → fresh snapshot** per pass (~1.53 s inner, × casLoop's outer fresh-snapshot attempts spans well past a ~10 s metadata-cache lifetime); (c) `fileSystemAccess.readAndParseJsonFile` getting its own fresh-handle ladder (it sits outside safeWrite); (d) the casLoop verify-throw no longer forging failures; and (e) — decisive for the feedback half — **removing the write from the read path entirely** (repair now opt-in from the panel only, cooldown 5 min, gated on the index actually being readable), which is what dissolves opus-feedback-index's net-negative concern (CP-2): the herd load is gone, not argued away by ladder arithmetic. The remaining fragility is the 9-pass amplification (latency/load, no longer correctness) and the residual gaps in §5.

## 4. State of the uncommitted changeset (supersedes the synthesis's §"Current state")

The synthesis's picture is **stale**. As inspected: 18 modified + 3 untracked files. Beyond what the synthesis listed, the tree now also contains: the **casLoop verify-throw fix + 2 tests**; **`errorName` end-to-end** (`PersistedErrorEntry`, `toPersisted`, `ERROR_EXPORT_HEADERS` "نوع الخطأ", export row, snapshot-first test updates) — XQ-F-06 is closed; the **whole feedback rework** (`readThreadsIndex` readable-flag closing XQ-F-08; `repairIndex` opt-in + `INDEX_REPAIR_COOLDOWN_MS` closing XQ-F-04/14; `createThread` index write caught closing XQ-F-10; widget passes `repairIndex:true` only on panel open; three new tests); the pinned-meanings map **already contains XQ-IO-036** (the synthesis's "one line from mergeable" is itself out of date); `memoryDirectory`'s `withReadFaults` guard now conditions on `wantsReadFaults` (Sonnet's dead-guard observation addressed, its 31-failure consequence refuted against this tree); and `useUnloadGuard` wired at `XrayReferrals.tsx:1076` (the browser-chrome half of XQ-F-07). New code/labels already present and correct per doctrine: **`XQ-IO-036`** (append-only, next free number) with label key **`err_io_036_stale_snapshot`**: «تغيّر الملف على المجلد المشترك أثناء قراءته أو حفظه، فتعذّر إتمام العملية رغم عدة محاولات. الملف سليم ولم يُفقد الوصول إلى مساحة العمل — أعد المحاولة بعد قليل، ويُفضّل ألا يُحفظ الملف نفسه من جهازين في الوقت نفسه.»

**Gate results on this exact tree (run by me):** `tsc -b` clean · `lint` clean · `test:run` 418 files / **3965/3965** · `build` clean. **What is still owed per CLAUDE.md before "done": the edit-log entry (none exists in `docs/edit logs/2026-08-25.md` for this change) with `--sync-package` (v122.0.0 → v122.1).**

## 5. What remains open (verified against the final tree) — the solution set

Residual gaps, each a numbered solution below: the repair write is still a **blind overwrite** (`updateThreadsIndex(dir, () => repaired)` at `feedbackStorage.ts:557` discards the CAS re-read — XQ-F-09); `appendReply`'s status-change index write (`:429–437`) still **fails the whole user-visible call** for a cache write after the reply landed durably (same class as XQ-F-10, unfixed instance); `updateThreadsIndex` is still the **only untuned casLoop** (defaults 10×200 ms) and has no `onExhausted` (XQ-F-12/15); the persisted log still names **no target/month/origin** (XQ-F-16/17); `staleSnapshot.test.ts` is **count-based only** (XQ-F-23, Sonnet's valid self-caveat); `readContent` still touches one snapshot **twice** even for files the 8 KB head window fully covered (S1 residue; `compressedEnvelope.ts:97`); the LRU-eviction hole in draft retention (XQ-F-07's in-app half); the widget's double reconcile (S7/XQ-F-21); and the docs drift (CLAUDE.md / `data-system-report.md` still say the index is "written only on create/status-change").

## 6. Solution design (P0 → P3) — see the structured `solutions` for exact code, tests, and risk

P0: land the changeset with its edit-log entry; make the repair write additions-only. P1: stop `appendReply` failing on the cache write; tune + instrument `updateThreadsIndex`. P2: forensics fields (`target`/`monthFolderName`/`origin`) through logger→sink→types→export; a wall-clock fault model + regression test; single-touch reads for ≤8 KB files; the incident post-mortem/runbook (including the CP-4 workspace inspection). P3: LRU pin for dirty tabs (doctrine-compliant alternative to a localStorage draft, which would put business data in browser storage and needs owner sign-off); widget single reconcile; docs sync.

**Explicitly do not:** raise `ANSWER_SAVE_MAX_RETRIES` above 14 or `DEFAULT_MAX_RETRIES` above 10 (85a965a already ran that experiment; the incident is its result); repurpose XQ-IO-032 (append-only catalog, pinned by `errorCodes.test.ts`); reword XQ-IO-032's label now that 036 intercepts this class (CP-5 resolved as *partly-correct* — the label is hedged «قد يكون», its wording is itself a documented prior correction at HEAD `labelsStore.ts:1372–1379`; only the remedy clause was ever questionable); cache `File` objects or parsed answers across attempts (inverts the bug class); implement per-item answer-file splitting (tier-3 data-format change overlapping the owner-gated Phase C/D sequence).

## 7. What cannot be fixed client-side (document, don't attempt)

1. **The SMB redirector's metadata caching itself.** `FileInfoCacheLifetime` / `DirectoryCacheLifetime` / `FileNotFoundCacheLifetime` are client-OS settings; the app can only ride them out with fresh-handle ladders (now does). An optional IT note may tune them on the four workstations; the app must keep working without it.
2. **True multi-writer serialization / atomic multi-file transactions** — requires a backend; already documented in CLAUDE.md's distribution section. CAS + append-only events remain the ceiling.
3. **Whether the 18 "failed" saves actually landed** (CP-4) — resolvable only by inspecting the workspace's answer files (S-11), not from code or logs.
4. **The `InvalidStateError` identification** is corroborated (fixed sentence, name-keyed behavior, all four models independently) but not provable from this repo; with `errorName` now persisted, the next occurrence is self-identifying.


---

## 8. What actually shipped (v122.1)

Every item below was implemented, tested and gated in this changeset. IDs are the register's
(§6) and Fable's (§7) — an item appearing in both is listed once.

### Root cause — the fault is now retried, classified and named

| # | Change | Files |
|---|---|---|
| XQ-F-01 | `InvalidStateError` → new error code **XQ-IO-036**, with an Arabic label that says what happened, what did NOT happen (the file is not damaged, the grant is not lost) and what to do | `errorCodes.ts`, `labelsStore.ts` |
| XQ-F-02 | `isSnapshotStaleError` added to `isTransientWriteError`, so `retryTransientWrite` retries the write path — `writeText` already re-opens the handle per attempt, so each retry takes a fresh snapshot | `transientFileErrors.ts` |
| XQ-F-03 | All **six** read paths in `safeWrite.ts` now share one `readRetryDelayMs` budget instead of six hand-written `isNotReadableError` branches, so this class can never again be fixed in five places out of six. `fileSystemAccess.ts`'s own read (login, sync) gets a matching ladder that retries ONLY the stale snapshot — never `NotFound`, which on a read means absent and must stay prompt | `safeWrite.ts`, `fileSystemAccess.ts`, `transientFileErrors.ts` |

The ladder is `[20, 60, 150, 400]` — deliberately the same shape as the existing write ladder, and
deliberately **not** longer. Fable and two analysts independently argued that a long inner ladder
multiplies against `casLoop`'s outer one (14 attempts on the answer path) and makes one machine
hold a contended file longer. The inner ladder's job is to absorb a blip without discarding the
whole read-modify-write cycle; the outer ladder owns the long tail.

### The second bug — the feedback index write storm (XQ-F-04)

A CAS **write** to the single shared `threads.index.json` ran on the **read** path, reached by
`FeedbackUnreadProvider` for every signed-in user, on every page, on mount, on focus, every 60 s,
and on every refresh broadcast. It could not converge: a repair that fails leaves the index exactly
as stale as it found it, so the next poll rediscovers the same ids and tries again. That is why a
manager sitting on `reports/kpi` appears in the logs writing a feedback file.

- The reconciliation still happens **in memory** on every read, so callers always get correct
  summaries. Writing it back is now opt-in (`{ repairIndex: true }`), requested only by the
  feedback panel — a deliberate action at human rate — and rate-limited per tab, with the failure
  logged **once** per cooldown rather than once per read.
- **XQ-F-08** — `loadThreadsIndex` mapped a *thrown* read failure to an empty index, so one blip
  became a read of every thread file plus a blind rewrite. Unreadable is now distinguished from
  absent, and an unreadable index is never rewritten from a reconstruction.
- **XQ-F-09 / Fable S-2** — the repair merged nothing: it passed `() => repaired`, discarding the
  fresh list `casLoop` had just re-read. It now merges.
- **XQ-F-10 / Fable S-3** — a failed write to a *rebuildable cache* no longer fails `createThread`
  or `appendReply`. The thread file is already durable; telling the user otherwise invited a
  duplicate message. The one cost — a possibly stale status chip until the next index write — is
  pinned by a test so it stays a contract rather than an accident.
- **Fable S-4** — `updateThreadsIndex` was the only untuned `casLoop` in the data layer, running
  the 10 × 200 ms user-content ladder on the most contended file in the workspace. Now 3 × 100 ms,
  with an `onExhausted` that records the raw cause.
- **Fable S-9** — opening the panel ran two overlapping reconciles of the same file from the same
  tab. Now sequenced.

### The false-failure bug (XQ-F-05 / Fable S1-confirmed)

`casLoop` ran the delayed `verify()` inside the outer `catch`, so a verify that **threw** was
treated as a detected lost update. It is not: the write had already passed its in-attempt read-back,
and a throw is no evidence either way. The old behaviour discarded a write that provably succeeded
and re-ran the whole cycle — adding another write to a share that had just failed a read. A
throwing verify now keeps the verified result and logs `casLoop:verify-inconclusive`; a verify that
*answers* `false` still retries, and a test pins both halves.

### Observability — why this took a full-stack read to diagnose (XQ-F-06, XQ-F-12)

- `logError` recorded `.message` and `.stack` but never `.name`. A DOMException's name is the only
  stable, non-localised thing about it, and is exactly what every classifier switches on — so the
  one field that would have named this fault was missing from the artifact meant to reveal it.
  `errorName` now flows through the ring, the durable per-user file and the admin XLSX export as a
  new «نوع الخطأ» column, next to the code rather than buried in a minified stack.
- All **31** `casLoop` call sites now pass a `context` label, so an exhaustion entry says which
  writer failed. Previously one site in ~25 carried any attribution, which is why `admin`'s single
  orphan entry in these logs is unattributable to this day.

### Data loss — the employee's typed answers (XQ-F-07 / Fable S-8)

A save that fails correctly *leaves* the draft in the panel and asks the user to retry. Three
things could then destroy it with no dialog: closing the tab, reloading, and the 3-tab mount LRU
evicting the view. The first two are now guarded by `useUnloadGuard`; the third by pinning a tab
that reports unsaved work, via a new `unsavedWorkRegistry`. Both are composed into one
`useUnsavedWork(tabId, hasUnsavedWork)` so a view states the fact once.

A `localStorage` answer draft was **deliberately not built**: inspection answers are business data,
and this repo's two-persistence-layers doctrine puts business data on the workspace side. That
would need an owner decision and a `storageRegistry.ts` key.

### Exposure per read (XQ-F-11 / Fable S-7)

`readContent` touched the same snapshot twice — once as a classification slice, once as `text()` —
with awaits in between, giving every small file read two chances at the fault instead of one. Its
own doc comment had always claimed otherwise. A file the 8 KB head window fully covers is now
decoded from that window, guarded on strict `byteLength === size`. One fewer byte-touch and one
fewer SMB round trip on the hottest read path in the app.

### Test infrastructure

`memoryDirectory` gained a `readFile` fault operation that fails the read of the `File` that
`getFile()` already returned — the real shape of this bug. Faulting `getFile` instead would test a
condition that never happens in production and would let a "fix" that reuses the already-stale
`File` pass.

### Deliberately NOT done

- **Widening any retry ladder.** Commit `85a965a`, the evening before the incident, had already
  widened the answer ladder to 14 × 150 ms for these exact failures; the incident happened under it.
  More attempts add write amplification to a share that is already the problem.
- **Redefining XQ-IO-032.** The catalog is append-only by doctrine and by test.
- **Fable S-5's extra forensic fields** (`target`, `monthFolderName`, `origin`) and **S-6**'s
  wall-clock fault model: both are genuine improvements and neither is needed to fix the incident.
  They are left as follow-ups rather than smuggled into a fix changeset.

### Gates

`lint` · `typecheck` · `test:run` **419 files / 3981 tests green** · `check:complexity` ·
`check:hex-literals` · `check:vendor` · `build` · `check:bundle-size`.
