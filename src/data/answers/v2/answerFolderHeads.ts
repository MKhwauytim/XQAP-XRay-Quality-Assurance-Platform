// src/data/answers/v2/answerFolderHeads.ts
//
// Layout v2 change markers for the 45 s sync probe (v154.0 review). Without
// them the probe opened every `answers.events/{assignee}/` folder and stat'd its
// heads on every tick, per client: O(assignees) share round trips where layout
// v1 paid one listing. With them, ONE listing of `answers.events/_heads/`
// reveals every folder that changed, because the change is in the NAMES:
//
//   _heads/{folder}!{writer}!{token}.head   (empty file)
//
// Every successful v2 append (self-save or on-behalf) creates a NEW uniquely
// named marker for its (assignee folder, writer) pair and then removes that
// pair's previous marker. Create-before-remove means a pair is never left
// without a marker by its own writer. Markers are DERIVED metadata: they hold
// no bytes, nothing reads them as answers, and losing all of them only sends
// the probe back to the full per-folder scan (`workspaceSync.ts`). Only this
// module's own `.head` files under `_heads/` are ever removed — never a segment,
// snapshot or any other user data.
//
// Compaction never touches a marker, so it is never reported as a change.
import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { listDirectoryEntries } from "../../storage/directoryScan";
import { logError } from "../../storage/errorLogger";
import { isNotFoundError } from "../../storage/transientFileErrors";
import { ANSWER_EVENTS_FOLDERS, answerAssigneeFolderName } from "../../workspace/workspacePaths";

const HEAD_SUFFIX = ".head";
const SEP = "!";

/** `!` separates fields, so `%` and `!` inside a name are percent-escaped (decodeURIComponent reverses it). */
function escapePart(value: string): string {
  return value.replace(/%/g, "%25").replace(/!/g, "%21");
}

function writerKey(actor: string): string {
  return answerAssigneeFolderName(actor);
}

function newToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function parseAnswerFolderHeadName(name: string): { folder: string; writer: string } | null {
  if (!name.endsWith(HEAD_SUFFIX)) return null;
  const parts = name.slice(0, -HEAD_SUFFIX.length).split(SEP);
  if (parts.length !== 3 || parts[0] === "" || parts[1] === "" || parts[2] === "") return null;
  try {
    return { folder: decodeURIComponent(parts[0]!), writer: decodeURIComponent(parts[1]!) };
  } catch {
    return null;
  }
}

/** This tab's last marker per `{events-dir-path}|{folder}|{writer}`; a pair not in here is swept once (stale markers of an earlier page load). */
const lastMarker = new Map<string, string>();

export function __resetAnswerFolderHeadsForTests(): void {
  lastMarker.clear();
}

/**
 * Best-effort: never throws, never fails the save that called it. A missed
 * touch is covered by the probe's rotating backstop (`workspaceSync.ts`).
 */
export async function touchAnswerFolderHead(
  eventsDir: DirectoryHandleLike,
  assigneeFolder: string,
  actor: string,
  scope = ""
): Promise<void> {
  try {
    const writer = writerKey(actor);
    const prefix = `${escapePart(assigneeFolder)}${SEP}${escapePart(writer)}${SEP}`;
    const name = `${prefix}${newToken()}${HEAD_SUFFIX}`;
    const heads = await eventsDir.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.heads, { create: true });
    await heads.getFileHandle(name, { create: true });
    if (typeof heads.removeEntry !== "function") return;
    const key = `${scope}|${eventsDir.name}|${assigneeFolder}|${writer}`;
    const previous = lastMarker.get(key);
    lastMarker.set(key, name);
    const stale = previous !== undefined
      ? [previous]
      : (await listDirectoryEntries(heads))
          .filter((entry) => entry.kind === "file" && entry.name.startsWith(prefix) && entry.name.endsWith(HEAD_SUFFIX) && entry.name !== name)
          .map((entry) => entry.name);
    for (const old of stale) {
      try {
        // An empty `.head` marker, never written through safeWriteJson: it has no .bak/.tmp siblings to leave behind.
        // eslint-disable-next-line no-restricted-syntax
        await heads.removeEntry(old);
      } catch (error) {
        if (!isNotFoundError(error)) logError("answerFolderHeads:remove", error, { action: old });
      }
    }
  } catch (error) {
    logError("answerFolderHeads:touch", error, { action: assigneeFolder });
  }
}

/**
 * One listing: assignee folder -> its marker names (sorted). Null when `_heads/`
 * does not exist (a month only ever written before markers existed).
 */
export async function readAnswerFolderHeads(eventsDir: DirectoryHandleLike): Promise<Map<string, string[]> | null> {
  let heads: DirectoryHandleLike;
  try {
    heads = await eventsDir.getDirectoryHandle(ANSWER_EVENTS_FOLDERS.heads, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  const out = new Map<string, string[]>();
  for (const entry of await listDirectoryEntries(heads)) {
    if (entry.kind !== "file") continue;
    const parsed = parseAnswerFolderHeadName(entry.name);
    if (!parsed) continue;
    const list = out.get(parsed.folder) ?? [];
    list.push(entry.name);
    out.set(parsed.folder, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/** The writer field of a marker name equals this actor's writer key. */
export function isOwnAnswerFolderHead(name: string, actor: string | undefined): boolean {
  if (!actor) return false;
  try {
    return parseAnswerFolderHeadName(name)?.writer === writerKey(actor);
  } catch {
    return false;
  }
}
