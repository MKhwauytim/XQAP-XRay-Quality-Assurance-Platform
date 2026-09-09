import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  safeReadJson,
  safeRemoveJson,
  safeWriteJson,
  type SafeReadResult
} from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import { recordActionHistorySnapshot } from "../history/actionHistory";
import { clearInspectionTemplateSelectionIfMatches } from "./templateSelectionStorage";
import type { TemplateIndex, TemplateSchema } from "./templateTypes";

/**
 * CAS read-modify-write of the shared `templates.index.json`. It is edited by
 * every supervisor/manager/admin on every machine; the outer `withResourceLock`
 * (held by the caller) serializes same-tab writers, while casLoop re-reads fresh,
 * bumps `revision`, stamps `_writeToken`, and verifies both on read-back so a
 * concurrent author's index entry on another machine is never silently dropped.
 *
 * No delayed verify: index entries are eventually-consistent by nature — a
 * transient one-write-behind entry self-heals on the next save. The
 * stronger protection lives on the per-id document (saveTemplateFile,
 * below), which is where real content divergence would actually matter.
 */
async function updateTemplateIndex(
  dir: DirectoryHandleLike,
  apply: (templates: TemplateIndex["templates"]) => TemplateIndex["templates"]
): Promise<void> {
  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const indexResult = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
      const existing: TemplateIndex = indexResult.ok ? indexResult.value : { templates: [] };
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: TemplateIndex = {
        revision: nextRevision,
        _writeToken: writeToken,
        templates: apply(existing.templates),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
      const verify = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { context: "templates:index", conflictError: "تعذّر تحديث فهرس القوالب: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

/**
 * CAS read-modify-write of the shared per-id `{templateId}.json` document. Two
 * admins on two machines can edit the same template concurrently; casLoop bumps
 * `revision`, stamps `_writeToken`, and verifies both on read-back (plus a
 * delayed re-verify) so a concurrent clobber fails loudly and retries rather
 * than silently overwriting the other admin's edit.
 */
async function saveTemplateFile(
  directoryHandle: DirectoryHandleLike,
  dir: DirectoryHandleLike,
  schema: TemplateSchema
): Promise<void> {
  const fileName = `${schema.templateId}.json`;

  // Pre-change snapshot (owner requirement, 2026-09-03): the template as it
  // stood right before THIS save, kept as a rolling last-10 history so an
  // admin's edit can be reviewed/rolled back later. Read and recorded ONCE,
  // outside the CAS retry loop below — a contended save that needs a retry
  // must not mint a second history entry for the same edit.
  const beforeSave = await safeReadJson<TemplateSchema>(dir, fileName);
  await recordActionHistorySnapshot<TemplateSchema>({
    directoryHandle,
    family: "templates",
    scopeParts: [schema.templateId],
    actor: schema.updatedBy ?? "",
    action: beforeSave.ok ? "template-edit" : "template-create",
    previousState: beforeSave.ok ? beforeSave.value : null,
  });

  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const existing = await safeReadJson<TemplateSchema>(dir, fileName);
      const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
      const updated: TemplateSchema = {
        ...schema,
        revision: nextRevision,
        _writeToken: writeToken,
      };
      await safeWriteJson(dir, fileName, updated);
      const verify = await safeReadJson<TemplateSchema>(dir, fileName);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return {
          done: true,
          result: { ok: true as const },
          verify: async () => {
            const recheck = await safeReadJson<TemplateSchema>(dir, fileName);
            return (
              recheck.ok &&
              recheck.value.revision === nextRevision &&
              recheck.value._writeToken === writeToken
            );
          },
        };
      }
      return { done: false };
    },
    { context: "templates:template", conflictError: "تعذّر حفظ القالب: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

const INDEX_FILE = "templates.index.json";

async function getTemplatesDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function saveTemplate(
  directoryHandle: DirectoryHandleLike,
  schema: TemplateSchema
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!schema.templateId || !schema.templateName) {
      return { ok: false, error: "بيانات القالب غير مكتملة، ولم يتم الحفظ." };
    }

    const dir = await getTemplatesDir(directoryHandle);
    await withResourceLock(`${dir.name}/templates-index`, async () => {
      // Shared per-id doc — two admins on two machines can edit the same
      // template. CAS (revision + _writeToken, verified on read-back) makes a
      // concurrent clobber fail loudly and retry instead of silently winning.
      await saveTemplateFile(directoryHandle, dir, schema);

      await updateTemplateIndex(dir, (templates) =>
        [
          ...templates.filter((t) => t.templateId !== schema.templateId),
          {
            templateId: schema.templateId,
            templateName: schema.templateName,
            version: schema.version,
            updatedAt: schema.updatedAt
          }
        ].sort((a, b) => a.templateName.localeCompare(b.templateName, "ar"))
      );
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadTemplate(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<TemplateSchema | null> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const result = await safeReadJson<TemplateSchema>(
      dir,
      `${templateId}.json`
    );
    return result.ok && typeof result.value.templateId === "string"
      ? result.value
      : null;
  } catch {
    return null;
  }
}

/**
 * Like `loadTemplate`, but recovers a deleted template through the tombstone
 * `deleteTemplate` writes (`{templateId}.deleted.bak.json`) when the live file
 * is gone. Historical `ItemAnswer.templateId` values are never rewritten when
 * a template is deleted, so this is what lets an old answer still be resolved
 * against the template it was actually answered under (see
 * `templateAnswerResolution.ts`) instead of only the currently active one.
 */
export async function loadTemplateIncludingDeleted(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<TemplateSchema | null> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const asSchema = (result: SafeReadResult<TemplateSchema>): TemplateSchema | null =>
      result.ok && typeof result.value.templateId === "string" ? result.value : null;

    // STRICT live read first: no `.bak`/`.tmp` fallback, because this function
    // has its own authoritative answer for "the live file is gone" — the
    // tombstone — and an orphaned sibling must not pre-empt it. Before this,
    // a deleted template whose `.bak` survived the delete was resurrected here
    // at its pre-delete revision, and every such read logged a
    // `storage:bak-recovery` naming a file that was deliberately removed. That
    // is the 2026-09-08/09 production incident, reached through
    // `resolveAnswerTemplates` on every sign-in.
    const live = await safeReadJson<TemplateSchema>(dir, `${templateId}.json`, {
      siblingFallback: false,
    });
    const liveSchema = asSchema(live);
    if (liveSchema) return liveSchema;

    // The live file EXISTS but did not parse. That is a torn write, not a
    // deletion — and the id may since have been re-created (deleting a
    // template does not reserve its id). Its snapshots hold the CURRENT
    // template; the tombstone holds a superseded one. So the recovery ladder
    // wins here, and the tombstone is only the last resort.
    if (!live.ok && live.reason === "corrupt") {
      const recovered = asSchema(await safeReadJson<TemplateSchema>(dir, `${templateId}.json`));
      if (recovered) return recovered;
    }

    const tombstone = asSchema(
      await safeReadJson<TemplateSchema>(dir, `${templateId}.deleted.bak.json`)
    );
    if (tombstone) return tombstone;

    // No live file and no tombstone: a torn write that lost the live copy
    // before any delete ever happened. The full ladder is the only thing left,
    // and a recovery reported here is a genuine one.
    return asSchema(await safeReadJson<TemplateSchema>(dir, `${templateId}.json`));
  } catch {
    return null;
  }
}

export async function loadTemplateIndex(
  directoryHandle: DirectoryHandleLike
): Promise<TemplateIndex> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    const result = await safeReadJson<TemplateIndex>(dir, INDEX_FILE);
    return result.ok ? result.value : { templates: [] };
  } catch {
    return { templates: [] };
  }
}

export async function deleteTemplate(
  directoryHandle: DirectoryHandleLike,
  templateId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getTemplatesDir(directoryHandle);
    await withResourceLock(`${dir.name}/templates-index`, async () => {
      const templateFileName = `${templateId}.json`;
      const templateResult = await safeReadJson<TemplateSchema>(
        dir,
        templateFileName
      );
      if (templateResult.ok) {
        await safeWriteJson(dir, `${templateId}.deleted.bak.json`, {
          ...templateResult.value,
          deletedAt: new Date().toISOString()
        });
      }

      // Clear the active inspection-template selection if it points at the
      // template being deleted, so consumers (XrayReferrals, XrayInspectionResults,
      // Reports) don't keep silently referencing a dead templateId.
      //
      // `template.selection.json` is CAS-protected (revision + _writeToken).
      // This used to be a raw safeWriteJson, which dropped both fields, rewound
      // the revision counter and silently clobbered a concurrent admin's
      // selection change — blanking the inspection form workspace-wide (P1-B).
      // The match test now runs inside the CAS loop against a fresh read.
      const cleared = await clearInspectionTemplateSelectionIfMatches(
        directoryHandle,
        templateId,
        "system:deleteTemplate"
      );
      if (!cleared.ok) {
        throw new Error(cleared.error);
      }

      await updateTemplateIndex(dir, (templates) =>
        templates.filter((t) => t.templateId !== templateId)
      );

      if (dir.removeEntry) {
        // Live file AND both snapshot siblings, siblings first. Removing only
        // the live name left `{id}.json.bak` behind, and safeReadJson then
        // "recovered" the deleted template on every read forever — the
        // 2026-09-08/09 production incident. See safeRemoveJson.
        await safeRemoveJson(dir, templateFileName);
      } else {
        await safeWriteJson(dir, templateFileName, {
          deleted: true,
          templateId,
          deletedAt: new Date().toISOString()
        });
      }
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export function createTemplateId(): string {
  return `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createFieldId(): string {
  return `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPhaseId(): string {
  return `phs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
