# App Data Management Audit

**Date:** 2026-07-22
**Scope:** monthly data isolation, employee authorization and read paths, replacement candidates,
and all-month selection semantics
**Implementation status:** audit only; no application code changes are authorized by this document

## 1. Intended operating model

The intended model is a month-scoped working set for heavy business data. Starting a new month
must clear the active processing workflow without deleting prior-month history. Users, roles,
permission matrices, preferences, templates, and other lightweight configuration remain outside
that reset. Ordinary employees should enter only **إدارة مساحة العمل → صور الأشعة المحالة** and
read only the active month's data needed for their own queue and answers. Cross-month access is an
explicit aggregate/read-only mode, not a mutation target.

The scalable implementation boundary is defined by
[Large-Population Performance — Architecture Proposal](../architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md).
That proposal is still pending owner approval. Findings classified as **proposal-covered** must not
be implemented independently of its approved phase sequence.

## 2. Summary

| Finding | Current behavior | Classification |
|---|---|---|
| Employee defaults and landing order | Employees can view Population, Population Process/Browse, Inspection Results, and Inspection Form; Population is the first allowed top-level tab | **Separable now:** default permission policy. **Proposal-covered:** demand-gated employee landing/read behavior (Phase A) |
| Employee Workspace read path | `XrayReferrals` reads the complete sample master and derives/reads the complete distribution before filtering, despite an existing employee mirror | **Proposal-covered — Phase A** |
| Replacement candidates | Opening the dialog reads the complete processed population; the historical cap changed from 1,000 to 100; no precomputed reserve exists | **Proposal-covered — Phases A/C/D** |
| All-month selection | The global month state represents one existing/pending month or none; selected screens implement their own local all-month aggregation | **Separable now:** selection policy and UI contract. **Proposal-covered:** scalable aggregate reads |

## 3. Findings

### 3.1 Employee defaults grant more than the intended workspace page

`createDefaultPermissions()` currently grants the employee role:

- `population = view`;
- `population/process = view`;
- `population/browse = view`;
- `employee-workspace = edit`;
- `ew/xray-referrals = edit`;
- `ew/xray-results = view`; and
- `ew/inspection-form = edit`.

The tab registry sorts Population at order 10 and Employee Workspace at order 15. `AppContent`
selects the first allowed tab when no explicit selection exists. Therefore an employee using the
shipped defaults lands on Population, not X-ray Referrals. Population then reacts to the global
month and calls the all-in-one historical edit loader, which reads raw data, the complete processed
population, the sample, and distribution state.

This conflicts with the intended default of exposing only **إدارة مساحة العمل → صور الأشعة
المحالة** to an ordinary employee. It also causes the largest avoidable startup read before the
employee has selected a workflow requiring it.

**Classification**

- **Separable now:** decide and encode the employee default permission matrix so new/default-reset
  installations expose only `employee-workspace` and `ew/xray-referrals`.
- **Proposal-covered:** changing landing and loader behavior so an explicitly granted Population
  permission does not trigger unrelated heavy reads. This is Phase A demand and capability gating.

Restricting the default factory alone does not update permission matrices already persisted in
`localStorage`. Section 4 records the required policy decision.

### 3.2 X-ray Referrals reads complete sample and distribution data

`XrayReferrals.loadData()` first loads `sample.master.json`, then calls
`loadOrDeriveDistributionCurrent()` with every sample row. For an ordinary employee it attempts to
load `{username}.samples.json`, but uses that mirror only as a fallback when the complete derived
distribution is unavailable. The full distribution is then filtered by `assignedTo === username`.
Answers are correctly limited to the signed-in employee unless the user has oversight permission.

The per-employee mirror already contains the employee's distribution entries and is maintained by
`syncSampleMirrors()` whenever the current distribution projection is saved. The ordinary employee
read path therefore has a small, purpose-built source available but does not treat it as primary.

This is resource-control and privacy minimization, not a stronger security boundary: workspace
files remain user-accessible under the product's advisory client-side authorization model.

**Classification: proposal-covered — Phase A.** The proposal explicitly requires employee entry to
load only the employee sample and answer files and forbids reads of processed/raw population data.
Changing source precedence also needs characterization of mirror freshness, corruption behavior,
month-switch races, and replacement/referral mutations; it must ship with the focused-loader work.

### 3.3 Replacement loads the complete population and has no prepared reserve

The normal X-ray Referrals load deliberately leaves `populationRows` empty. When an employee opens
the replacement dialog, `openReplacementDialog()` reads the complete
`population.final.json` and stores all rows in React state. `getReplacementCandidates()` then scans
that full array, excludes sampled/owned rows, preserves tier and stage rules, and returns a bounded
candidate list.

