# Manifest and Storage Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app an installable web app manifest with a proper ZATCA-shield icon, and make its browser-storage use correct — registered, persistent where possible, and recoverable when lost.

**Architecture:** The manifest is built in TypeScript and registered at runtime as a `blob:` URL, so no second file is ever emitted and `dist/` stays a single `index.html`. Icons are rasterised by a manual developer script into a committed TypeScript module of base64 data URIs, so neither the build nor CI gains a dependency. A new `storageRegistry.ts` becomes the single source of truth for every browser-storage location the app owns; the persistence request, the reset action, and the Settings health panel all read from it.

**Tech Stack:** React 19, TypeScript (strict, `erasableSyntaxOnly`), Vite, Vitest (node default; jsdom per-file), File System Access API.

**Spec:** `docs/superpowers/specs/2026-08-10-manifest-and-storage-correctness-design.md`

## Global Constraints

- `dist/` must contain exactly one file, `index.html`. `public/` must stay empty — anything placed there is copied to `dist/` and breaks the guarantee.
- No new runtime dependency and no new install-time dependency. `npm ci` must still succeed without network access to the SheetJS CDN. Rasterisation tooling is installed with `--no-save` and never enters `package.json`.
- All user-facing Arabic strings go in `DEFAULT_LABELS` in `src/data/labels/labelsStore.ts`. Do not inline Arabic in components.
- App display name is exactly `نظام متابعة أعمال فحص صور الأشعة`. Short name is exactly `XQAP`.
- `theme_color` and `background_color` are exactly `#17365d`.
- Do not delete or modify IndexedDB databases the app does not own. `xray-workspace`, `ComplianceSystem_V2`, `kanban-fs`, `AuditSampleReportDB`, and `zatca_folder_db_v1` belong to other applications sharing the `file://` origin.
- Never write to or modify the user's workspace folder in this work.
- Tests import from `vitest` explicitly — `globals: false`. Component tests need `/* @vitest-environment jsdom */` as line 1.
- Type-only imports use `import type`.
- Sampling, distribution folding, and report builders are deterministic by contract. This work must not change their output; any snapshot diff is a defect.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/data/storage/storageRegistry.ts` | Inventory of every owned storage location; persistence request; scoped reset |
| `src/data/storage/storageRegistry.test.ts` | Inventory, reset scoping, persistence outcomes |
| `src/data/storage/storageKeyCoverage.test.ts` | Repo-wide guard: every storage key literal in `src/` is registered |
| `src/branding/appManifest.ts` | Build the manifest object; register it as a blob URL |
| `src/branding/appManifest.test.ts` | Manifest shape and derived `start_url` / `scope` |
| `src/branding/appIcons.generated.ts` | Committed base64 PNG data URIs (generated, do not hand-edit) |
| `src/branding/zatca-shield.svg` | Owner-supplied official shield, full detail |
| `src/branding/zatca-shield-compact.svg` | Hand-simplified variant for small sizes |
| `scripts/generate-app-icons.mjs` | Manual rasterisation; writes `appIcons.generated.ts` |
| `src/components/Sidebar/Tabs/Settings/StorageSection.tsx` | Storage health panel |
| `src/components/Sidebar/Tabs/Settings/StorageSection.css` | Panel styles |
| `src/components/Sidebar/Tabs/Settings/StorageSection.test.tsx` | Panel rendering and reset behaviour |
| `docs/product/HOSTING_FOR_INSTALL.md` | What an intranet host must provide |

Modified: `src/main.tsx`, `index.html`, `src/auth/AuthGate.tsx`, `src/data/labels/labelsStore.ts`, `src/data/workspace/workspacePersistence.ts`, `src/data/workspace/WorkspaceGate.tsx`, `src/components/Sidebar/Tabs/Settings/index.tsx`, `CLAUDE.md`.

---

## Task 1: Storage registry

**Files:**
- Create: `src/data/storage/storageRegistry.ts`
- Test: `src/data/storage/storageRegistry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type StorageLayer = "local" | "session" | "indexeddb"`
  - `type StorageEntry = { id: string; layer: StorageLayer; purpose: string; lossConsequence: string; prefix?: boolean }`
  - `STORAGE_REGISTRY: readonly StorageEntry[]`
  - `listOwnedKeys(): string[]`
  - `isOwnedKey(key: string): boolean`
  - `clearOwnedStorage(): Promise<void>`

This module must not import anything else from `src/data`, so it cannot join an import cycle.

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/storageRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  STORAGE_REGISTRY,
  isOwnedKey,
  listOwnedKeys,
  clearOwnedStorage,
} from "./storageRegistry";

describe("storageRegistry", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("registers every known storage location with a purpose and a loss consequence", () => {
    const ids = STORAGE_REGISTRY.map((entry) => entry.id);
    expect(ids).toContain("xray_auth_session_v1");
    expect(ids).toContain("xray_custom_labels_v1");
    expect(ids).toContain("xray_distribution_device_id_v1");
    expect(ids).toContain("xray_last_login_username_v1");
    expect(ids).toContain("xray_firstrun_dismissed_v1:");
    expect(ids).toContain("xray_global_month_v1");
    expect(ids).toContain("xray-quality-app-persistence");

    for (const entry of STORAGE_REGISTRY) {
      expect(entry.purpose.length).toBeGreaterThan(0);
      expect(entry.lossConsequence.length).toBeGreaterThan(0);
    }
  });

  it("recognises exact keys and prefixed keys as owned", () => {
    expect(isOwnedKey("xray_auth_session_v1")).toBe(true);
    expect(isOwnedKey("xray_firstrun_dismissed_v1:my-workspace")).toBe(true);
    expect(isOwnedKey("ComplianceSystem_V2_token")).toBe(false);
  });

  it("lists only web-storage keys, not databases", () => {
    expect(listOwnedKeys()).toContain("xray_auth_session_v1");
    expect(listOwnedKeys()).not.toContain("xray-quality-app-persistence");
  });

  it("clears only owned keys and leaves foreign keys untouched", async () => {
    localStorage.setItem("xray_auth_session_v1", "a");
    localStorage.setItem("xray_firstrun_dismissed_v1:ws", "1");
    localStorage.setItem("kanban-fs-state", "keep me");
    sessionStorage.setItem("xray_global_month_v1", "5-May-2026");
    sessionStorage.setItem("other_app_state", "keep me too");

    await clearOwnedStorage();

    expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    expect(localStorage.getItem("xray_firstrun_dismissed_v1:ws")).toBeNull();
    expect(localStorage.getItem("kanban-fs-state")).toBe("keep me");
    expect(sessionStorage.getItem("xray_global_month_v1")).toBeNull();
    expect(sessionStorage.getItem("other_app_state")).toBe("keep me too");
  });
});
```

