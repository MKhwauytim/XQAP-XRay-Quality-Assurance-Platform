# X-Ray Quality Control App — Build Specification

**Version:** 0.10 (backup & full sync-hardening pass)
**Last updated:** 2026-06-14
**Status:** Daily backup (§11B), complete conflict/sync matrix (§11C), and disk layout for backups added; concurrency guarantees now enumerated and auditable. **§14 open questions Q1/Q3/Q5/Q6 resolved 2026-06-14** (CertScan = per-user license flag; folders = `MM-MonthName-YYYY`; replacement pool = configurable; auth = Argon2id + PBKDF2-600k fallback). Build decomposed into 8 phases; Phase 0 (platform spine) next.

> **Build vs. ship:** During development we use whatever helps (React, Vite, Node, TypeScript). The final shipped output must be plain HTML + JS + CSS — a portable self-contained build (e.g. via `vite-plugin-singlefile`).

---

## 1. Purpose

An Arabic, RTL-first, single-page React app (no server) that runs entirely in the browser against a folder on disk. It ingests raw X-ray scan data from two sources, processes it into a cleaned "population," draws a quality-control sample, distributes that sample to employees for monthly review, and tracks the full lifecycle of every assigned row — including reassignments between employees — with a complete audit trail.

All business data lives on disk as JSON (the source of truth) mirrored to Excel for humans. Nothing of substance is stored in the browser except the login session and the permission matrix.

---

## 2. Hard constraints (non-negotiable design rules)

- **Must use the File System Access API.** The app reads and writes a user-chosen workspace directory. This makes it Chromium-only (Chrome/Edge). No fallback.
- **No browser-side business data.** Population, samples, distribution, answers, and audit logs are JSON files on disk. Browser storage is limited to auth session and the role→permission matrix.
- **JSON is the source of truth; Excel is a human-facing mirror.** Every exported workbook's first sheet is a plain-language description of what the data is and which processing steps were applied.
- **Append-only history.** Original distributions and prior study work are never overwritten. Ownership changes and re-work are layered events on top of immutable records.

---

## 3. Top-level navigation (sections)

| # | Section | Arabic (working) | Who can reach it |
|---|---------|------------------|------------------|
| 1 | Population Processing & Sample Distribution | معالجة المجتمع وتوزيع العينة | edit-Population roles |
| 2 | Employee & Permission Management | إدارة المستخدمين والصلاحيات | admin |
| 3 | Employee Workspace | مساحة عمل الموظف | every authenticated user (scoped to self) |
| 4 | Data Archive (all saved data, browsable) | الأرشيف | view/edit per role |
| 5 | Template Builder | منشئ نموذج الدراسة | admin (see §10A) |

Section 4 is not a separate data store — it is a browser/explorer view over the workspace folder so users can open any month, any phase, any export without leaving the app.

---

## 4. Roles & permissions

Three roles, two enforcement layers (allowed-roles per section + a role→action matrix).

| Role | Arabic | Baseline capability |
|------|--------|---------------------|
| employee | موظف | See and complete only samples assigned to them; request reassignment |
| supervisor | مشرف | All of employee, plus: approve/deny reassignment requests, directly reassign any row as they see fit, view all employees' progress |
| admin | إدارة | Everything, plus: run monthly population, manage users & permissions, configure visible columns |

**Decided rules:**

- A new monthly population run (create month folder, upload, process, distribute) can be triggered by **Admin + Supervisor**.
- Reassignment has two paths:
  - **Employee-initiated** → creates a request → requires supervisor approval.
  - **Supervisor-initiated** → direct move, no approval needed.
- Column visibility in the Employee Workspace is configurable by admin (and anyone with the right permission): the admin chooses which population columns an employee can see for their assigned rows.
- **Per-user CertScan license (✅ §14 Q1):** the user record carries a `hasCertScanLicense` boolean set at create/edit time. Only licensed users are eligible to receive CertScan rows in distribution (§8, §13.5 Step 4).

---

## 5. Persistence model

### 5.1 Browser storage (auth & permissions only)

Password hashing (corrected per 2026 OWASP guidance — researched):

