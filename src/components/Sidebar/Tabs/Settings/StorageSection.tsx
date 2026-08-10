import { useEffect, useState } from "react";
import {
  STORAGE_REGISTRY,
  clearOwnedStorage,
  getPersistenceState,
  type PersistenceState,
} from "../../../../data/storage/storageRegistry";
import { isFileOrigin } from "../../../../data/workspace/originDetection";
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
          .filter((name): name is string => Boolean(name))
          .filter((name) => !OWNED_DB_NAMES.includes(name));
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
    try {
      await clearOwnedStorage();
    } catch {
      // Best-effort: localStorage/sessionStorage keys are still cleared even
      // if an indexedDB deletion fails or the API is unavailable in the
      // current environment.
    }
  }

  const isSharedOrigin = isFileOrigin();

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
