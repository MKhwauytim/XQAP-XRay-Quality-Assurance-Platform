# Full application revision — 2026-07-17

## Executive result

This revision covered the React/TypeScript application, browser and workspace persistence, permissions, sampling and distribution algorithms, reports, responsive behavior, accessibility, dependencies, CI, release metadata, and repository documentation.

The highest-risk defects found during the review were fixed in version 56.2:

- recoverable file-read failures could be treated as permanent and valid backups could be overwritten;
- UI permission checks were duplicated and several persistent actions did not share one mutation policy;
- workspace layout versions were implicit and mixed/legacy folders had no validated migration marker;
- a shared mutable distribution log could lose concurrent events;
- the shell kept every visited tab mounted indefinitely and mobile navigation was not a true accessible drawer;
- two core functions had cyclomatic complexity 53, making changes unusually risky;
- tab IDs, labels, role ceilings, and permission defaults were duplicated;
- release numbers, vendored binary integrity, and bundle growth were not enforced in CI;
- an obsolete analysis module and unused UI/dependency code remained in the project.

The application remains intentionally backend-free. This is suitable for a single operator or a carefully managed shared folder, but it cannot provide atomic multi-device transactions, a trusted identity authority, centralized revocation, or cryptographically authoritative audit history. Those are architecture boundaries, not browser-code bugs.

## Findings, fixes, and change risk

| Area | Finding | Resolution | Possible issue introduced by the fix | Mitigation / best method |
|---|---|---|---|---|
| File safety | `NotReadableError` was treated as a permanent failure; stale backup/rollback behavior could damage the recovery chain. | Retry transient reads, preserve the last valid backup, explicitly detect read-only handles, and cover failure paths with memory-filesystem tests. | A genuinely unavailable device may take slightly longer to fail. | Bounded retries only; expose a typed Arabic error after the retry budget. |
| Mutation permissions | Components independently interpreted role, tab, feature, workspace, and lock state. | Central `canMutate` capability used at render and handler boundaries; feature metadata distinguishes workspace-backed and browser-backed mutations. Disk commands require a ready mounted directory and re-query live write permission at the shared safe-write boundary before touching files. Permission loss returns the app to a reconnect-required workspace gate. | Newly added features can be inaccessible if omitted from the catalog or mounted outside the workspace provider; a device may still detach after the preflight and before a write completes. | Fail closed for unknown IDs and default new features to workspace-backed; retain typed write failures and recovery semantics for mid-operation device loss; require catalog/default-permission and permission-loss tests in CI. |
| Workspace layout | Current, legacy, mixed, and incomplete layouts were not explicitly versioned. | Read-only detection, dry-run planning, verified-backup requirement, and idempotent `workspace.schema.json` metadata. Legacy data is not moved or deleted. | Old workspaces remain mixed until a future migration tool is deliberately run. | Prefer additive readers and a verified backup; never perform an implicit whole-workspace move. |
| Distribution concurrency | One mutable log was vulnerable to lost updates between devices. | Store immutable event envelopes in `distribution.events/{eventId}.json`, merge deterministically, reject conflicting IDs, and retain the old projection for compatibility. | Two devices can still disagree about wall-clock ordering; multi-event operations are not atomic. | Use globally unique IDs and idempotency; move coordination to a backend if strict ordering is required. |
| Corruption handling | Corrupt event/log data could be interpreted as empty state. | Fail explicitly instead of deriving an incomplete snapshot. | Users may be blocked until recovery instead of seeing partial data. | Safer default for quality/governance data; restore from a verified backup and retain the corrupt artifact for diagnosis. |
| Sampling/distribution code | Core functions had complexity 53. | Extracted pure derivation and sampling stages; public dispatchers now have complexity 2–3 while preserving RNG order and algorithm version 1.0. | Reordering helper calls could alter deterministic samples. | Characterization tests pin results, RNG order, event semantics, and algorithm version. |
| UI memory | Every visited tab remained mounted. | Bounded LRU cache keeps at most three visited tabs and restores per-tab scroll. | Returning to an evicted tab resets transient unsaved component state. | Persistent forms must autosave or warn before navigation; keep the cache small and tested. |
| Mobile/accessibility | Navigation was an in-flow grid and lacked robust focus behavior. | Off-canvas drawer, focus trap, Escape/backdrop close, focus restoration, inert workspace, reduced-motion handling, labels, heading fixes, and screen-reader KPI data. | Focus traps can strand users if selectors regress. | Keep focused component tests and perform keyboard browser smoke tests before release. |
| Charts/bundle | A large charting runtime was used for one small KPI visual. | Replaced with a native accessible SVG while retaining the data table as the semantic source. | Native charts require manual scales and resizing logic. | Keep calculations pure/tested and use `viewBox`-based responsive SVG. |
| Metadata duplication | Tabs and permissions had several sources of truth. | Introduced a typed tab catalog that derives managed IDs and role ceilings. | A dynamic tab without catalog metadata now fails registration. | Treat failure as a release-time defect; catalog consistency tests enumerate all registered tabs. |
| Dependencies | Procedural-art packages and obsolete shims/dependencies were unused or replaceable. | Native deterministic SVG generator, vendored SheetJS checksum, removed unused packages and code. | Visual output changes even when underlying report data does not. | Snapshot deterministic output and keep the previous release artifact for comparison. |
| Release quality | Version, edit log, vendored tarball, and bundle size could drift. | CI checks release consistency, SHA-256 vendor integrity, typecheck, lint, tests, build, and bundle budget. | Intentional dependency or bundle changes will fail CI. | Update checksum/budget only after license, provenance, and performance review. |