Add `/* @vitest-environment jsdom */` as line 1 of this file — it needs `localStorage`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/storage/storageRegistry.test.ts`
Expected: FAIL — cannot resolve `./storageRegistry`.

- [ ] **Step 3: Write the implementation**

Create `src/data/storage/storageRegistry.ts`:

```ts
/**
 * Single source of truth for every browser-storage location this app owns.
 *
 * The app frequently runs from a `file://` origin, where every local HTML
 * application on the machine shares one storage bucket. Prefixing prevents
 * collisions, but it cannot stop a neighbouring app from clearing the origin.
 * This registry exists so the storage panel, the reset action, and the
 * coverage test all agree on exactly what belongs to us — and so nothing we
 * do can ever touch what does not.
 */

export type StorageLayer = "local" | "session" | "indexeddb";

export type StorageEntry = {
  /** Exact key or database name. When `prefix` is true, keys starting with this are owned. */
  id: string;
  layer: StorageLayer;
  purpose: string;
  lossConsequence: string;
  prefix?: boolean;
};

export const STORAGE_REGISTRY: readonly StorageEntry[] = [
  {
    id: "xray_auth_session_v1",
    layer: "local",
    purpose: "Signed-in session (SEC-02: localStorage, not sessionStorage).",
    lossConsequence: "The user is signed out. Expected, no data at risk.",
  },
  {
    id: "xray_custom_labels_v1",
    layer: "local",
    purpose: "Admin overrides for UI label text.",
    lossConsequence: "Custom wording reverts to defaults; restorable from the workspace snapshot.",
  },
  {
    id: "xray_distribution_device_id_v1",
    layer: "local",
    purpose: "Stable per-machine id embedded in distribution event ids.",
    lossConsequence: "A new id is minted. Past events are unaffected; future ids differ.",
  },
  {
    id: "xray_last_login_username_v1",
    layer: "local",
    purpose: "Pre-fills the username field on the sign-in screen.",
    lossConsequence: "The username must be typed once more.",
  },
  {
    id: "xray_firstrun_dismissed_v1:",
    layer: "local",
    prefix: true,
    purpose: "Per-workspace dismissal of the first-run guidance panel.",
    lossConsequence: "The first-run panel appears again once.",
  },
  {
    id: "xray_global_month_v1",
    layer: "session",
    purpose: "The month selected in the toolbar, for this tab only.",
    lossConsequence: "The month selection resets. No data at risk.",
  },
  {
    id: "xray-quality-app-persistence",
    layer: "indexeddb",
    purpose: "Handle for the last selected workspace folder.",
    lossConsequence: "The workspace link is lost and the folder must be re-selected. Files on disk are untouched.",
  },
] as const;

function matches(entry: StorageEntry, key: string): boolean {
  return entry.prefix ? key.startsWith(entry.id) : key === entry.id;
}

/** Registered web-storage keys only. Databases are excluded. */
export function listOwnedKeys(): string[] {
  return STORAGE_REGISTRY.filter((entry) => entry.layer !== "indexeddb").map((entry) => entry.id);
}

export function isOwnedKey(key: string): boolean {
  return STORAGE_REGISTRY.some((entry) => entry.layer !== "indexeddb" && matches(entry, key));
}

function clearFrom(store: Storage, layer: StorageLayer): void {
  const doomed: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key === null) continue;
    const owned = STORAGE_REGISTRY.some((entry) => entry.layer === layer && matches(entry, key));
    if (owned) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}

/**
 * Removes only registered entries. Never calls `clear()` — that would destroy
 * other applications' data on the shared file:// origin.
 */
export async function clearOwnedStorage(): Promise<void> {
  try {
    clearFrom(localStorage, "local");
  } catch {
    // storage unavailable; nothing to clear
  }
  try {
    clearFrom(sessionStorage, "session");
  } catch {
    // storage unavailable; nothing to clear
  }

  const databases = STORAGE_REGISTRY.filter((entry) => entry.layer === "indexeddb");
  await Promise.all(
    databases.map(
      (entry) =>
        new Promise<void>((resolve) => {
          if (typeof indexedDB === "undefined") {
            resolve();
            return;
          }
          const request = indexedDB.deleteDatabase(entry.id);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })
    )
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/storage/storageRegistry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/storage/storageRegistry.ts src/data/storage/storageRegistry.test.ts
git commit -m "Add (storage): registry of owned browser-storage locations"
```

---

## Task 2: Storage key coverage guard

**Files:**
- Create: `src/data/storage/storageKeyCoverage.test.ts`

**Interfaces:**
- Consumes: `STORAGE_REGISTRY` from Task 1.
- Produces: nothing consumed by later tasks.

This test makes an unregistered storage key a build failure instead of a silent addition. It runs in the default node environment and reads the source tree from disk.

- [ ] **Step 1: Write the test**

Create `src/data/storage/storageKeyCoverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { STORAGE_REGISTRY } from "./storageRegistry";

// Any string literal passed to a web-storage method. Captures the key argument.
const STORAGE_CALL = /(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*"([^"]+)"/g;

function isRegistered(key: string): boolean {
  return STORAGE_REGISTRY.some((entry) =>
    entry.prefix ? key.startsWith(entry.id) : key === entry.id
  );
}

describe("storage key coverage", () => {
  it("has every literal storage key in src/ registered in STORAGE_REGISTRY", () => {
    const files = globSync("src/**/*.{ts,tsx}", { exclude: (p) => p.includes(".test.") });
    const unregistered: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(STORAGE_CALL)) {
        const key = match[1];
        if (!isRegistered(key)) unregistered.push(`${file}: "${key}"`);
      }
    }

    expect(unregistered).toEqual([]);
  });

  // Without this, the test above passes vacuously if the regex or the
  // registry lookup silently stops matching anything.
  it("actually detects an unregistered key", () => {
    const sample = 'localStorage.setItem("some_other_app_key", value);';
    const found = [...sample.matchAll(STORAGE_CALL)].map((m) => m[1]);
    expect(found).toEqual(["some_other_app_key"]);
    expect(isRegistered("some_other_app_key")).toBe(false);
    expect(isRegistered("xray_auth_session_v1")).toBe(true);
  });

  it("scans a non-empty set of source files", () => {
    const files = globSync("src/**/*.{ts,tsx}", { exclude: (p) => p.includes(".test.") });
    expect(files.length).toBeGreaterThan(100);
  });
});
```

Note: `STORAGE_CALL` uses the `g` flag, so reset `STORAGE_CALL.lastIndex = 0` between
`matchAll` uses if you refactor it into a shared helper.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/data/storage/storageKeyCoverage.test.ts`
Expected: PASS with an empty array. If it fails, the listed keys are real gaps — add them to `STORAGE_REGISTRY` rather than weakening the regex.

