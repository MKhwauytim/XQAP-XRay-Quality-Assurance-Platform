// Dev-only persistence for the deck-preview style switcher. Plain Node `fs`
// (not the browser safeWriteJson/File System Access flow the real app uses
// for user workspaces) — this file is imported only from a Vite dev-server
// middleware (deckStyleChoicesPlugin.ts), never from browser or app code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { wrap, isEnvelope, type JsonEnvelope } from "../data/storage/jsonEnvelope";

export type DeckStyleChoices = Record<string, number>;

const EMPTY_ENVELOPE: JsonEnvelope<DeckStyleChoices> = {
  metadata: { schemaVersion: 1, revision: 0, contentHash: "", writtenAt: "" },
  data: {},
};

/** Reads the choices envelope from `path`, recovering to an empty envelope
 *  (revision 0) if the file is missing, unreadable, or not a valid envelope. */
export function readChoices(path: string): JsonEnvelope<DeckStyleChoices> {
  if (!existsSync(path)) return EMPTY_ENVELOPE;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (isEnvelope(raw)) return raw as JsonEnvelope<DeckStyleChoices>;
    return EMPTY_ENVELOPE;
  } catch {
    return EMPTY_ENVELOPE;
  }
}

/** Merges `{ [slideId]: variantIndex }` into the choices at `path` and writes
 *  the result back as a `JsonEnvelope`, creating parent directories as needed. */
export function writeChoice(path: string, slideId: string, variantIndex: number): void {
  const current = readChoices(path);
  const next: DeckStyleChoices = { ...current.data, [slideId]: variantIndex };
  const envelope = wrap(next, current.metadata.revision);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(envelope, null, 2), "utf-8");
}
