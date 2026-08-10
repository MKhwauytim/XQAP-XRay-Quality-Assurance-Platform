# Manifest and Storage Correctness — Design

**Date:** 2026-08-10
**Status:** approved for planning
**Tier:** 2

## 1. Problem

The app has no web app manifest. It cannot be installed, has no standalone window, no
taskbar identity, and no declared name or icon beyond a `<title>` and a favicon.

Separately, the app's use of browser storage has three gaps. It never requests storage
persistence, so Chrome may evict the saved workspace directory handle and silently drop the
user back at the folder picker. It shares a storage origin with every other local HTML
application on the machine, so a neighbouring app clearing site data destroys this app's
session, label overrides, and device id. And it exposes none of this: there is no way to see
what the app stores, how much quota is used, or whether persistence was granted.

## 2. Goals

- Declare the app's identity — name, description, icons, colors — in a web app manifest.
- Make the app installable as a standalone window when served from an origin.
- Keep the build output at exactly one self-contained `dist/index.html`.
- Work identically to today when opened as a `file://` document, with no errors or console noise.
- Stop losing the saved workspace handle to eviction where the browser permits.
- Make every recoverable storage loss explicit and recoverable rather than silent.
- Give the user visibility into what the app stores and the ability to reset it safely.

## 3. Non-goals

- Caching business data in browser storage. This is deferred to a separate project and is
  governed by `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` §8,
  which requires measurement after Phase C and forbids browser storage being authoritative.
  Phases C and D are unapproved.
- A service worker or offline app-shell caching. Both require a served origin and belong with
  the deferred performance work.
- Shipping a launcher or static server. Serving is documented as the supported path for
  installability; the app must work without it.
- Changing the workspace-on-disk layout, or any business data format.
- Deleting or modifying storage belonging to other applications on the shared origin.

## 4. Constraints

- `dist/` is exactly one `index.html`. `public/` stays empty; anything placed there is copied
  into `dist/` and breaks that guarantee. A manifest therefore cannot be a static file.
- CI runs `npm ci` without access to the SheetJS CDN and should not gain new install-time
  dependencies. Any rasterisation tooling must be a manual, one-off developer step whose
  output is committed.
- All user-facing Arabic strings belong in `DEFAULT_LABELS` (`src/data/labels/labelsStore.ts`),
  not inlined in components.
- TypeScript is strict with `erasableSyntaxOnly`.

## 5. Design — manifest

### 5.1 Delivery

A new module `src/branding/appManifest.ts` builds the manifest object, serialises it, and
registers it at runtime:

1. Construct the manifest object, computing `start_url` and `scope` from `location`.
2. Serialise to JSON and wrap in a `Blob` of type `application/manifest+json`.
3. Create an object URL and inject `<link rel="manifest" href="blob:…">` into `<head>`.

Called once during app bootstrap from `src/main.tsx`, before React mounts.

A `data:` URI alternative is rejected: a manifest's `start_url` and `scope` resolve relative to
the manifest's own URL, and a `data:` URI has no origin, so those members cannot resolve and
Chrome refuses installation. A `blob:` URL inherits the document origin, so `start_url` set to
the document's own location passes the same-origin check. Both approaches keep the output at
one file; only the blob approach can install.

The injection is isolated behind a single exported function, `registerAppManifest()`, so the
delivery mechanism can be swapped without touching the manifest contents if browser
verification (§9) shows blob-URL manifests are not honoured.

### 5.2 Contents

| Member | Value |
|---|---|
| `name` | `نظام متابعة أعمال فحص صور الأشعة` |
| `short_name` | `XQAP` |
| `description` | the existing Arabic description from the `<meta name="description">` tag |
| `icons` | 192×192 `any`, 512×512 `any`, 512×512 `maskable`, each an inline data URI |
| `theme_color` | `#17365d` |
| `background_color` | `#17365d` |
| `display` | `standalone` |
| `orientation` | omitted — desktop app, no orientation preference |
| `dir` | `rtl` |
| `lang` | `ar` |
| `start_url` | computed from `location` at runtime |
| `scope` | computed from `location` at runtime |
| `id` | `xqap` — stable install identity, independent of `start_url` |

The organisation (Zakat, Tax and Customs Authority) is named in `description`. The web app
manifest specification has no author member, so attribution to محمد الخويتم (Mkhuwaytim) is
carried by a `<meta name="author">` tag in `index.html` and shown in the Settings tab.

### 5.3 Application rename

The app's display name changes from `نظام معالجة بيانات الأشعة` to
`نظام متابعة أعمال فحص صور الأشعة`. Live occurrences are two files:

- `index.html` — the `<title>` element.
- `src/auth/AuthGate.tsx` — the sign-in heading.

The `AuthGate.tsx` occurrence moves into a new `DEFAULT_LABELS` key rather than staying an
inline Arabic literal, per repository conventions. `index.html` is static HTML outside the
label system and keeps a literal. `appManifest.ts` reads the same label key so the manifest
name and the in-app name cannot drift.