Note: most call sites use a `const KEY = "..."` indirection, so the regex will match few or no literals directly. That is acceptable — the test's job is to catch newly-added inline keys. If `globSync` is unavailable on the pinned Node version, substitute `fast-glob` only if it is already a devDependency; otherwise walk the tree with `node:fs.readdirSync` recursively.

- [ ] **Step 3: Commit**

```bash
git add src/data/storage/storageKeyCoverage.test.ts
git commit -m "Add (tests): guard that every storage key literal is registered"
```

---

## Task 3: Storage persistence request

**Files:**
- Modify: `src/data/storage/storageRegistry.ts`
- Modify: `src/data/workspace/workspacePersistence.ts:39-59` (inside `saveLastWorkspace`)
- Test: `src/data/storage/storageRegistry.test.ts`

**Interfaces:**
- Produces:
  - `type PersistenceState = "granted" | "denied" | "unsupported" | "unknown"`
  - `requestStoragePersistence(): Promise<PersistenceState>`
  - `getPersistenceState(): PersistenceState`

Requested only after a workspace is saved — a permission request before the user has committed is likelier to be denied, and denial is sticky.

- [ ] **Step 1: Write the failing test**

Append to `src/data/storage/storageRegistry.test.ts`:

```ts
import { requestStoragePersistence, getPersistenceState } from "./storageRegistry";

describe("storage persistence", () => {
  it("reports unsupported when the API is absent", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });

    await expect(requestStoragePersistence()).resolves.toBe("unsupported");
    expect(getPersistenceState()).toBe("unsupported");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("reports granted when the browser grants persistence", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => true },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("granted");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("reports denied without throwing when the browser refuses", async () => {
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false, persist: async () => false },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("denied");

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });

  it("does not re-request once already persisted", async () => {
    let persistCalls = 0;
    const original = navigator.storage;
    Object.defineProperty(navigator, "storage", {
      value: {
        persisted: async () => true,
        persist: async () => {
          persistCalls += 1;
          return true;
        },
      },
      configurable: true,
    });

    await expect(requestStoragePersistence()).resolves.toBe("granted");
    expect(persistCalls).toBe(0);

    Object.defineProperty(navigator, "storage", { value: original, configurable: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/storage/storageRegistry.test.ts`
Expected: FAIL — `requestStoragePersistence` is not exported.

- [ ] **Step 3: Implement**

Append to `src/data/storage/storageRegistry.ts`:

```ts
export type PersistenceState = "granted" | "denied" | "unsupported" | "unknown";

let persistenceState: PersistenceState = "unknown";

export function getPersistenceState(): PersistenceState {
  return persistenceState;
}

/**
 * Asks the browser to make this origin's storage persistent, so the saved
 * workspace handle survives disk pressure. Called only after a workspace has
 * been saved: asking before the user has committed to anything makes denial
 * more likely, and denial is sticky.
 *
 * A denial is not an error. Storage simply stays best-effort.
 */
export async function requestStoragePersistence(): Promise<PersistenceState> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.persist !== "function") {
    persistenceState = "unsupported";
    return persistenceState;
  }

  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) {
      persistenceState = "granted";
      return persistenceState;
    }
    persistenceState = (await storage.persist()) ? "granted" : "denied";
  } catch {
    persistenceState = "denied";
  }
  return persistenceState;
}
```

- [ ] **Step 4: Wire it into the workspace save**

In `src/data/workspace/workspacePersistence.ts`, add the import at the top:

```ts
import { requestStoragePersistence } from "../storage/storageRegistry";
```

Then in `saveLastWorkspace`, replace the `finally` block so the request fires after a successful save:

```ts
  } finally {
    db.close();
  }

  // The handle is now the only link back to the user's folder. Ask the browser
  // to stop treating this origin's storage as evictable, now that the user has
  // committed to a workspace. A refusal changes nothing.
  void requestStoragePersistence();
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/storage/storageRegistry.test.ts src/data/workspace/`
Expected: PASS. The workspace tests must be unaffected — `requestStoragePersistence` resolves to `"unsupported"` under the node environment and never throws.

- [ ] **Step 6: Commit**

```bash
git add src/data/storage/storageRegistry.ts src/data/storage/storageRegistry.test.ts src/data/workspace/workspacePersistence.ts
git commit -m "Add (storage): request persistence once a workspace is saved"
```

---

## Task 4: Explicit recovery when the workspace handle is lost

