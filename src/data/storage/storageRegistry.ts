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
    id: "xray_feedback_seen_v1:",
    layer: "local",
    prefix: true,
    purpose:
      "Per-user marker for the newest feedback message/reply that user has already seen (drives the unread dot).",
    lossConsequence: "The unread dot lights up once more; the messages themselves are on disk and untouched.",
  },
  {
    id: "xray_global_month_v1",
    layer: "session",
    purpose: "The month selected in the toolbar, for this tab only.",
    lossConsequence: "The month selection resets. No data at risk.",
  },
  {
    id: "xray_error_log_v1",
    layer: "local",
    purpose: "Mirror of the in-memory error ring buffer (errorLogger.ts), so it survives a reload.",
    lossConsequence: "Recent-error history is lost; the app keeps working with an empty log.",
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

/**
 * Side-effect-free read of whether this origin currently holds persistent
 * storage, via `navigator.storage.persisted()`. Unlike
 * `requestStoragePersistence()`, this never calls `.persist()`, so it cannot
 * itself grant persistence for a genuine first-time visitor.
 *
 * Returns `null` when the probe itself is unavailable (no `navigator.storage`,
 * or no `.persisted` method, or the call throws) so callers can distinguish
 * "we don't know" from "we asked and it said no" and fall back to
 * `getPersistenceState()` accordingly.
 */
export async function probeStoragePersisted(): Promise<boolean | null> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage || typeof storage.persisted !== "function") return null;
  try {
    return await storage.persisted();
  } catch {
    return null;
  }
}

/**
 * Best-effort signal that this browser origin has held persistent storage
 * before — the only thing `requestStoragePersistence()` (called after every
 * successful workspace save, see `workspacePersistence.ts`) leaves behind
 * that outlives a full page reload. `getPersistenceState()` alone only
 * reflects *this* tab's session (it resets to "unknown" on reload), so it is
 * combined with `probeStoragePersisted()`.
 *
 * This is a heuristic, not a certainty: a full "clear site data" wipes the
 * persisted flag along with everything else, so that specific loss path
 * still looks like a first run. It is the best signal available without
 * introducing new storage of our own.
 *
 * Only meaningful on a served (http/https) origin. On `file://` —
 * this app's primary deployment mode, see `isFileOrigin` — the underlying
 * API is typically unsupported (and `navigator.storage` may be absent
 * entirely), so this always resolves false there. Callers on that origin
 * should branch on `isFileOrigin()` rather than rely on this function.
 */
export async function wasStoragePreviouslyPersisted(): Promise<boolean> {
  if (persistenceState === "granted") return true;
  return (await probeStoragePersisted()) === true;
}