Occurrences in `docs/edit logs/`, `docs/archive/`, and `docs/superpowers/` are historical
records and are not modified.

### 5.4 Icon pipeline

Source: the official ZATCA shield, supplied by the owner at `src/branding/zatca-shield.svg`
(SVG preferred; a ≥512px PNG is acceptable and is traced to SVG first). The mark is a shield
silhouette formed of parallel diagonal strokes under a blue-to-green gradient.

Composition, per §5.5:

- The shield is centred on a solid `#17365d` tile matching `theme_color`.
- Padding follows the maskable safe zone: all meaningful content within the central 80%
  diameter circle, so OS circular and squircle cropping never clips the silhouette.
- Stroke weight and count are tuned per output size. At 512 and 192 the mark renders at full
  detail. At 48 and below, strokes thicken and reduce in number so the shield silhouette
  survives; thin widely-spaced diagonals alias into an unreadable smudge at taskbar sizes.

Rasterisation is a **manual developer step**, not part of `npm run build` and not part of CI:

- `scripts/generate-app-icons.mjs` reads the composed SVG, rasterises each size, and writes
  `src/branding/appIcons.generated.ts` exporting base64 PNG data URIs.
- The generated module is committed. Regeneration requires a one-off local install of the
  rasteriser and is documented in the script header.
- Consequence: `npm ci`, `npm run build`, and CI gain no new dependency, and the build stays
  offline-capable.

The existing data-URI favicon in `index.html` is regenerated from the same composed mark so
the browser tab, the installed icon, and the app match. This follows the precedent in
`src/branding/organization.ts:19`, where the ZATCA logo already ships as a bundled data URI
specifically so the app and its reports never depend on the network.

Until the shield asset is supplied, the pipeline is wired against the current favicon artwork
as a placeholder so the build never breaks. Swapping in the real mark requires no code change.

### 5.5 Behaviour by origin

| Opened as | Manifest | Result |
|---|---|---|
| `file://` (double-click) | ignored by the browser | identical to today; no error, no console noise |
| `http://localhost` or any served origin | read | install offered; standalone window, own icon, isolated storage origin |

No configuration, no separate build, one file either way.

### 5.6 Hosting notes

A short document, `docs/product/HOSTING_FOR_INSTALL.md`, states what an intranet host must
provide for the install path to work: serve `index.html` over HTTPS (or `http://localhost` for
a local trial), serve it with `Content-Type: text/html`, place it at a stable path since
`scope` derives from it, and impose no Content-Security-Policy that forbids `blob:` in
`manifest-src`. It also records that no server-side component, API, or database is involved —
the file is static and all data stays in the user-selected workspace folder.

This is documentation only. No launcher or server is shipped, and the app remains fully
functional opened directly from disk.

## 6. Design — storage correctness

### 6.1 Storage registry

A new module `src/data/storage/storageRegistry.ts` is the single source of truth for every
browser-storage location the app owns. Each entry declares: key or database name, layer
(`localStorage` / `sessionStorage` / `indexedDB`), purpose, and the consequence if lost.

Current inventory, all already namespaced:

| Location | Layer | Purpose |
|---|---|---|
| `xray_auth_session_v1` | localStorage | auth session |
| `xray_custom_labels_v1` | localStorage | UI label overrides |
| `xray_distribution_device_id_v1` | localStorage | stable per-machine id for event ids |
| `xray_last_login_username_v1` | localStorage | login convenience |
| `xray_firstrun_dismissed_v1:{workspace}` | localStorage | per-workspace first-run dismissal |
| `xray_global_month_v1` | sessionStorage | global month selection |
| `xray-quality-app-persistence` | IndexedDB | saved workspace directory handle |

The registry is consumed by the storage-health panel (§6.4) and by the reset action, so
neither can drift from reality. A test asserts that every storage key literal used in `src/`
appears in the registry, making an unregistered key a test failure rather than a silent
addition.

### 6.2 Persistence

`navigator.storage.persist()` is requested **once, after the user has selected and saved a
workspace** — not at startup. Requesting before the user has committed to anything makes a
denial more likely, and a denial is sticky.

The result is recorded in the registry module's runtime state and surfaced in the panel.
A denial is not an error and blocks nothing; storage simply remains best-effort. Where the
browser does not implement the API, the app behaves exactly as today.

### 6.3 Loss recovery

Storage loss on a shared `file://` origin cannot be prevented by this app. Each loss is made
detectable and explicit instead of silent:

| Lost | Today | After |
|---|---|---|
| directory handle | silent return to the folder picker | explicit message: the workspace link was lost, re-select the folder; data on disk is untouched |
| label overrides | custom labels silently revert to defaults | detected on load; offer to restore from the disk snapshot written by `src/data/workspace/labelsSnapshot.ts` |
| device id | new id minted silently | accepted; documented behaviour, no user action, event ids simply change going forward |
| auth session | logged out | accepted; already the expected path |