**Files:**
- Modify: `src/data/labels/labelsStore.ts` (add label keys)
- Modify: `src/data/workspace/WorkspaceGate.tsx`
- Test: existing `src/data/workspace/` tests must still pass

**Interfaces:**
- Consumes: `getPersistenceState` from Task 3.
- Produces: label keys `storage_handle_lost_title`, `storage_handle_lost_body`.

Today, an evicted handle silently returns the user to the folder picker with no explanation. The fix is a message, not a behaviour change.

- [ ] **Step 1: Add the label keys**

In `src/data/labels/labelsStore.ts`, add to `DEFAULT_LABELS` immediately before the closing `} as const;` at line 676:

```ts
  storage_handle_lost_title:           "تم فقد الارتباط بمجلد العمل",
  storage_handle_lost_body:            "لم يعد المتصفح يحتفظ بالإذن للوصول إلى مجلد العمل المحفوظ. لم يتم حذف أي بيانات — الملفات على القرص كما هي. اختر المجلد مرة أخرى للمتابعة.",
```

- [ ] **Step 2: Write the failing test**

Create the test file `src/data/workspace/handleLossMessage.test.tsx` with `/* @vitest-environment jsdom */` as line 1:

```ts
/* @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { DEFAULT_LABELS } from "../labels/labelsStore";

describe("workspace handle loss messaging", () => {
  it("provides Arabic copy explaining that no data was deleted", () => {
    expect(DEFAULT_LABELS.storage_handle_lost_title).toBeTruthy();
    expect(DEFAULT_LABELS.storage_handle_lost_body).toContain("لم يتم حذف أي بيانات");
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/data/workspace/handleLossMessage.test.tsx`
Expected: PASS once Step 1 is applied; FAIL beforehand with an undefined property.

- [ ] **Step 4: Render the message**

In `src/data/workspace/WorkspaceGate.tsx`, find where a previously-saved workspace fails to resolve and the picker is shown. Render the notice above the picker, reading both strings through `useLabels()` — do not inline Arabic. Show it only when a save had previously succeeded and the handle is now absent, so a genuine first run does not display it.

- [ ] **Step 5: Add the label-override loss keys**

Spec §6.3 also requires detecting lost label overrides. `src/data/workspace/labelsSnapshot.ts`
already writes a snapshot of the overrides to the workspace, so recovery is possible whenever
`xray_custom_labels_v1` is gone but a snapshot exists on disk.

Add to `DEFAULT_LABELS`:

```ts
  storage_labels_lost_title:           "تم فقد التسميات المخصصة",
  storage_labels_lost_body:            "لم تعد التسميات المخصصة موجودة في هذا المتصفح، لكن توجد نسخة محفوظة في مجلد العمل.",
  storage_labels_restore_button:       "استعادة التسميات من مجلد العمل",
```

- [ ] **Step 6: Write the failing test**

Create `src/data/workspace/labelsLossRecovery.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldOfferLabelRestore } from "./labelsSnapshot";

describe("shouldOfferLabelRestore", () => {
  it("offers a restore when local overrides are empty but a snapshot exists", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 12 })).toBe(true);
  });

  it("stays silent on a genuine first run with no snapshot", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 0 })).toBe(false);
  });

  it("stays silent when local overrides are intact", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 12, snapshotOverrideCount: 12 })).toBe(false);
  });

  it("does not treat a deliberate reset-to-defaults as a loss when the snapshot is also empty", () => {
    expect(shouldOfferLabelRestore({ localOverrideCount: 0, snapshotOverrideCount: 0 })).toBe(false);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/data/workspace/labelsLossRecovery.test.ts`
Expected: FAIL — `shouldOfferLabelRestore` is not exported.

- [ ] **Step 8: Implement the predicate**

Append to `src/data/workspace/labelsSnapshot.ts`:

```ts
export type LabelRestoreCheck = {
  localOverrideCount: number;
  snapshotOverrideCount: number;
};

/**
 * Label overrides live only in localStorage, which a neighbouring app on the
 * shared file:// origin can wipe. When they vanish but the workspace snapshot
 * still holds some, that is a loss worth offering to undo — as opposed to a
 * first run or a deliberate reset, where the snapshot is empty too.
 */
export function shouldOfferLabelRestore(check: LabelRestoreCheck): boolean {
  return check.localOverrideCount === 0 && check.snapshotOverrideCount > 0;
}
```

- [ ] **Step 9: Surface the offer**

In the Settings tab, where `exportLabelsSnapshot` is already imported, read the snapshot on
mount and call `shouldOfferLabelRestore` with the count from `getCustomLabelOverrides()`. When
it returns true, render the three Step 5 labels with a button that applies the snapshot's
overrides through `setLabel`. Never apply automatically — a silent rewrite of the user's UI
text is worse than the loss.

- [ ] **Step 10: Run the workspace and settings suites**

