# AGENTS.md

Guidance for agents working on the X-ray quality control application: an Arabic, RTL-first React 19 + TypeScript + Vite SPA for importing radiology BI/risk Excel data, processing a population, drawing a stratified sample, distributing work, collecting answers, and producing self-contained reports. There is no backend; business data lives in a user-selected workspace folder and auth/preferences live in browser storage.

## Commands

```bash
npm run dev                 # Vite development server
npm run typecheck           # strict TypeScript check
npm run lint                # ESLint over the repository
npm run check:complexity    # complexity/large-function regression budget
npm run test:run            # Vitest, 711 tests in 109 files as of v56.2
npm run build               # tsc -b + one-file Vite build
npm run check:bundle-size   # raw/gzip release budget
npm run check:release       # package version ↔ latest daily edit-log consistency
npm run check:vendor        # vendored SheetJS SHA-256
npm run preview             # preview production build
```

## Build and platform constraints

- `vite-plugin-singlefile` produces one portable `dist/index.html` (~3.04 MB, ~1.13 MB gzip in v56.2). The ChangeLog aggregates `docs/edit logs/*.md` and is truncated at build time.
- SheetJS is vendored at `vendor/xlsx-0.20.3.tgz`; `package.json` uses `file:vendor/xlsx-0.20.3.tgz`. Do not replace it with the stale npm-registry package. Follow `vendor/README.md` and update the reviewed checksum when upgrading.
- Full workspace support requires the File System Access API (`showDirectoryPicker`), so use Chrome or Edge. Other browsers receive the unsupported-browser state.
- TypeScript uses strict mode and `erasableSyntaxOnly`. `FileHandleLike.createWritable` is optional; guard it before calling.
- Run every release gate listed in `docs/product/RELEASE_CHECKLIST.md`.

## Workspace layout

```text
1-population/{month}/
  month.manifest.json
  1-raw/risk.raw.json, bi.raw.json
  2-processed/population.final.json, processing.summary.json
2-samples/{month}/
  1-main/sample.master.json, distribution.events/{eventId}.json,
         distribution.log.json, distribution.current.json, main.samples.json
  2-employees/{username}.samples.json, {username}.answers.json
  3-approvals/{supervisor}.decisions.json
3-user-data/
4-reports/designs/
5-system/
  workspace.schema.json
  backups/, audit/, locks/, notifications/, feedback/, user-presets/
6-templates/
  {templateId}.json, templates.index.json, template.selection.json
```

Month folders use `{month}-{MonthName-en}-{year}`, for example `5-May-2026`. Legacy readers still support `Population/`, `.system/`, and `templates/`. Never silently move/delete legacy roots. Workspace schema changes must be detected read-only, dry-run first, backed up, validated, and idempotent.

## Persistence boundaries

### Browser storage — `src/auth/`

- Sessions use `sessionStorage`; managed users, password hashes, roles, and permission matrices use `localStorage`.
- Roles are `guest`, `employee`, `supervisor`, `manager`, and `admin`.
- New passwords use Argon2id; legacy PBKDF2 records are upgraded when authenticated.
- `src/auth/tabCatalog.ts` is the source of truth for tab IDs, Arabic labels, parent relationships, and role ceilings. Permission defaults are derived/tested against it.
- Use `canMutate`/the centralized mutation capability for every persistent UI action. Check at both render and handler boundaries.
- This is advisory client-side authorization, not a security boundary. See `docs/architecture/SECURITY_MODEL.md`.

### Workspace data — `src/data/`

- `safeWriteJson`/`safeReadJson` use temp→commit with verified backups and typed read-only/transient failure handling.
- JSON business files use `JsonEnvelope<TData>` metadata with schema version, revision, and content hash.
- Web Locks coordinate one browser context; promise-chain fallback is local only.
- Distribution durability uses immutable per-event files. `distribution.log.json` is a compatibility projection and `distribution.current.json` is a rebuildable cache keyed by `eventSetId`.
- Corrupt current, legacy, or immutable events must fail explicitly; never reinterpret corrupt governance data as empty.
- Browser filesystem APIs cannot guarantee atomic workspace-wide migration, global multi-device ordering, multi-event transactions, or exactly-once delivery. Those require a backend.

## Main data modules

| Module | Path | Responsibility |
|---|---|---|
| Population | `src/data/population/` | Month CRUD, manifests, raw/final data, month locks |
| Sampling | `src/data/sampling/` | Hamilton allocation, seeded RNG, staged draw, spillover |
| Distribution | `src/data/distribution/` | Immutable events, compatibility projection, derived state |
| Templates | `src/data/templates/` | Inspection template schema/storage/index |
| Answers/approvals | `src/data/answers/`, `src/data/approvals/`, `src/data/referral/` | Employee answers and governed transitions |
| Reporting | `src/data/reporting/` | Arabic HTML, workbook, document, and executive deck builders |
| Backup/audit | `src/data/backup/`, `src/data/audit/` | Snapshots, restore checks, activity and action logs |

## Tab system

Top-level tabs are auto-discovered by `tabRegistry.ts` through `import.meta.glob`. Every tab exports a component and `tabConfig`; metadata must agree with `src/auth/tabCatalog.ts`.

| ID | Roles ceiling | Order |
|---|---|---:|
| `population` | all roles | 10 |
| `employee-workspace` | all roles | 15 |
| `reports` | guest, supervisor, manager, admin | 25 |
| `archive` | guest, supervisor, manager, admin | 30 |
| `user-management` | admin | 40 |
| `settings` | guest, admin | 95 |
| `change-log` | admin | 96 |

Template Builder is the Employee Workspace inspection-form surface. Report Designer is a Reports sub-tab. Do not register them as duplicate top-level tabs.

## Conventions

- All user-facing copy is Arabic and containers are RTL; code/file identifiers remain English.
- Use colocated plain CSS and shared tokens/primitives. Honor reduced motion, keyboard focus, and semantic labels.
- Use `import type` for type-only imports.
- Keep deterministic sampling behavior and `SAMPLING_ALGORITHM_VERSION` stable unless a deliberate migration/version bump is approved.
- Use `createMemoryDirectory()` for filesystem tests. Characterize output before changing persistence, sampling, report exports, or event folding.
- Preserve unrelated user changes in a dirty worktree. Run focused tests while editing, then the complete release gate before handoff.