### 6.4 Storage health panel

A section in the Settings tab showing:

- Quota used and available, via `navigator.storage.estimate()`.
- Whether persistence was granted, denied, or unsupported.
- The keys and database this app owns, read from the registry, with their purposes.
- Whether the app is running on a shared `file://` origin, with a short explanation of what
  that means for durability.
- Other databases present on the origin, listed via `indexedDB.databases()`, read-only and
  clearly labelled as belonging to other applications. They are never deleted or modified.
- A reset action that clears only the registry's own entries. It never touches foreign
  databases and never touches the workspace folder on disk. It requires confirmation and
  states plainly that business data is unaffected.

All strings are label keys, not inline Arabic.

### 6.5 Documentation correction

`CLAUDE.md` documents the auth session as living in `sessionStorage`. `src/auth/authSession.ts`
records that it moved to `localStorage` under an owner-approved SEC-02 relaxation. The code is
correct; `CLAUDE.md` is corrected to match, and the storage table in `CLAUDE.md` is updated to
reference the registry as the source of truth.

## 7. Module boundaries

| Module | Responsibility | Depends on |
|---|---|---|
| `src/branding/appManifest.ts` | build and register the manifest | `appIcons.generated.ts`, `labelsStore` |
| `src/branding/appIcons.generated.ts` | committed base64 icon data URIs | nothing |
| `scripts/generate-app-icons.mjs` | dev-only rasterisation | not imported by the app |
| `src/data/storage/storageRegistry.ts` | inventory, persistence request, reset | nothing in `src/data` |
| Settings storage panel | render registry state | `storageRegistry`, `labelsStore` |

`storageRegistry.ts` deliberately depends on nothing else in the data layer so it cannot
participate in an import cycle and can be tested in isolation.

## 8. Testing

- `appManifest.test.ts` — manifest object shape: required members present, `start_url` and
  `scope` derived from a supplied location, name matches the label key, icons carry correct
  sizes and purposes.
- `storageRegistry.test.ts` — inventory completeness; reset clears only registry entries;
  persistence request handles granted, denied, and unsupported without throwing.
- A repository-wide test asserting every browser-storage key literal in `src/` is registered.
- Settings panel component test under jsdom with `estimate()` and `databases()` mocked,
  including the shared-origin warning and the foreign-database listing.
- Loss-recovery paths: handle absent, label snapshot present and absent.

Existing sampling, distribution, and report determinism is untouched by this work; no snapshot
changes are expected, and any snapshot diff is a defect.

## 9. Browser verification

Chrome's handling of blob-URL manifests is the one unverified assumption in this design and is
not settled by reading specifications. Before this work is called done:

1. Serve the built file on `http://localhost` and open Chrome DevTools → Application → Manifest.
2. Confirm the manifest is parsed, name and icons resolve, and no errors are listed.
3. Confirm the install affordance appears and the installed window shows the correct name and icon.
4. Confirm that opening the same file as `file://` produces no console errors and no behaviour change.

If blob-URL manifests are not honoured, `registerAppManifest()` is the only function that
changes; contents and icon pipeline are unaffected.

This step is mandatory. This repository has a documented history of effect-timing and
state-machine defects surviving self-review, so reading the code is not evidence.

## 10. Migration and rollback

No data migration. No on-disk format changes. No changes to the workspace folder.

Rollback is removing the `registerAppManifest()` call and the Settings panel; storage keys are
unchanged throughout, so no state is stranded by reverting. The persistence grant, if
obtained, persists harmlessly and can be revoked by the user through Chrome site settings.

## 11. Acceptance criteria

1. `npm run build` produces exactly one file, `dist/index.html`, and `public/` remains empty.
2. Opened as `file://`, the app behaves as it does today with no new console output.
3. Served on `http://localhost`, DevTools → Application → Manifest shows the manifest parsed
   with no errors, correct name, and all three icons resolving.
4. The app installs and the installed window shows the icon and the name
   `نظام متابعة أعمال فحص صور الأشعة`.
5. The icon is a recognisable shield at 512, 192, 48, and 16 pixels.
6. `navigator.storage.persist()` is requested only after a workspace is saved, and a denial
   changes no behaviour.
7. The Settings panel reports quota, persistence state, owned keys, and foreign databases, and
   its reset clears only owned entries.
8. Loss of the directory handle produces an explicit message, not a silent picker.
9. No new runtime or CI install-time dependency; `npm ci` still succeeds offline.
10. `docs/product/HOSTING_FOR_INSTALL.md` exists and states the HTTPS, path-stability, and
    `manifest-src blob:` requirements.
11. Gates pass: `lint`, `typecheck`, `test:run`.

## 12. Deferred

Project B — application speed and refresh behaviour: UI state surviving reloads, app-shell
caching once served, avoiding re-reads of unchanged data, and the business-data cache question.
The last of these is governed by
`docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` §8 and is downstream of
Phase C and Phase D approval. It gets its own specification.