Run: `npx vitest run src/data/workspace/ src/components/Sidebar/Tabs/Settings/`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/data/labels/labelsStore.ts src/data/workspace/WorkspaceGate.tsx src/data/workspace/handleLossMessage.test.tsx src/data/workspace/labelsSnapshot.ts src/data/workspace/labelsLossRecovery.test.ts src/components/Sidebar/Tabs/Settings/index.tsx
git commit -m "Add (workspace): explain lost folder links and offer label-override restore"
```

---

## Task 5: Storage health panel in Settings

**Files:**
- Create: `src/components/Sidebar/Tabs/Settings/StorageSection.tsx`
- Create: `src/components/Sidebar/Tabs/Settings/StorageSection.css`
- Create: `src/components/Sidebar/Tabs/Settings/StorageSection.test.tsx`
- Modify: `src/components/Sidebar/Tabs/Settings/index.tsx:485-486`
- Modify: `src/data/labels/labelsStore.ts`

**Interfaces:**
- Consumes: `STORAGE_REGISTRY`, `clearOwnedStorage`, `getPersistenceState` from Tasks 1 and 3.
- Produces: `export function StorageSection(): JSX.Element | null`.

Follow the structure of the sibling `ErrorLogSection.tsx`: a collapsible section, permission-gated, its own CSS file, its own test.

- [ ] **Step 1: Add the label keys**

In `DEFAULT_LABELS`, before the closing `} as const;`:

```ts
  storage_section_title:               "حالة التخزين في المتصفح",
  storage_quota_label:                 "المساحة المستخدمة",
  storage_persistence_granted:         "التخزين دائم — لن يحذفه المتصفح تلقائياً.",
  storage_persistence_denied:          "التخزين مؤقت — قد يحذفه المتصفح عند امتلاء القرص.",
  storage_persistence_unsupported:     "المتصفح لا يدعم التخزين الدائم.",
  storage_shared_origin_warning:       "التطبيق يعمل من ملف محلي، ويشارك مساحة التخزين مع أي صفحة محلية أخرى على هذا الجهاز. مسح بيانات المتصفح من أي تطبيق آخر سيمسح إعدادات هذا التطبيق أيضاً. بيانات العمل في مجلد العمل على القرص غير متأثرة.",
  storage_owned_keys_title:            "ما يحفظه هذا التطبيق",
  storage_foreign_dbs_title:           "قواعد بيانات تخص تطبيقات أخرى",
  storage_foreign_dbs_note:            "هذه لا تخص هذا التطبيق ولن يتم المساس بها.",
  storage_reset_button:                "مسح إعدادات التطبيق",
  storage_reset_confirm:               "سيتم مسح الجلسة والتسميات المخصصة وارتباط مجلد العمل. لن يتم حذف أي ملف من مجلد العمل على القرص. هل تريد المتابعة؟",
```

- [ ] **Step 2: Write the failing test**

Create `src/components/Sidebar/Tabs/Settings/StorageSection.test.tsx`:

```tsx
/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StorageSection } from "./StorageSection";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";

