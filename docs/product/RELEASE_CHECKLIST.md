# Release checklist

Run through this before cutting a release (tagging a commit as the version users will run).

## 1. Version

- [ ] Decide the next version number. `package.json`'s `version` field is the **single source
      of truth** — it tracks the EDIT_LOG scheme directly: `package.json` version
      `MAJOR.MINOR.0` ↔ EDIT_LOG's latest `vMAJOR.MINOR` entry (patch is always `0`; EDIT_LOG
      doesn't have a third segment, so all granularity lives in the minor number).
- [ ] Bump `package.json`'s `"version"` field to match the EDIT_LOG entry you're releasing at.
- [ ] Confirm there is exactly one source of truth: `grep -rn "APP_VERSION\|\"1\.0\.0\"" src/
      package.json vite.config.ts vitest.config.ts` should show only the `package.json` version
      field and the `vite.config.ts`/`vitest.config.ts` `define` blocks that read it — no second
      hardcoded release-version string anywhere else. (`WORKSPACE_SCHEMA_VERSION` and JSON
      envelope `schemaVersion` fields are a different concept — on-disk data schema versioning —
      and are expected to appear separately; don't confuse them with the app release version.)
- [ ] Confirm the running app shows the bumped version: Settings tab → "حول النظام" card.
- [ ] Run `npm run check:release`; it must confirm that `package.json` and the latest
      latest `docs/edit logs/YYYY-MM-DD.md` heading agree.

## 2. CHANGELOG cut

- [ ] Skim the `docs/edit logs/` entries since the last release tag.
- [ ] Summarize the major-version-worthy items (features, breaking changes, notable fixes) into
      a short human-readable release note if one is being published externally. The in-app
      ChangeLog tab already surfaces the full entry detail — this step is for anything shipped
      outside the app itself (release notes page, announcement, etc.), skip it if there is none.

## 3. Build size

- [ ] Run `npm run build` and record the printed `dist/index.html` size (raw + gzip) from the
      Vite build output.
- [ ] Compare against the last recorded size in `CLAUDE.md`'s "Build & dependency gotchas"
      section. If it moved meaningfully, update that note (`~X MB, ~Y kB gzip as of <date>`).
- [ ] If the jump is unexpectedly large, check whether recent files in `docs/edit logs/` grew a lot since the
      last release — the ChangeLog tab's build-time truncation (`src/build/editLogTruncatePlugin.ts`,
      currently keeping the most recent 20 versions) bounds this, but a burst of very large
      entries can still move the needle; consider whether the kept-version count still makes
      sense.

## 4. Docs sync

- [ ] `CLAUDE.md`'s tab table (`## Tab system`) still matches the actual registered tabs
      (`src/components/Sidebar/Tabs/*/index.tsx` `tabConfig` exports).
- [ ] `CLAUDE.md`'s bundle-size note (see step 3) is current.
- [ ] Any newly-added data-layer modules or disk-layout paths are reflected in
      `docs/data-system-report.md` (the authoritative disk-layout reference) and, if relevant,
      the `CLAUDE.md` "Disk layout" summary.

## 5. Gate

- [ ] `npm ci` succeeds from a clean dependency tree without downloading SheetJS from its CDN.
- [ ] `npm run check:vendor` — the vendored SheetJS tarball matches its reviewed SHA-256.
- [ ] `npm run lint` — clean.
- [ ] `npm run typecheck` — clean.
- [ ] `npm run test:run` — all green.
- [ ] `npm run build` — succeeds, `dist/index.html` produced.
- [ ] `npm run check:bundle-size` — raw and gzip bundle budgets pass.
- [ ] `npm audit` — no unresolved production or development advisory.
- [ ] Smoke-test the built app in Chromium at desktop and 390 px: Arabic labels, keyboard
      focus, mobile drawer, read-only mode, permission-denied actions, and report exports.
- [ ] CI (`.github/workflows/ci.yml`) is green on the commit being released.

## 6. Data safety

- [ ] Exercise workspace detection with current, legacy, and mixed-layout fixtures.
- [ ] Run every migration as a dry-run first and verify a backup before applying metadata.
- [ ] Exercise transient `NotReadableError`, corrupt live data with a valid backup, and
      concurrent distribution append tests.
- [ ] Preserve the previous distributable and its verified workspace backup for rollback.

## 7. Tag

- [ ] Commit the version bump (and any docs-sync edits) with a message referencing the EDIT_LOG
      entry.
- [ ] Tag the commit, e.g. `git tag v42.17.0 && git push --tags` (adjust to the actual version).