## Remaining product and architecture decisions

These are not safe to silently invent during a code-hardening pass. They should be prioritized with the application owner:

1. **Report Designer scope.** Unfinished table/chart/section controls are now hidden instead of advertised as disabled features, while compatibility readers remain for experimental design files. Decide whether to complete a minimum end-to-end authoring/export path or retire the dormant types and query surface.
2. **Inspection draft recovery.** Long inspection forms need per-row draft autosave, an explicit “draft saved” indicator, and a discard confirmation. The storage policy must define whether drafts are personal, shared, and included in backup.
3. **Strict multi-device operation.** If two or more machines must write to the same workspace simultaneously with guaranteed order and exactly-once transitions, add a transactional backend. Browser filesystem locks only coordinate one browser process.
4. **Trusted governance.** Local PBKDF2 login and tamper-evident hashes deter casual changes but are not a trusted identity/audit authority. Government-grade non-repudiation requires server-side accounts, signed audit records, centralized revocation, and protected backups.
5. **Excel date policy.** Add an import-time date-format choice and flag ambiguous values such as `04/05/2026`; never silently guess in regulated data.
6. **Legacy report editions.** The production executive deck uses v2 while v1 remains as a development comparison. Set a retirement date; otherwise every report-model change has two presentation engines to maintain.
7. **Arabic content governance.** Move operational labels, empty/error states, and help copy into a reviewed content catalog. Each message should state what happened, what data is affected, and the next safe action.

## Recommended application structure

The current domain-oriented `src/data` layout is sound. Continue moving large UI controllers toward this boundary:

```text
src/
  app/                 shell, tab lifecycle, error boundaries
  auth/                identity, permission catalog, mutation capabilities
  components/          reusable visual and interaction primitives
  features/
    population/        page composition, hooks, view components
    employee-workspace/
    reports/
    archive/
    user-management/
  data/                persistence and pure domain services only
  styles/              shared tokens/primitives
```

This is a target, not a request for a disruptive folder-only rewrite. Move one tested feature slice at a time. A good feature slice has:

- a small route/tab component that composes views;
- one hook or controller for asynchronous workflow state;
- pure domain functions with no React imports;
- persistence adapters behind typed functions;
- Arabic view components with accessible labels and explicit loading/empty/error states;
- colocated characterization tests before extraction.

Avoid introducing a global state library until prop/state flow is demonstrably the problem. Workspace persistence is the source of business truth; a second global client cache can create stale-state bugs.

## Content and experience recommendations

- Make the Population workflow read as a single story: **received → validated → processed → sampled → approved → distributed**. Show the current step, owner, timestamp, source revision, and blocking reason at every stage.
- On every destructive or governance action, show the exact month, item count, and recovery path. Use verbs, not generic “Are you sure?” copy.
- Separate “no records,” “workspace not connected,” “permission denied,” “month closed,” and “data corrupt.” They require different user actions and must not share one empty state.
- Keep Arabic as the visible product language, but retain stable English identifiers in code and files. Use Latin digits only where operational IDs require exact copying.
- For KPI visuals, pair color with text/icon/status and always provide a table or concise textual summary. Never encode pass/fail using color alone.
- Add a small “data provenance” block to every export: month, source files, import time, processing revision, sample seed/version, and generated-at time.
- Provide a release-facing help page describing Chromium/File System Access requirements, backup policy, and the limits of shared-folder concurrency.

## Engineering operating method

1. Characterize existing behavior before refactoring deterministic or persistence code.
2. Keep one source of truth for IDs, roles, labels, schemas, and algorithm versions.
3. Fail closed on permissions and corruption; fail visibly with an actionable Arabic explanation.
4. Use immutable records for independently generated events; derive projections as caches.
5. Make migrations additive, dry-runnable, backed up, validated, and idempotent.
6. Treat generated HTML as an injection boundary: escape data and test hostile payloads.
7. Keep CI reproducible and offline-safe for vendored assets; verify checksums and licenses.
8. Track complexity trends, but refactor by cohesive responsibility rather than line-count shuffling.
9. Verify responsive and keyboard behavior in a real Chromium browser, not only unit tests.
10. Release in small reversible increments with a tested restore path.

## Verification gates for version 56.2

The release is acceptable only when all of these pass together on the final tree:

```bash
npm run check:release
npm run check:vendor
npm run typecheck
npm run lint
npm run test:run
npm run build
npm run check:bundle-size
```

In addition, manually verify login, workspace selection, mobile drawer keyboard behavior, permission-denied states, import/process/sample/distribute, employee submission/referral, archive backup/restore guardrails, and each report export in Chromium.
