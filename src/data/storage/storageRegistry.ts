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
