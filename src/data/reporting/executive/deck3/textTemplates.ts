import type { DirectoryHandleLike } from "../../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../../storage/safeWrite";
import { casLoop } from "../../../storage/casLoop";
import { withResourceLock } from "../../../storage/webLocks";
import { getTemplatesRoot } from "../../../workspace/workspacePaths";
import type { DeckTextEntries, DeckTextTemplate } from "./textEdit";

export const DECK_TEXT_TEMPLATES_FILE = "executive-deck-text-templates.json";

/** Upper bound so the single shared file stays small on a network share. */
export const MAX_DECK_TEXT_TEMPLATES = 50;

type TemplatesFile = {
  templates: DeckTextTemplate[];
  revision?: number;
  _writeToken?: string;
};

async function getDir(directoryHandle: DirectoryHandleLike): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

/** Saved text templates, newest first. Missing/unreadable file → empty list. */
export async function loadDeckTextTemplates(directoryHandle: DirectoryHandleLike): Promise<DeckTextTemplate[]> {
  try {
    const dir = await getDir(directoryHandle);
    const result = await safeReadJson<TemplatesFile>(dir, DECK_TEXT_TEMPLATES_FILE);
    if (!result.ok || !Array.isArray(result.value.templates)) return [];
    return [...result.value.templates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** Mutates the template list under the same CAS contract as the edition preference file. */
async function mutateTemplates(
  directoryHandle: DirectoryHandleLike,
  mutate: (current: DeckTextTemplate[]) => DeckTextTemplate[],
): Promise<{ ok: true; templates: DeckTextTemplate[] } | { ok: false; error: string }> {
  try {
    const dir = await getDir(directoryHandle);
    const outcome = await withResourceLock(`${dir.name}/deck-text-templates:rmw`, () =>
      casLoop<{ ok: true; templates: DeckTextTemplate[] }>(
        async (writeToken) => {
          const existing = await safeReadJson<TemplatesFile>(dir, DECK_TEXT_TEMPLATES_FILE);
          const current = existing.ok && Array.isArray(existing.value.templates) ? existing.value.templates : [];
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const templates = mutate(current);
          const next: TemplatesFile = { templates, revision: nextRevision, _writeToken: writeToken };
          await safeWriteJson(dir, DECK_TEXT_TEMPLATES_FILE, next);
          const check = async (): Promise<boolean> => {
            const verify = await safeReadJson<TemplatesFile>(dir, DECK_TEXT_TEMPLATES_FILE);
            return verify.ok && verify.value.revision === nextRevision && verify.value._writeToken === writeToken;
          };
          if (await check()) return { done: true, result: { ok: true as const, templates }, verify: check };
          return { done: false };
        },
        { context: "executiveDeck:textTemplates", conflictError: "تعذّر حفظ قالب العرض: تعارض في الكتابة بعد عدة محاولات." },
      ),
    );
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, templates: outcome.templates };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Adds a template (a same-name one is replaced, so re-saving is an update). */
export async function saveDeckTextTemplate(
  directoryHandle: DirectoryHandleLike,
  name: string,
  entries: DeckTextEntries,
  createdBy: string,
): Promise<{ ok: true; template: DeckTextTemplate } | { ok: false; error: string }> {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "اسم القالب مطلوب." };
  if (Object.keys(entries).length === 0) return { ok: false, error: "لا توجد تعديلات لحفظها." };
  const template: DeckTextTemplate = {
    id: newId(),
    name: trimmed,
    entries,
    createdAt: new Date().toISOString(),
    createdBy,
  };
  const result = await mutateTemplates(directoryHandle, (current) =>
    [template, ...current.filter((t) => t.name !== trimmed)].slice(0, MAX_DECK_TEXT_TEMPLATES),
  );
  return result.ok ? { ok: true, template } : result;
}

export async function deleteDeckTextTemplate(
  directoryHandle: DirectoryHandleLike,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await mutateTemplates(directoryHandle, (current) => current.filter((t) => t.id !== id));
  return result.ok ? { ok: true } : result;
}