The replacement cap history is:

1. v3.4 introduced a deterministic/randomized UI cap of **1,000** candidates to avoid rendering
   every eligible row from populations above 10,000 rows.
2. Commit `58c5d3577` subsequently changed `REPLACEMENT_POOL_LIMIT` to **100**.
3. The current cap limits only the returned UI list. It does not prevent the complete processed
   population from being read, parsed, retained, and scanned first.

There is no persisted or precomputed 1,000-row replacement reserve. Reassignment is a different
operation: it changes ownership of an existing sample and does not require an alternative sample
row. Replacement is the operation that requires candidate discovery.

**Classification: proposal-covered — Phases A/C/D.** A fixed 1,000-row in-memory reserve must not
be added ad hoc. The proposal explicitly distinguishes UI page size, durable partition size, and
memory/cache budget, and recommends authorized demand loading, paged queries, partition indexes,
and worker-owned sampling/whole-population consumers. Candidate discovery must be designed against
that repository contract so it preserves deterministic sampling, stratification, exclusion,
freshness, and audit behavior without reopening the monolith.

### 3.4 The global selector has no all-month state

`GlobalMonthSelection` currently supports only:

- one existing month;
- one pending/new month; or
- no selection.

The global selector renders existing/pending months only. There is no `all` selection kind.
Population Browse and some reporting/history surfaces independently widen their queries to all
months, so “all months” is not a consistent application-wide state.

An all-month state must be read-only. Processing, sampling, distribution, answering, replacement,
reassignment, and approval mutations require one explicit month folder. A global `all` value must
therefore never be accepted by write handlers as a folder name.

**Classification**

- **Separable now:** approve the semantic contract, selector visibility by role/surface, Arabic
  label, and mutation prohibition. A selector-only change should not eagerly aggregate data.
- **Proposal-covered:** any cross-month population or other heavy aggregate query. Those reads need
  the proposal's paged repository/worker/partition approach rather than concatenating complete
  monthly arrays in React.

## 4. Open policy decision: existing persisted permission matrices

Changing `createDefaultPermissions()` affects new state and explicit resets, but existing installs
already hold a full permission matrix in browser `localStorage`. The product owner must choose one
of the following policies before the employee defaults change.

### Option A — leave existing installs untouched

Apply the restricted employee defaults only when creating a new permission state or explicitly
resetting permissions.

- **Benefit:** no administrator customization can be overwritten.
- **Cost:** existing installations continue exposing Population, Inspection Results, and Inspection
  Form to employees until an administrator changes them manually.
- **Operational requirement:** show the new recommended matrix in documentation or an admin notice.

### Option B — one-time migration

Bump the persisted user-management schema/default version and idempotently rewrite the affected
employee rows once.

- **Benefit:** existing installations converge immediately on the intended employee experience.
- **Cost:** a blind rewrite can destroy deliberate administrator grants.
- **Safety requirement:** migrate only entries proven to match the old shipped defaults, preserve
  divergent/custom values, record the migration version, and provide an administrator-visible
  summary. If provenance cannot be proven, require explicit administrator confirmation instead of
  silently changing access.

### Option C — versioned defaults with customization provenance

Persist a default-policy version and track whether each permission is inherited/defaulted or
explicitly customized. On upgrade, update inherited values to the new version and retain explicit
overrides.

- **Benefit:** gives predictable future default evolution without repeatedly risking custom
  matrices.
- **Cost:** requires a small permission-state model migration and UI clarity around inherited versus
  overridden values.
- **Safety requirement:** legacy entries without provenance need a one-time classification rule or
  administrator confirmation.

**Audit recommendation:** choose Option C for the durable policy. If immediate convergence is
required, combine it with Option B's conservative “old-default values only” migration. Do not
silently replace the entire persisted matrix.

## 5. Recommended sequencing after approval

1. Decide the permission migration/default policy in Section 4.
2. Ship the restricted employee defaults and tests as a small, independently reviewable change.
3. Approve and implement proposal Phase A for employee landing and focused loaders.
4. Define replacement candidate queries on the approved repository abstraction; do not create a
   standalone 1,000-row reserve against the legacy monolith.
5. Add all-month selector semantics separately, keeping mutations single-month and deferring heavy
   aggregate reads to the scalable query phases.

Until those decisions are approved, the current month-folder persistence should remain unchanged:
new-month reset means a clean active working state, not deletion or silent movement of historical
month folders.