- **Preferred:** Argon2id via a WASM build (OWASP's 2026 default for new systems), baseline params `m=19 MiB, t=2, p=1`. Memory-hard → far better GPU/ASIC resistance.
- **No-dependency fallback:** PBKDF2-HMAC-SHA-256 at ≥ 600,000 iterations (the 2026 OWASP minimum; the old spec's 210k is only valid for SHA-512). 16-byte random salt per user, 32-byte output, all via WebCrypto.
- Store the algorithm + params alongside each hash so work factors can be raised later with a login-time re-hash. A bootstrap admin ships as a hash (not plaintext).
- Session → `sessionStorage`. Managed users + permission matrix → `localStorage`, with live cross-component updates via a custom DOM event.

**Honest scope note:** this is local, in-browser auth with no server to verify against. It gates the UI and segregates roles for a trusted internal team; it is not a defense against a determined attacker who already has the workspace files and can edit JSON directly. For this internal tool that is an acceptable, stated tradeoff — but it should be written down, not implied (see §16.4).

### 5.2 Workspace folder on disk (all business data)

Every file is a `JsonEnvelope`:

```json
{ "metadata": { "schemaVersion": 0, "revision": 0, "contentHash": "", "updatedAt": "", "updatedBy": "" }, "data": {} }
```

Revision-based optimistic concurrency + lock files under `.system/locks/`, because multiple users may share the folder over a network drive. All mutations append to `.system/audit/`.

---

## 6. Folder layout on disk

```
Data/
├── Population/
│   └── 5-May/                        ← one folder per monthly run (MM-MonthName[-YYYY])
│       ├── month.manifest.json       ← what this month is, who ran it, when, settings, templateVersion, RNG seed
│       ├── raw/
│       │   ├── risk.original.xlsx    ← verbatim uploaded file, byte-for-byte
│       │   ├── risk.raw.json         ← parsed-but-unprocessed rows (unified schema)
│       │   ├── bi.original.xlsx      ← verbatim uploaded file (optional source)
│       │   └── bi.raw.json
│       ├── processed/
│       │   ├── risk.processed.json   │  risk.processed.xlsx       (1st sheet = description)
│       │   ├── bi.processed.json     │  bi.processed.xlsx         (1st sheet = description)
│       │   └── population.final.json │  population.final.xlsx     (1st sheet = description)
│       ├── sample/
│       │   ├── sample.master.json        ← the drawn sample (immutable once drawn)
│       │   ├── distribution.events.json  ← APPEND-ONLY log (see §9)
│       │   ├── distribution.current.json ← derived snapshot (replay of events)
│       │   ├── reassign.requests.json    ← pending/approved/denied employee requests
│       │   └── employee-answers/
│       │       ├── ahmed.json        ← Ahmed's answers FOR THIS MONTH only (append-only, §10/§11A)
│       │       ├── sara.json
│       │       └── {employeeId}.json ← one file per employee assigned this month
│       └── reports/
│           └── phase-report.html
├── templates/
│   ├── template.v1.json              ← versioned study templates (append-only, §10A.5)
│   ├── template.v2.json
│   └── template.current.json         ← pointer to the live version
└── .system/
    ├── users.permissions.json        ← managed users + permission matrix (mirror of localStorage)
    ├── locks/                         ← advisory lock files (§11A.6 Tier 2)
    ├── audit/                         ← append-only audit log of all mutations
    └── backups/                       ← daily backups (§11B)
        ├── index.json                ← manifest of completed backups (single source of truth)
        ├── claim-2026-06-14.lock      ← single-winner daily claim (§11B.2)
        ├── daily-2026-06-14.partial/  ← in-progress snapshot (renamed on completion)
        └── daily-2026-06-13/          ← a completed snapshot, mirroring the live tree
```

**One file per employee, per month.** Each month folder owns its own `employee-answers/` set. An employee who worked Feb and May has `2-Feb/sample/employee-answers/ahmed.json` and `5-May/sample/employee-answers/ahmed.json` — two independent files. Benefits:

- A month's work is fully self-contained in that month's folder (easy to archive, copy, audit, or hand off a single month).
- Files stay small and bounded — they never grow across months.
- Per-writer isolation (§11A) holds per month: still exactly one writer per file.
- A file is created lazily the first time that employee saves work for that month (no empty files for unassigned employees).

Two clarifications captured from discussion:

- **"Raw, as uploaded" is stored two ways:** the verbatim original workbook (`*.original.xlsx`) AND the parsed-unprocessed rows (`*.raw.json`). The first answers "what did they hand us," the second is what the pipeline actually consumes.
- The Excel mirrors (`*.processed.xlsx`, `population.final.xlsx`) each carry a leading description sheet documenting the data and the processing steps applied.

---

## 7. Population processing pipeline

(Carried over from the existing `populationProcessor.ts`, unchanged in logic.)

1. **Drop invalid X-ray IDs** — blank/error, IDs starting with `RMI`/`XRA`, or shorter than 4 chars.
2. **Deduplicate** by normalized X-ray ID.
3. **BI enrichment** — if BI source provided, match rows by `xrayImageId | portName` and fill *only empty* fields (entry date, port type/name, declaration #/date, plate/container, chassis, level-1/level-2 results). Track per-field fill summary + percentages.
4. **Validate results** — normalize level-1 and level-2 results to سليمة (clean) / اشتباه (suspect); drop rows missing either.
5. **CertScan classification** — group pasted CertScan list by port; mark each row `Certscan` or `NonCertscan` by testing whether the cleaned X-ray ID contains a serial snippet for that port.
6. **Emit** prepared rows + removed/duplicate/invalid buckets + a rich summary (counts, percentages, BI match %, CertScan %).

### 7.1 Excel reading correctness (researched — fixes a real bug in your data)

Your sample data showed declaration-number cells rendered as long runs of `#` — that is Excel's "column too narrow" display artifact, meaning the real value is a number the exporter never widened. Two SheetJS rules prevent silently ingesting garbage:

- **Read the raw cell value (`.v`), not the formatted text (`.w`).** Code that reads `.w` picks up display artifacts like `###...` and locale formatting. The pipeline must read the underlying value.
- **Read long IDs as strings to preserve precision.** X-ray image IDs (14–16 digits) and declaration numbers exceed JavaScript's safe integer range; parsed as numbers they become exponential (`1.23457e+18`) — silent, irreversible corruption of an identifier. Force these columns to text on read so the full digit string survives.
- **Normalize on read:** trim, treat Excel error strings and the `###` artifact as empty, and log any cell that looked like data but resolved empty, so it surfaces in the mini-report rather than vanishing.

---

## 8. Sampling & CertScan capacity

- Population splits into two systems: **Certscan** and **NonCertscan**.
- Currently 4 employees, 2 CertScan licenses.
- Operator chooses a CertScan share of the sample (e.g. 25% / 50%), variable per run.
- **License enforcement (✅ resolved §14 Q1 — per-user attribute):** each managed user carries a `hasCertScanLicense` boolean, set by the admin when creating/editing the user (§4). Distribution routes CertScan rows **only** to licensed users; unlicensed users never receive CertScan rows. There is no separate numeric cap — the "2 licenses" is simply however many users are flagged. The reassignment "I hold no license" path (§11) keys off this same flag.

---

## 9. Distribution as an append-only event log

`sample.master.json` is frozen once the sample is drawn. Distribution is not a one-shot batch — it supports multiple waves over time, including assigning samples for an old month months later.

`distribution.events.json` is an ordered, append-only list. Event types:

| Event | Trigger | Approval | Effect |
|-------|---------|----------|--------|
| INITIAL_DISTRIBUTION | monthly run | n/a | first assignment of sampled rows to employees |
| NEW_WAVE | admin/supervisor | n/a | assign additional rows later (new draws OR re-distribution of already-sampled rows — both supported) |
| EMPLOYEE_REQUEST | employee | needs supervisor | proposes moving their CertScan rows to a chosen colleague |
| REQUEST_APPROVED / REQUEST_DENIED | supervisor | n/a | resolves a request |
| SUPERVISOR_REASSIGN | supervisor | none | direct move of any rows to any employee |
| REPLACEMENT | employee (Store & Replace) | none | swaps an unstudyable row for a new draw (same stage, else highest-supply stage); logs reason |

Each event records: `eventId`, `timestamp`, `actor`, `affected rowIds`, `fromEmployee`, `toEmployee`, optional `reason`, and (for requests) `status`.

`distribution.current.json` is a derived cache — replay the events to get the current owner of every row. This is what gives you both: "who was this originally assigned to?" (read the INITIAL_DISTRIBUTION event) and "who owns it now and why?" (replay to head).

---

## 10. Study work: stacked layers per row

**Decided:** when a row is reassigned, the new owner sees prior work read-only, then continues with a fresh layer. So a row's answer is not one editable blob — it's a stack.

In `employee-answers/{employeeId}.json`, each assigned row holds an ordered list of work layers:

```
rowId → [
  { layerId, owner: emp1, status: "partial", data: {...}, frozenAt: <ts> },   // read-only after handoff
  { layerId, owner: emp2, status: "in-progress", data: {...} }                // active
]
```

- When ownership transfers, the outgoing owner's layer is frozen (read-only) and a new empty layer is opened for the incoming owner.
- The incoming owner can read all prior layers but edits only their own.
- This behaves identically whether the row is a brand-new draw or a re-move of an already-sampled, already-worked row.

---

## 10A. The study template (schema-driven, admin-built, versioned)

The study form is not hardcoded. It is a schema stored as data in the workspace, edited by admins through a builder UI, and rendered dynamically by the employee form.

### 10A.1 Two layers — population columns vs. template fields

Do not confuse them:

- **Population columns** (read-only, from master): المستوى, رقم صورة الاشعة, تاريخ ووقت الدخول, نوع المنفذ, اسم المنفذ, رقم البيان, تاريخ البيان, رقم الشاص/الحاوية, رقم اللوحة, نتيجة المستوى الأول, نتيجة المستوى الثاني. The employee sees these (subject to column permissions) but never edits them — they are resolved live from master (§11A.2).
- **Template fields** (the answer): what the employee fills. These are the only thing stored in the employee's answer layer `data: {...}` (§10).

### 10A.2 System-managed fields (app fills automatically)

- **خبير الجودة** = the logged-in employee (auto).
- **تاريخ رصد الخبير** = the completion timestamp (the same ROW_COMPLETED time that feeds working-days/pace, §12.3.1).
- **الاكتمال** = auto-derived: مكتمل when all required, currently-visible fields are filled, else غير مكتمل. A hidden conditional field is not counted as required. Employee never sets this by hand. Drives Store & Replace (§13.3) and مفحوصة/غير مفحوصة (§12.3.3).

### 10A.3 Default template (from the provided sheet)

Phases and fields, as a starting template (admin can change all of it):

**Phase 1 — جودة الصورة (Quality of X-ray):**

| Field | Type | Notes |
|---|---|---|
| هل يوجد صورة؟ | dropdown / yes-no | |
| هل يوجد تحديد؟ | dropdown / yes-no | |
| مستوى جودة الصورة | dropdown | عالي / متوسط / منخفض |
| أسباب انخفاض الجودة | dropdown + "other" text | conditional: shows only when جودة = متوسط/منخفض |
| ملاحظات | text | always present (added per your note) |

**Phase 2 — جودة النتيجة (Quality of answer):**

| Field | Type | Notes |
|---|---|---|
| صحة النتيجة | dropdown | e.g. سليمة / اشتباه |
| تقييم الاشتباه | dropdown | عالي / متوسط / منخفض |
| الأصناف المشبوهة | text / multi-select | |
| آلية التهريب المحتملة | text | |
| الملاحظات العامة | text | |

### 10A.4 Field schema (what the builder produces)

Each field is a record:

```
{
  fieldId, labelAr, phaseId,
  type: "text" | "number" | "date" | "dropdown" | "multiselect" | "checkbox" | "yesno",
  options: [...],                 // for dropdown/multiselect
  required: true|false,
  allowOther: true|false,         // adds a free-text "أخرى" to option lists
  visibleWhen: { fieldId, equals: <value> } | null,   // conditional display
  order
}
```

A phase is `{ phaseId, labelAr, order, fields: [...] }`. The template is an ordered list of phases. Admin can add/remove fields, add/reorder phases, set types, options, required, and conditional rules — all through the builder, no code.

### 10A.5 Versioning (decided: old months keep their template)

- Editing the template creates a **new template version** (`template.vN.json` in the workspace, append-only — old versions are never mutated).
- Each month records its `templateVersion` in `month.manifest.json`. A month studied under v3 always renders and validates against v3, even after the live template moves to v5.
- This keeps historical answers aligned to the exact fields they were captured with; reports (§12) read each month's answers against that month's template version.

### 10A.6 Rendering & validation

- The employee form renders dynamically from the month's template version, grouped by phase, honoring `visibleWhen` (conditional fields appear/disappear live).
- `required` + visibility drive الاكتمال (§10A.2). Validation runs before ROW_COMPLETED.
- The answer `data: {...}` stored per layer (§10) is a flat `{ fieldId: value }` map keyed by the template version's field IDs.

---

## 11. Employee Workspace (Section 3)

- Employee logs in and sees only rows they currently own (from `distribution.current.json`).
- For each row they see only the columns admin permitted.
- They fill a study template (rendered from the month's template version).
- If they find a row is actually CertScan and they hold no license, they raise an EMPLOYEE_REQUEST to hand those rows to a chosen colleague; a supervisor approves/denies.
- Prior owners' layers (if any) are visible read-only.

---

## 11A. Concurrency & conflict management (shared network folder)

Multiple employees open the same HTML app against the same workspace folder on a network drive. The design eliminates conflicts by construction rather than by locking, using event-sourcing with per-writer files.

### 11A.1 The single rule that prevents all corruption

**No file ever has more than one writer.**

- Master data is read-only for all employees: `population.final.json`, `sample.master.json`, `distribution.*.json`. Only the monthly-run / supervisor process writes these.
- Each employee writes only their own file, scoped to the month: `{month}/sample/employee-answers/{employeeId}.json`. An employee assigned in several months has one independent file per month — never a shared, ever-growing file.
- Because two employees never write the same file, write-write conflict cannot occur. No lock contention, no last-write-wins data loss.

### 11A.2 Reference, never copy (the critical refinement)

When an employee studies a row, their file stores only the answer + the master row ID it answers — never a copy of the row's source data.

- Row data is read live from the read-only master at display time and stitched together with the employee's answer.
- This means a master correction (typo fix, re-enrichment) is reflected everywhere instantly; there is no stale duplicate to drift out of sync.
- ❌ Do not copy `{ xrayId, port, declaration, ... }` into the employee file.
- ✅ Store `{ rowId, answer: {...}, status, timestamps }` and resolve `rowId` against master.

### 11A.3 Each employee file is append-only

`employee-answers/{employeeId}.json` is an append-only event log, not a rewritten blob. Each save appends an event (ANSWER_SAVED, ROW_COMPLETED, REPLACEMENT, etc.).

- Every event records a timestamp (date + time) and the actor. ROW_COMPLETED timestamps are the source of truth for working-days and pace metrics (§12.3.1–12.3.2).
- An interrupted save can at worst lose the last appended event, never the whole file.
- The employee's current state is derived by replaying their own log — same pattern as the distribution log (§9) and the stacked layers (§10).

### 11A.4 The "overall system" view is derived, not stored

The unified picture (who studied what, completion %, KPI) is computed at read time by merging every employee's log over the read-only master. It is never a file anyone writes concurrently. Optionally cached to `.system/` by a single process (a report run), never by employees.

### 11A.5 Staleness is the only residual effect — and it's safe

On a network drive, employee B may see employee A's just-saved work a few seconds late (OS/FS caching). Because masters are read-only and writers are isolated, the worst case is a delayed refresh, never lost or corrupted data. A manual/auto "refresh" re-reads the folder. This is the graceful-degradation property the whole design is built to guarantee.

### 11A.6 Two-tier locking — and a critical boundary (researched)

The naive "lock files on disk" idea has a real limitation that the research surfaced, so the model uses two different lock mechanisms for two different scopes:

**Tier 1 — same machine, multiple tabs → Web Locks API (`navigator.locks`).**

- Baseline-available in all Chromium browsers since 2022; coordinates exclusively within one origin on one machine. If a user opens the app in two tabs, Web Locks guarantees only one tab writes a given resource at a time (leader-election pattern).
- Use it to serialize this user's own writes and to elect a single "primary tab" for any background refresh.

**Tier 2 — different machines, shared network drive → advisory lock files + revisions.**

- ⚠️ Web Locks does NOT span machines. Two different computers on the same network share no lock manager. For cross-machine safety we rely on:
  - the per-writer file design (§11A.1) — the primary guarantee; employees never contend because they never share a file, so cross-machine locking is mostly moot for the employee path;
  - advisory lock files under `.system/locks/` + revision checks (§5.2) for the rare multi-writer resources (master writes, distribution log appends by supervisors/admins). These are best-effort on network drives — see Tier-3 caveat.

**Tier 3 caveat — atomic rename is not guaranteed on network filesystems (researched).**

- The safe-write standard is write temp file → atomic rename over target. The File System Access API's `createWritable()` already does temp-file-then-commit. But atomic rename can fail or even corrupt on some network/remote filesystems (documented behavior).
- Mitigation built into the write layer (§16.3): always write a `.bak` snapshot before overwriting, validate JSON on read, and if a file is unparseable, fall back to `.bak` and surface a recovery prompt — never silently overwrite good data with a half-write.

**Net:** the no-corruption guarantee rests primarily on per-writer isolation (which needs no locking at all), with Web Locks handling same-machine multi-tab and advisory files + backups + read-validation covering the rare shared-write paths and network-drive quirks. Staleness (§11A.5) remains the only normal-operation side effect.

---

## 11B. Daily backup & sync hardening (multi-user, researched)

**Goal (your spec):** the first employee to open the app on a given day triggers one daily backup; subsequent openers that day do nothing. Any single opener is enough. The challenge is that "check if today's backup exists, else create it" is a classic race — if four people open at 8:00 AM, all four can see "no backup yet" and all four start writing.

### 11B.1 The honest constraint (researched)

There is no perfectly atomic claim across different machines available to a browser writing to a shared network folder. Browser/OS file locks, the Web Locks API, and `createWritable({ mode: 'exclusive' })` all coordinate within one machine only. So the design is a layered best-effort claim plus an idempotent, self-healing backup so that even a lost race produces at worst a harmless duplicate — never corruption or a missing backup.

### 11B.2 Atomic-ish claim via exclusive file creation

The closest thing to an atomic claim on a filesystem is "create a file that must not already exist." The backup routine:

1. Compute today's key, e.g. `2026-06-14`.
2. Check `.system/backups/` for `daily-2026-06-14/` (or a `claim-2026-06-14.lock`).
3. If absent, attempt to create a claim file using exclusive semantics (`getFileHandle(name, {create:true})` then immediately open `createWritable({ mode:'exclusive' })`; on this machine a competing opener gets `NoModificationAllowedError` and backs off). Write the claimant's id + timestamp into it.
4. Whoever wins the claim performs the backup; losers skip. This collapses the same-machine race completely and massively narrows the cross-machine window (two different PCs creating the identical path within milliseconds is rare on a human-cadence app-open event).

### 11B.3 Idempotent + self-healing (covers the residual cross-machine window)

Even if two machines both believe they won:

- The backup writes to a temp folder first (`daily-2026-06-14.partial/`), then renames to the final name only on completion. A second writer finding the final name already present aborts and discards its temp.
- Backups are content-addressed / timestamped so a duplicate is a distinct, harmless folder, never an overwrite of a good one.
- A manifest (`.system/backups/index.json`, itself written via the §16.3 safe-write + Web Lock) records each completed backup. The "does today have a backup?" check reads this manifest first; the file-existence check is the backstop.
- If a `.partial/` folder is found that's older than a threshold (a crashed backup), it's cleaned up on the next run.

### 11B.4 What gets backed up

A daily backup is a full snapshot copy of the workspace business data: all month folders' JSON (masters + every `employee-answers/*.json`), the template versions, the permission file, and the audit logs — written under `.system/backups/daily-YYYY-MM-DD/` mirroring the live tree. Excel mirrors can be regenerated, so backups store the JSON source of truth (smaller, faster); Excel is optional in the snapshot.

### 11B.5 Retention & restore

- **Retention:** keep N daily backups (configurable, e.g. 30), plus optionally promote the first backup of each month to a longer-kept "monthly" tier. Pruning runs as part of the same single-winner daily routine.
- **Restore:** an admin-only action that previews a chosen snapshot and restores it into a new timestamped workspace path (never blind-overwriting the live tree), so a restore is itself reversible.
- **Manual backup:** an admin can force an extra backup anytime (same idempotent routine, a distinct timestamped folder).

### 11B.6 Local resilience copy (optional, recommended)

Independently of the shared-folder backup, each client can keep a small IndexedDB mirror of the user's own unsaved/in-flight work (their answer log), so an accidental tab close, network blip, or external file change is recoverable on next launch. This is a per-user safety net, not a substitute for the daily workspace backup.

### 11B.7 Summary of the guarantee

- **Same machine, many tabs:** fully serialized (Web Locks + exclusive create).
- **Different machines, same day:** at most one backup in the overwhelmingly common case; in the rare simultaneous-millisecond case, a harmless duplicate, never corruption, never a missed day.
- Every backup write uses the §16.3 safe-write layer (temp + `.bak` + validate), so a crash mid-backup cannot corrupt either the live data or a prior backup.

---

## 11C. Complete conflict & sync resolution matrix

Every concurrency scenario the app can hit, and how it's resolved. This is the auditable summary of §11A–§11B.

| # | Scenario | Resolution | Residual risk |
|---|----------|------------|---------------|
| 1 | Two employees edit their own answers at once | Per-writer files (§11A.1) — no shared file exists | None |
| 2 | One employee opens the app in two tabs | Web Locks serializes writes; one primary tab (§11A.6 T1) | None |
| 3 | Employee B reads while A is mid-save (same file, network) | A writes temp→commit; B either sees old or new, never half (§16.3) | Brief staleness (§11A.5) |
| 4 | Master typo-fix while employees are studying | Employees reference rowIds, read master live (§11A.2); answers don't break | Staleness until refresh |
| 5 | Supervisor reassigns a row mid-study | Answer stays attached as a frozen layer (§10); ownership log is single-writer (§9) | Momentary owner/answer skew, resolved on replay |
| 6 | Two supervisors append to the distribution log at once | Advisory lock + revision check (§5.2/§11A.6 T2); second retries | Rare retry, no loss |
| 7 | Crash/power-loss mid-write | `.bak` snapshot + read-validation + restore (§16.3) | Lose only the last un-committed event |
| 8 | Four employees open app at 8AM → daily backup race | Exclusive-create claim + idempotent temp→rename (§11B.2–3) | At worst a harmless duplicate folder |
| 9 | Backup crashes halfway | Writes to `.partial/`, renamed only on completion; stale partials cleaned next run (§11B.3) | None to live data |
| 10 | Network drops mid-session | IndexedDB local mirror of in-flight work (§11B.6); resume on reconnect | User re-saves last action |
| 11 | Stored workspace handle permission revoked | Re-prompt/re-pick on launch (§16.2) | User re-grants once |
| 12 | Two months both named 5-May (different years) | Year in folder name (§14 Q3) makes scope unambiguous | Must adopt the naming rule |
| 13 | Concurrent edits to the permission matrix | Single admin surface + safe-write + Web Lock; mirrored to `.system/` | Rare retry |
| 14 | Large population blocks the UI during processing | Parse/sample in a Web Worker off the main thread (§16.5) | None (progress shown) |

**Design philosophy across all 14:** prefer eliminating contention (per-writer files, single-writer logs) over managing it; where contention is unavoidable, make the operation atomic-where-possible + idempotent + validated, so the worst realistic outcome is a retry, a refresh, or a harmless duplicate — never silent corruption or lost work.

---

## 12. Reporting

`reportDataBuilder → reportHtmlBuilder → reportExporter` produce standalone HTML reports. There are four report families, and every one of them carries a scope selector (see §12.5): single month, quarter, custom range, or all-time. Scope only changes which month folders are pulled into the merge — the rest of each report's logic is identical regardless of scope.

### 12.1 Population report

A single report with a source selector to view any one of:

- BI population after processing
- Risk population after processing
- The appended both-sources population
- The sample drawn from the population

### 12.2 Findings report

Aggregates what employees actually found, grouped by the template's phase-2 fields (جودة النتيجة): distribution of صحة النتيجة, تقييم الاشتباه, common الأصناف المشبوهة and آلية التهريب المحتملة, plus phase-1 quality findings (جودة الصورة levels and أسباب انخفاض الجودة). Because templates are versioned (§10A.5), the report aggregates each month against its own template version, mapping equivalent fields across versions where field IDs match.

### 12.3 Departmental / Management report (التقرير الإداري)

This is the management composite — the leadership-facing report that stitches panels from the other report families together, and exports as a single standalone HTML deliverable (composite view + standalone export, both supported).

Contents (mapped from التقرير الإداري description):

| Panel (Arabic) | Meaning | Data source |
|----------------|---------|-------------|
| مقارنة بين المجتمعات لكل شهر | population comparison month-over-month | §12.1 + §12.5 cross-month |
| مقارنة بالعينة المدروسة للمستويات | studied-sample comparison across stages 2–4 | §13 KPI |
| متابعة المؤشر | KPI tracking/follow-up | §12.4 |
| العينة المدروسة لكل شهر | studied sample per month | §12.4 + §12.5 |
| أداء كل موظف: المفحوصة / غير المفحوصة | per-employee studied vs. unstudied counts | per-employee logs (§11A) |
| عدد الإحالات | reassignment count per employee | §9 distribution events |
| متابعة أيام العمل | working-days tracking | §12.3.1 (derived) |
| المتوسطات في اليوم والأسبوع | daily/weekly studied averages + target pace | §12.3.2 (derived) |

#### 12.3.1 Working days (derived from study timestamps — no separate input)

Every completed study records its date and time in the employee's answer log (§11A.3).

- An employee's working days = the distinct calendar dates on which they completed ≥ 1 study.
- Weekend / overtime work is captured automatically — a Friday with a completed study counts as a working day for that employee.
- Performance is measured per actual working day, never per assumed calendar.

#### 12.3.2 Averages and target pace (burndown)

Two distinct metrics:

- **Actual rate** — samples studied per day and per week, from completion timestamps. Daily rate = studied-on-day ÷ (running denominator of studied/total as desired).
- **Required pace (burndown)** — given a goal to finish the sample in N days (a parameter you set, e.g. 20), required per day = remaining samples ÷ remaining days.
- The panel shows, per employee and for the department: required X/day vs. actual Y/day → ahead/behind by Z, so leadership sees who will miss the deadline.
- N (the target window) is configurable per month/run.

#### 12.3.3 Per-employee performance

For each employee, over the selected scope (§12.5): studied (مفحوصة) count, unstudied / unstudyable count, replacements issued, reassignments given/received (عدد الإحالات), working days, actual daily/weekly rate, and pace vs. target.

### 12.4 KPI report (for the KPI team)

HTML report plus a companion Excel workbook with two sheets:

- **المجتمع** — the population after processing.
- **العينة** — every row fully scanned and studied (all stages together; see §13).

The KPI report carries a toggle: all studied samples vs. only the 6250 required.

### 12.5 Time-range aggregation (cross-month reporting)

The app can read all month folders and produce a report over any scope:

| Scope | Meaning |
|-------|---------|
| Single month | one folder (e.g. `2-Feb`) |
| Quarter | the 3 month folders in that quarter |
| Custom range | any from/to span of months |
| All-time | every month folder under `Population/` |
| Multiple selected | an arbitrary hand-picked set of months |

**How aggregation works** (single operation, scope just sets the folder set):

1. Discover month folders in scope by parsing folder names (`MM-MonthName[-YYYY]`).
2. For each folder, read its read-only master (`population.final.json`, `sample.master.json`, `distribution.current.json`) and every `employee-answers/*.json`.
3. Merge answers over master by `rowId` (reference-not-copy, §11A.2), replaying each employee's append-only log (§11A.3) to get per-row current state.
4. Compute the report's metrics over the merged set (KPI math filters stages 2–4, §13).
5. Render/export as HTML and, for the KPI family, the two-sheet Excel.

**Properties this relies on:**

- The fan-out is read-only across all folders → safe to run anytime, by anyone, with no locking and no interference with employees still working (§11A).
- Per-month KPI numbers are additive — a quarter total is the sum of its months, because each month's 6250 goal and stage allocation are self-contained. (Spillover, §13.2, is computed within a month at sample-draw time, so cross-month totals just add up.)
- A combined export can present either one consolidated report across the whole scope, or a per-month breakdown within one document — the user chooses (consolidated vs. itemized).

**Cost note:** all-time reports fan out over every month folder. Folders are small JSON, so this is cheap, but the report layer should read folders lazily/streamed and may cache a derived roll-up in `.system/` (written by the single report process, never by employees).

---

## 13. KPI logic (the core measurement)

### 13.1 The KPI

- Rows carry a stages column: stage 1, 2, 3, 4.
- Stage 1 is mandatory and uncapped — all received stage-1 data must be studied, and it sits outside the 6250 goal (excluded from KPI math, but still present in العينة).
- Monthly KPI floor = 6250, correctly distributed across stages 2–4.
- Target split: 40% stage 2 (2500), 30% stage 3 (1875), 30% stage 4 (1875).
- We typically draw more than 6250; the floor is a minimum, not a cap. The KPI report toggle decides whether we measure against all studied or only the required 6250.
- العينة sheet and KPI report include all stages together; the KPI completion math simply filters to stages 2–4.

### 13.2 Spillover allocation (supply-aware, deterministic)

The 40/30/30 split is a target, not a hard rule. When a stage's population can't supply its target, take all available and redistribute the shortfall across the remaining stages proportional to their remaining capacity (leftover available supply).

Confirmed by the prototype query (Redistribute): weighting is by **RemainingCapacity**, i.e. how many rows each stage still has free — not by the original 40/30/30 target weight. This is the supply-aware rule.

**Rules:**

1. Compute each stage's target from the split (40/30/30 of 6250).
2. If a stage's available supply < its target → take all available; compute its shortfall (= total Gap to the sample size).
3. Find eligible stages: TargetPct < 1 (i.e. not the protected stage) and RemainingCapacity > 0.
4. Redistribute the gap across eligible stages, each receiving `RoundExact(Gap × RemainingCapacity / Σ RemainingCapacity)`, capped at its own capacity.
5. If a receiving stage hits its ceiling, recurse — recompute the gap and remaining eligible stages, redistribute again, until the gap is closed or no eligible stage remains.
6. Record any unmet remainder (sample short of 6250 because total supply was insufficient).

**Worked example:**

- Targets: stage2 = 2500, stage3 = 1875, stage4 = 1875.
- Stage 2 supply only 2000 → take 2000, gap = 500.
- Eligible = {stage3, stage4}; weight by their remaining capacity. If stage3 has ~500k free and stage4 ~20k free, stage3's capacity share is ~96% → it absorbs ~480, stage4 ~20, each capped at its own supply. Recurse if either caps out.
- Final allocation sums to 6250 unless total supply is short.

### 13.3 Unstudyable rows → "store & replace"

At study time the employee fills the template, then presses a **Store & Replace** button:

- Commits all rows they successfully studied.
- For every row they could not study, logs the failure reason and issues a replacement row.

**Replacement draw rule:** the replacement comes from the same stage as the dead row. If that stage is exhausted or can't supply, draw from the stage with the highest available percentage (same supply-aware cascade as §13.2). Logged as a REPLACEMENT event in `distribution.events.json` (see §9), preserving the post-spillover stage balance.

### 13.4 Visibility of replaced/unstudyable rows

Governed by the same permission matrix — no special case:

- Admin / supervisor / anyone permitted: the original row stays visible with `status: replaced` and its failure reason.
- An employee not permitted to see replaced rows stops seeing the row once it's swapped out.

### 13.5 Full sampling algorithm (rebuilt from the prototype query)

The existing Power Query `Audit_Sample`/`REF_Sample` logic is the reference. The rebuild keeps its good ideas and fixes three real defects. Pipeline:

**Step 1 — Group by stage (المستوى) and assign target %.** Map each stage to its parameter: `FIRST_STAGE → Stage1`, `SECOND_STAG → Stage2`, `THIRD_STAGE → Stage3`, `FORTH_STAGE → Stage4`. (Note the source's spelling: `SECOND_STAG`, `FORTH_STAGE` — preserve exact matching.)

**Step 2 — Peel off protected stages (TargetPct = 1).** This is how stage 1 is handled: target 100% → take all rows, tag CertscanFlag, set aside, and recombine at the very end. It bypasses all sampling/allocation math and is excluded from the 6250 goal (§13.1).

**Step 3 — Allocate the 6250 across normal stages** using §13.2 (capacity-weighted spillover, recursive).

**Step 4 — Within each stage, split Certscan vs NonCertscan.**

- `CertTarget = RoundExact(StageTarget × CertScanShare)`.
- Take `min(availableCertscan, CertTarget)`; any unmet Certscan demand spills into the NonCertscan target (`FinalNonCertTarget = NonCertTarget + Spill`).
- CertScanShare is configurable: per-stage OR global across the whole 6250 (toggle per run). Global mode computes one Certscan target against the full sample and distributes it; per-stage mode applies the share inside each stage (prototype behavior).
- **License awareness (✅ §14 Q1):** the sample still splits Certscan/NonCertscan as above. Enforcement happens at **distribution** time, not sampling: CertScan rows are only handed to users whose `hasCertScanLicense` flag is set (§4, §8). If there are not enough licensed users to absorb the drawn CertScan rows, the surplus stays unassigned/queued for a licensed holder rather than going to an unlicensed user.

**Step 5 — Within each stage×certscan bucket, sample proportionally by port (اسم المنفذ).**

- Group by port, weight each port's take by its availability: `Take_port = RoundExact(Avail_port / Σ Avail × N)`, capped at `Avail_port`.
- **FIX (was `Table.FirstN`):** draw a random sample within each port, not the first N rows. Use a seeded RNG (seed stored in `month.manifest.json`) so a run is reproducible and audit-defensible — same population + same seed → identical sample.

**Step 6 — Exact rounding everywhere (largest-remainder / Hamilton).**

- **FIX (was RoundUp + final `FirstN(SampleSize)` trim):** never overshoot-then-chop. At each split, floor all shares, then distribute leftover units to the largest fractional remainders until the target is hit exactly. This preserves the computed proportions instead of arbitrarily truncating whatever sorted last.

**Step 7 — Combine + clean.** Recombine protected sample + normal sample. Drop internal/working columns (`Certscan Status`, `Certscan Snippet`, `Original Certscan Snippet`, plus the report-irrelevant source columns the prototype removes). The sample is then frozen as `sample.master.json` (§9), with the seed and all allocation parameters recorded for audit.

**Three defects fixed vs. the prototype:**

| Defect in prototype | Fix |
|---------------------|-----|
| `Table.FirstN` → biased, order-dependent draw | seeded random draw per port |
| RoundUp + final FirstN trim → overshoot then arbitrary cut | largest-remainder exact apportionment |
| Certscan share only per-stage | configurable per-stage or global |

---

## 14. Open questions to resolve before implementation

1. **License enforcement on the CertScan percentage** — ✅ resolved (2026-06-14): **per-user attribute**, not a numeric cap. Each managed user has a `hasCertScanLicense` flag set by the admin at create/edit time; distribution routes CertScan rows only to licensed users (§4, §8, §13.5 Step 4).
2. **Study template** — ✅ resolved (§10A): schema-driven, admin-built, versioned, with phases, conditional fields, required-flags, and auto-derived الاكتمال.
3. **Month folder naming** — ✅ resolved (2026-06-14): **`MM-MonthName-YYYY`** (e.g. `5-May-2026`). Flat structure, year explicit in every folder name; cross-month report scope parsing (§12.5) keys off this.
4. **Locking granularity** — ✅ resolved by research (§11A.6): two-tier model — Web Locks for same-machine multi-tab, per-writer isolation + advisory files for cross-machine. No row-level locks needed because employees never share a file.
5. **Replacement supply pool** — ✅ resolved (2026-06-14): **either, configurable**. The operator chooses per replacement/run between (a) the unsampled remainder of the population, or (b) the full processed population minus already-owned rows. Default = (b) "processed minus owned" (mirrors the §9 NEW_WAVE "both" decision); selectable in the Store & Replace / distribution UI.
6. **Auth strength** — ✅ resolved (§5.1, §16.4, 2026-06-14): **Argon2id preferred** (WASM) / **PBKDF2-SHA256 ≥ 600k fallback**; security posture accepted as UI-gating for a trusted team, with the shared drive's OS permissions as the real boundary.
7. **Daily-rate denominator** (from §12.3.2) — confirm the headline number: completion-%-per-day vs. throughput-count-per-day. *(minor, dashboard polish — deferred to Phase 6 Reporting; default = throughput-count-per-day with completion-% shown alongside)*

**Decided / corrected this round (v0.9 — research pass)**

- Concurrency model corrected: Web Locks is same-machine only; cross-machine safety rests on per-writer isolation + advisory files + backups (§11A.6).
- Safe-write layer specified: temp-write + `.bak` snapshot + read-validation + restore (§16.3), addressing the network-drive atomic-rename caveat.
- Auth parameters fixed: 210k→600k PBKDF2-SHA256, Argon2id preferred (§5.1).
- Excel reading correctness added: read `.v` not `.w`; long IDs as strings to avoid exponential-notation corruption — fixes the `###` artifact seen in your data (§7.1).
- Workspace handle persistence via IndexedDB with re-prompted permission (§16.2).
- Security posture stated honestly (§16.4).

**Decided earlier rounds**

- KPI floor = 6250 minimum, stages 2–4 only; stage 1 mandatory/uncapped/excluded from math.
- Report toggle: all-studied vs. required-6250; spillover is supply-weighted/cascading (§13.2).
- Unstudyable rows → Store & Replace, same-stage-first then highest-supply (§13.3).
- Replaced-row visibility follows the permission matrix (§13.4).
- Versioned templates; one employee file per month; cross-month aggregation is additive.
- Final build ships as plain HTML/JS/CSS; dev stack is free to use React/Vite/Node.

---

## 15. Current prototype gaps this spec closes

- Phases 3 (sample selection) & 4 (distribution) become real, backed by §9–§10.
- The workspace/disk layer (already built but unwired) becomes the actual backbone.
- The employee-facing review/answer flow (§11) is defined.
- Reassignment with full audit trail (§9) is new and central.

---

## 16. Technical architecture & platform notes (researched 2026)

This section grounds the design in verified current browser-platform behavior. Each point was checked against current sources rather than assumed.

### 16.1 File System Access API — confirmed state

- Chromium-only (Chrome / Edge / Opera). Not in Firefox (which has formally objected) or Safari, and not on any mobile browser — desktop Chromium is the only target. This matches the hard constraint (§2.1); the app must feature-detect `showDirectoryPicker` and show a clear "use Chrome/Edge on desktop" message otherwise.
- Requires a secure context (HTTPS or localhost) and a user gesture to open the picker. The single-file build must therefore be served over HTTPS or run from localhost, not opened via `file://` (a `file://` page cannot reliably use the API).
- `{ mode: 'readwrite' }` must be requested on the directory handle for write access.

### 16.2 Persisting the workspace handle (improves login UX)

- Directory handles can be stored in IndexedDB and reused across sessions, so the user picks the workspace once, not every launch.
- But permission is not permanent: on each new session the app must call `queryPermission` / `requestPermission` and re-confirm with a gesture; the user can revoke it in browser settings.
- Design: on launch, try the stored handle → if permission still granted, reopen silently; else prompt to re-grant or re-pick. This is part of the AuthGate/Workspace bootstrap flow.

### 16.3 Safe-write layer (the corruption defense, concretely)

Every JSON write goes through one helper with these steps (researched best practice for DB-less file storage):

1. Acquire the same-machine Web Lock for that file (§11A.6 Tier 1).
2. Read current file; if it parses, copy it to `name.bak` first.
3. Write new content via `createWritable()` (temp-file-then-commit; atomic where the FS allows).
4. Validate the just-written file parses; if not, restore from `.bak`.
5. Release the lock.

Reads run JSON validation and fall back to `.bak` on parse failure, surfacing a recovery prompt rather than silently continuing on corrupted data. This directly addresses the network-drive atomic-rename caveat (§11A.6 Tier 3).

### 16.4 Security posture — stated honestly

- This is a local, in-browser, server-less tool for a trusted internal team. Auth (§5.1) gates the UI and separates roles; it is not cryptographic protection of the data at rest. Anyone with file access to the workspace can read/edit JSON directly.
- That is an acceptable tradeoff for an internal QC tool as long as it is written down and the workspace folder's OS/network permissions are the real access-control boundary.
- Sensitive specifics (the customs/X-ray data itself) are protected by folder permissions on the shared drive, not by the app. Recommend documenting who has OS-level access to the `Data/` tree.

### 16.5 Performance & scale

- Population files can be large (hundreds of thousands of rows in the worked example). Parse with streaming / web workers where possible so the UI doesn't block; the data-analysis pipeline and the sample draw should run off the main thread.
- Cross-month/all-time reports (§12.5) fan out over many folders — read lazily, show progressive results, and cache a roll-up in `.system/` written by a single process.
- Per-employee monthly files stay small by design (§6), keeping the hot write path cheap.

### 16.6 Recommended dev stack vs. shipped artifact

- **Dev:** React 19 + TypeScript + Vite; SheetJS for Excel; a small WASM Argon2 lib; optional Web Worker for parsing/sampling.
- **Ship:** one self-contained `index.html` via `vite-plugin-singlefile` (§ build note), so the whole tool is a single portable file that runs from HTTPS/localhost in Chromium.

### 16.7 Research provenance

Key external facts verified during this revision: File System Access API browser support and secure-context/gesture requirements; handle persistence via IndexedDB with re-prompted permissions; `createWritable()` atomicity and the network-FS atomic-rename caveat; the temp-file + `.bak` + read-validation pattern for DB-less JSON; Web Locks API scope (same-origin, same-machine only); SheetJS `.v` vs `.w` and large-number precision handling; and 2026 OWASP password-hashing guidance (Argon2id preferred; PBKDF2-SHA256 ≥ 600k as the FIPS/no-dependency fallback).