describe("StorageSection", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: async () => ({ usage: 5_000_000, quota: 100_000_000 }),
        persisted: async () => true,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: {
        databases: async () => [
          { name: "xray-quality-app-persistence" },
          { name: "kanban-fs" },
        ],
      },
      configurable: true,
    });
  });

  it("lists the storage this app owns", async () => {
    render(<StorageSection />);
    expect(await screen.findByText(DEFAULT_LABELS.storage_owned_keys_title)).toBeInTheDocument();
    expect(await screen.findByText(/xray_auth_session_v1/)).toBeInTheDocument();
  });

  it("lists foreign databases as belonging to other applications", async () => {
    render(<StorageSection />);
    expect(await screen.findByText(/kanban-fs/)).toBeInTheDocument();
    expect(
      await screen.findByText(DEFAULT_LABELS.storage_foreign_dbs_note)
    ).toBeInTheDocument();
  });

  it("does not offer to delete foreign databases", async () => {
    render(<StorageSection />);
    const foreign = await screen.findByText(/kanban-fs/);
    const row = foreign.closest("li");
    expect(row?.querySelector("button")).toBeNull();
  });

  it("clears nothing when the confirmation is declined", async () => {
    localStorage.setItem("xray_auth_session_v1", "session-token");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();

    expect(confirmSpy).toHaveBeenCalledWith(DEFAULT_LABELS.storage_reset_confirm);
    // Declined: the key must survive.
    expect(localStorage.getItem("xray_auth_session_v1")).toBe("session-token");
    confirmSpy.mockRestore();
  });

  it("clears owned keys but not foreign ones when confirmed", async () => {
    localStorage.setItem("xray_auth_session_v1", "session-token");
    localStorage.setItem("kanban-fs-state", "foreign");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();
    await vi.waitFor(() => {
      expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    });

    expect(localStorage.getItem("kanban-fs-state")).toBe("foreign");
    confirmSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/StorageSection.test.tsx`
Expected: FAIL — cannot resolve `./StorageSection`.

- [ ] **Step 4: Implement the component**

Create `StorageSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  STORAGE_REGISTRY,
  clearOwnedStorage,
  getPersistenceState,
  type PersistenceState,
} from "../../../../data/storage/storageRegistry";
import { useLabels } from "../../../../data/labels/useLabels";
import "./StorageSection.css";

type Estimate = { usage: number; quota: number } | null;

const OWNED_DB_NAMES = STORAGE_REGISTRY.filter((e) => e.layer === "indexeddb").map((e) => e.id);

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function persistenceLabelKey(state: PersistenceState) {
  if (state === "granted") return "storage_persistence_granted" as const;
  if (state === "unsupported") return "storage_persistence_unsupported" as const;
  // "unknown" is displayed as non-persistent: it is not yet guaranteed.
  return "storage_persistence_denied" as const;
}

export function StorageSection() {
  const labels = useLabels();
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [foreignDbs, setForeignDbs] = useState<string[]>([]);
  const [persistence, setPersistence] = useState<PersistenceState>(getPersistenceState());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await navigator.storage?.estimate?.();
        if (!cancelled && result?.usage != null && result.quota != null) {
          setEstimate({ usage: result.usage, quota: result.quota });
        }
      } catch {
        // estimate unavailable; the panel simply omits the figure
      }

      try {
        const dbs = (await indexedDB?.databases?.()) ?? [];
        const foreign = dbs
          .map((db) => db.name)
          .filter((name): name is string => Boolean(name) && !OWNED_DB_NAMES.includes(name));
        if (!cancelled) setForeignDbs(foreign);
      } catch {
        // databases() unsupported; the foreign list stays empty
      }

      if (!cancelled) setPersistence(getPersistenceState());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReset() {
    if (!window.confirm(labels.storage_reset_confirm)) return;
    await clearOwnedStorage();
  }

  const isSharedOrigin = typeof location !== "undefined" && location.protocol === "file:";

  return (
    <section className="storage-section" dir="rtl">
      <h2>{labels.storage_section_title}</h2>

      {estimate && (
        <p className="storage-quota">
          {labels.storage_quota_label}: {formatBytes(estimate.usage)} /{" "}
          {formatBytes(estimate.quota)}
        </p>
      )}

      <p className="storage-persistence">{labels[persistenceLabelKey(persistence)]}</p>

      {isSharedOrigin && (
        <p className="storage-warning">{labels.storage_shared_origin_warning}</p>
      )}

      <h3>{labels.storage_owned_keys_title}</h3>
      <ul className="storage-owned">
        {STORAGE_REGISTRY.map((entry) => (
          <li key={entry.id}>
            <code>{entry.id}</code>
            <span>{entry.purpose}</span>
          </li>
        ))}
      </ul>

      {foreignDbs.length > 0 && (
        <>
          <h3>{labels.storage_foreign_dbs_title}</h3>
          <p className="storage-note">{labels.storage_foreign_dbs_note}</p>
          <ul className="storage-foreign">
            {foreignDbs.map((name) => (
              // Deliberately no control here: these belong to other apps.
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" onClick={() => void handleReset()}>
        {labels.storage_reset_button}
      </button>
    </section>
  );
}
```

Create `StorageSection.css` following the conventions in the sibling `ErrorLogSection.css` —
plain co-located CSS, no framework, colour values taken from the existing custom properties
rather than raw hex literals (`npm run check:hex-literals` guards this).

Note on permissions: unlike `ErrorLogSection`, this panel is not gated on a named permission,
because the Settings tab is already restricted to `guest` and `admin` in `tabCatalog.ts` and
the panel exposes only this browser's own storage. If review prefers a gate, add
`usePermissions()` following the `ErrorLogSection` pattern and a matching catalog entry.

- [ ] **Step 5: Mount it in Settings**

In `src/components/Sidebar/Tabs/Settings/index.tsx`, add the import beside the existing section imports and render it next to the others near line 485:

```tsx
      <ErrorLogSection />
      <StorageSection />
      <AboutSection />
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/Sidebar/Tabs/Settings/`
Expected: PASS, including the existing `index.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar/Tabs/Settings/StorageSection.tsx src/components/Sidebar/Tabs/Settings/StorageSection.css src/components/Sidebar/Tabs/Settings/StorageSection.test.tsx src/components/Sidebar/Tabs/Settings/index.tsx src/data/labels/labelsStore.ts
git commit -m "Add (settings): browser storage health panel"
```

---

## Task 6: Manifest module and registration

**Files:**
- Create: `src/branding/appManifest.ts`
- Create: `src/branding/appManifest.test.ts`
- Modify: `src/main.tsx`
- Modify: `index.html`
- Modify: `src/auth/AuthGate.tsx:636`
- Modify: `src/data/labels/labelsStore.ts`

**Interfaces:**
- Consumes: `APP_ICONS` from Task 7. Until Task 7 lands, import from a placeholder module created in Step 3 below.
- Produces:
  - `buildAppManifest(location: { href: string }): AppManifest`
  - `registerAppManifest(): void`
  - label key `app_display_name`

- [ ] **Step 1: Add the app name label key**

In `DEFAULT_LABELS`:

```ts
  app_display_name:                    "نظام متابعة أعمال فحص صور الأشعة",
```

- [ ] **Step 2: Write the failing test**

Create `src/branding/appManifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAppManifest } from "./appManifest";
import { DEFAULT_LABELS } from "../data/labels/labelsStore";

describe("buildAppManifest", () => {
  const manifest = buildAppManifest({ href: "https://intranet.example/xqap/index.html" });

  it("uses the app display name from the label store", () => {
    expect(manifest.name).toBe(DEFAULT_LABELS.app_display_name);
    expect(manifest.short_name).toBe("XQAP");
  });

  it("derives start_url and scope from the document location", () => {
    expect(manifest.start_url).toBe("https://intranet.example/xqap/index.html");
    expect(manifest.scope).toBe("https://intranet.example/xqap/");
  });

  it("declares a standalone RTL Arabic app in the ZATCA navy", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");
    expect(manifest.theme_color).toBe("#17365d");
    expect(manifest.background_color).toBe("#17365d");
    expect(manifest.id).toBe("xqap");
  });

  it("declares 192, 512 and maskable 512 icons as inline data URIs", () => {
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("512x512:maskable");
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("data:image/png;base64,")).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });
});
```

- [ ] **Step 3: Create a placeholder icon module**

Create `src/branding/appIcons.generated.ts` so this task compiles before Task 7 replaces it:

```ts
/**
 * GENERATED FILE — do not hand-edit.
 * Regenerate with: node scripts/generate-app-icons.mjs
 *
 * Placeholder values until the composed ZATCA shield is rasterised in Task 7.
 */
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const APP_ICONS = {
  icon192: PLACEHOLDER_PNG,
  icon512: PLACEHOLDER_PNG,
  icon512Maskable: PLACEHOLDER_PNG,
  faviconSvg: "",
} as const;
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/branding/appManifest.test.ts`
Expected: FAIL — cannot resolve `./appManifest`.

- [ ] **Step 5: Implement**

Create `src/branding/appManifest.ts`:

```ts
import { getLabels } from "../data/labels/labelsStore";
import { APP_ICONS } from "./appIcons.generated";

export type AppManifestIcon = {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable";
};

export type AppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  dir: "rtl";
  lang: "ar";
  theme_color: string;
  background_color: string;
  icons: AppManifestIcon[];
};

const BRAND_NAVY = "#17365d";

const DESCRIPTION =
  "تطبيق محلي لمعالجة بيانات جودة الأشعة وتجهيز مجتمع العينة من ملفات Excel — الهيئة العامة للزكاة والضريبة والجمارك.";

/**
 * `scope` is the directory containing the document. A trailing-file scope would
 * exclude the app from its own navigations.
 */
function scopeFrom(href: string): string {
  const lastSlash = href.lastIndexOf("/");
  return lastSlash === -1 ? href : href.slice(0, lastSlash + 1);
}

export function buildAppManifest(location: { href: string }): AppManifest {
  return {
    id: "xqap",
    name: getLabels().app_display_name,
    short_name: "XQAP",
    description: DESCRIPTION,
    start_url: location.href,
    scope: scopeFrom(location.href),
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    theme_color: BRAND_NAVY,
    background_color: BRAND_NAVY,
    icons: [
      { src: APP_ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: APP_ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: APP_ICONS.icon512Maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Registers the manifest as a blob: URL.
 *
 * A data: URI cannot be used: `start_url` and `scope` resolve relative to the
 * manifest's own URL, and a data: URI has no origin, so Chrome rejects the
 * install. A blob: URL inherits the document origin, so start_url resolves
 * same-origin. This keeps dist/ a single index.html either way.
 *
 * On a file:// origin the browser ignores the manifest entirely — that is the
 * intended silent degradation, not an error.
 *
 * This is the ONLY function that knows how the manifest reaches the browser.
 * If blob: manifests prove unreliable, replace this body and nothing else.
 */
export function registerAppManifest(): void {
  try {
    const manifest = buildAppManifest(window.location);
    const blob = new Blob([JSON.stringify(manifest)], {
      type: "application/manifest+json",
    });
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  } catch {
    // Manifest registration is cosmetic. Never block app start.
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/branding/appManifest.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Register at bootstrap**

In `src/main.tsx`, add the import beside the other branding imports:

```ts
import { registerAppManifest } from "./branding/appManifest";
```

and call it after the font styles are appended, before `createRoot`:

```ts
registerAppManifest();
```

- [ ] **Step 8: Apply the rename**

In `index.html`, replace the `<title>` content with `نظام متابعة أعمال فحص صور الأشعة`, and add below the description meta tag:

```html
    <meta name="author" content="محمد الخويتم — Mkhuwaytim" />
```

In `src/auth/AuthGate.tsx:636`, replace the inline literal with the label:

```tsx
            <h1>{labels.app_display_name}</h1>
```

Use the component's existing `labels` binding from `useLabels()`; if it has none, add the hook call following the pattern used elsewhere in the file.

- [ ] **Step 9: Run the affected suites**

Run: `npx vitest run src/branding/ src/auth/`
Expected: PASS. If an auth test asserts the old title text, update the assertion to read `DEFAULT_LABELS.app_display_name` rather than hard-coding the new string.

- [ ] **Step 10: Commit**

```bash
git add src/branding/appManifest.ts src/branding/appManifest.test.ts src/branding/appIcons.generated.ts src/main.tsx index.html src/auth/AuthGate.tsx src/data/labels/labelsStore.ts
git commit -m "Add (branding): installable web app manifest via blob URL; rename app"
```

---

## Task 7: ZATCA shield icons

**Files:**
- Create: `src/branding/zatca-shield.svg` (owner-supplied)
- Create: `src/branding/zatca-shield-compact.svg`
- Create: `scripts/generate-app-icons.mjs`
- Modify: `src/branding/appIcons.generated.ts` (regenerated)
- Modify: `index.html` (favicon)

**Interfaces:**
- Consumes: nothing.
- Produces: `APP_ICONS` with the same four keys defined in Task 6 Step 3 — `icon192`, `icon512`, `icon512Maskable`, `faviconSvg`. The shape must not change, or Task 6 breaks.

**Blocked on:** the owner supplying the official shield at `src/branding/zatca-shield.svg`. Do not start this task without it; do not approximate the emblem.

- [ ] **Step 1: Place the supplied shield**

Save the owner's file as `src/branding/zatca-shield.svg`. If only a PNG was supplied, trace it to SVG first and visually diff the trace against the original at 512px before continuing.

- [ ] **Step 2: Author the compact variant**

Create `src/branding/zatca-shield-compact.svg` by hand from the full mark: same shield silhouette, same blue-to-green gradient, but noticeably fewer and thicker diagonal strokes. This exists because the full mark's thin, widely-spaced diagonals alias into an unreadable smudge at 32px and 16px. Do not attempt to derive this programmatically — stroke simplification of arbitrary artwork is not reliably automatable, and a wrong result ships as the app's face.

Verify by rendering the compact variant at 32px and confirming the shield silhouette is still identifiable.

- [ ] **Step 3: Write the generation script**

Create `scripts/generate-app-icons.mjs`:

```js
/**
 * Manual, developer-only icon generation. NOT part of `npm run build` and NOT
 * part of CI — the app must install with no network access, so the rasteriser
 * is never added to package.json.
 *
 * Usage:
 *   npm i -D --no-save @resvg/resvg-js
 *   node scripts/generate-app-icons.mjs
 *
 * Writes src/branding/appIcons.generated.ts, which IS committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const NAVY = "#17365d";
const FULL = "src/branding/zatca-shield.svg";
const COMPACT = "src/branding/zatca-shield-compact.svg";

/**
 * Composes the shield onto a solid navy tile.
 *
 * `inset` is the fraction of the tile left as margin on each side. Maskable
 * icons need all meaningful content inside the central 80% circle, so they get
 * a larger inset than the plain icons.
 */
function compose(shieldSvg, size, inset) {
  const inner = Math.round(size * (1 - inset * 2));
  const offset = Math.round((size - inner) / 2);
  const body = shieldSvg.replace(/^<\?xml[^>]*\?>/, "").trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${NAVY}"/>
  <g transform="translate(${offset} ${offset})">
    <svg width="${inner}" height="${inner}" viewBox="0 0 512 512">${body}</svg>
  </g>
</svg>`;
}

function rasterise(svg, size) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

const full = readFileSync(FULL, "utf8");
const compact = readFileSync(COMPACT, "utf8");

const icon512 = rasterise(compose(full, 512, 0.12), 512);
const icon192 = rasterise(compose(full, 512, 0.12), 192);
const icon512Maskable = rasterise(compose(full, 512, 0.2), 512);
const favicon = compose(compact, 64, 0.1);

const out = `/**
 * GENERATED FILE — do not hand-edit.
 * Regenerate with: node scripts/generate-app-icons.mjs
 */
export const APP_ICONS = {
  icon192: "${icon192}",
  icon512: "${icon512}",
  icon512Maskable: "${icon512Maskable}",
  faviconSvg: ${JSON.stringify(favicon)},
} as const;
`;

writeFileSync("src/branding/appIcons.generated.ts", out);
console.log("Wrote src/branding/appIcons.generated.ts");
```

- [ ] **Step 4: Generate**

```bash
npm i -D --no-save @resvg/resvg-js
node scripts/generate-app-icons.mjs
```

Then confirm `package.json` is unchanged:

```bash
git diff --exit-code package.json
```

Expected: no output, exit 0. If `package.json` changed, revert it — the dependency must not be recorded.

- [ ] **Step 5: Verify the icons visually**

Open the generated data URIs in a browser at 512, 192, 48, 32, and 16 pixels. The shield silhouette must be identifiable at every size. If it is not at 32 or 16, thicken the compact variant further and regenerate — do not accept an illegible icon.

- [ ] **Step 6: Update the favicon**

In `index.html`, replace the existing `<link rel="icon" …>` data URI with the composed shield favicon from `APP_ICONS.faviconSvg`, so the browser tab matches the installed icon.

- [ ] **Step 7: Run tests and check the bundle**

```bash
npx vitest run src/branding/
npm run build
npm run check:bundle-size
```

Expected: tests PASS; build succeeds; bundle stays inside the 3.6 MB raw / 1.3 MB gzip budget. Three PNGs add roughly 30–80 KB — if the budget is threatened, reduce PNG colour depth in the script rather than dropping a size.

- [ ] **Step 8: Confirm dist is still one file**

```bash
ls dist/
```

Expected: exactly `index.html`.

- [ ] **Step 9: Commit**

```bash
git add src/branding/zatca-shield.svg src/branding/zatca-shield-compact.svg scripts/generate-app-icons.mjs src/branding/appIcons.generated.ts index.html
git commit -m "Add (branding): ZATCA shield app icons on navy, generated offline"
```

---

## Task 8: Documentation

**Files:**
- Create: `docs/product/HOSTING_FOR_INSTALL.md`
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Write the hosting document**

Create `docs/product/HOSTING_FOR_INSTALL.md` stating:

- The app is a single static `index.html`. There is no server component, no API, and no database. All business data lives in the workspace folder the user selects on their own machine.
- Opened by double-click (`file://`) the app works fully, but cannot be installed — browsers ignore a manifest on `file://`.
- To make it installable, serve it over HTTPS, or `http://localhost` for a local trial.
- Serve it with `Content-Type: text/html`.
- Keep the path stable: `scope` derives from the document URL, so moving the file changes the app's install identity.
- Any Content-Security-Policy must allow `blob:` in `manifest-src`, or the manifest will not load and the install option will not appear.
- Chrome or Edge is required regardless of hosting: the workspace features depend on the File System Access API.

- [ ] **Step 2: Correct CLAUDE.md**

In the auth-storage bullet, the session is documented as living in `sessionStorage` with a `xray_auth_session_v1` key. `src/auth/authSession.ts:17` records that it moved to `localStorage` under an owner-approved SEC-02 relaxation, so it survives a browser restart rather than clearing with the tab. Correct the text to match the code, and add a line pointing at `src/data/storage/storageRegistry.ts` as the source of truth for every browser-storage location.

- [ ] **Step 3: Commit**

```bash
git add docs/product/HOSTING_FOR_INSTALL.md CLAUDE.md
git commit -m "Docs: hosting requirements for install; correct auth session storage layer"
```

---

## Task 9: Browser verification and release gates

**Files:** none modified unless a defect is found.

This task is mandatory and cannot be satisfied by reading code. This repository has a documented history of effect-timing and state-machine defects surviving self-review, including after real-browser confirmation.

- [ ] **Step 1: Build and serve**

```bash
npm run build
npm run preview
```

- [ ] **Step 2: Verify the manifest parses**

Open the preview URL in Chrome. Open DevTools → Application → Manifest. Confirm:
- The manifest is listed with no errors or warnings.
- `name` reads `نظام متابعة أعمال فحص صور الأشعة`, `short_name` reads `XQAP`.
- All three icons resolve and render in the panel.
- `start_url` and `scope` point at the served path.

**If the manifest does not appear, blob-URL manifests are not honoured.** Change only `registerAppManifest()` — the contents and icon pipeline are unaffected. Record the finding in the edit-log entry.

- [ ] **Step 3: Verify installation**

Install the app from the Chrome address bar. Confirm the window opens standalone with the correct name and the shield icon, and that the taskbar icon is legible at its rendered size.

- [ ] **Step 4: Verify file:// degradation**

Open `dist/index.html` directly from disk. Confirm the app behaves exactly as before, with no new console errors or warnings.

- [ ] **Step 5: Verify the storage panel against reality**

Sign in, select a workspace, and open Settings. Confirm the panel shows quota, persistence state, the owned keys, and the foreign databases from your actual browser profile — including `xray-workspace` and any others — each labelled as belonging to another application with no delete control.

- [ ] **Step 6: Verify the reset is scoped**

In DevTools → Application, note a foreign key and a foreign database. Use the panel's reset. Confirm the owned keys are gone, the foreign key and database are untouched, and the workspace folder on disk is unchanged.

- [ ] **Step 7: Run the tier-2 gates**

```bash
npm run lint
npm run typecheck
npm run test:run
```

Expected: all pass. Report actual output; do not claim success without it.

- [ ] **Step 8: Write the edit-log entry**

```bash
npm run editlog -- --tier=2 --append "Add (branding): installable manifest, ZATCA shield icons, and browser-storage correctness"
```

Fill in the prose: `Why` (no install identity; evictable storage on a shared file:// origin) and `What changed`, plus the blob-URL verification result from Step 2.

- [ ] **Step 9: Commit**

```bash
git add "docs/edit logs/"
git commit -m "Docs: edit log for manifest and storage correctness"
```
