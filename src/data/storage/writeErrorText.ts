import { getLabels } from "../labels/labelsStore";
import { logError } from "./errorLogger";

/**
 * The UI is Arabic and RTL (see CLAUDE.md). Domain-level failures returned as
 * `{ ok: false, error }` carry their own Arabic sentence and must be shown
 * verbatim — they are the useful ones ("لا يمكن استبدال هذه العينة …",
 * "البيانات تغيّرت، حدّث الصفحة", a month-closed rejection).
 *
 * But the same `error` field is also the pass-through for whatever a thrown
 * exception's `.message` happened to be. On a UNC/SMB share that is a raw
 * Chromium DOMException string — "A requested file or directory could not be
 * found at the time an operation was processed." — which reached real users'
 * screens untranslated, sometimes with no Arabic wrapper at all.
 *
 * `distributionErrorText` in populationWorkflowHelpers.ts already maps *thrown*
 * errors to `msg_unexpected_write_error`; this is its counterpart for the
 * `result.ok === false` branches that bypassed it.
 *
 * The test is the text itself rather than a list of known DOMException
 * wordings: browser/locale/version variation makes that list unmaintainable,
 * whereas "an error string with no Arabic in it" is exactly the class of
 * message that has no place in this UI.
 */
// Arabic (U+0600–U+06FF), Arabic Supplement (U+0750–U+077F) and the Arabic
// Presentation Forms blocks — the ranges every Arabic string in this app falls
// in. U+FEFF (BOM) is deliberately excluded from the FE70 range so a stray byte
// order mark can never make an English message look Arabic.
const ARABIC_CHARACTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-ﻼ]/;

export function containsArabic(text: string): boolean {
  return ARABIC_CHARACTER.test(text);
}

/**
 * Returns `error` unchanged when it is genuine Arabic domain text; otherwise
 * logs the raw detail for the admin error log and returns the generic Arabic
 * write-failure label.
 */
export function userFacingErrorText(error: string, context: string): string {
  if (containsArabic(error)) return error;
  logError(context, new Error(error));
  return getLabels().msg_unexpected_write_error;
}

/**
 * Same mapping for a *thrown* value rather than a result string. A thrown
 * error's `.message` is almost always internal English (a Chromium
 * DOMException, safeWrite's own validation text, "Browser cannot write …"), so
 * the common `error instanceof Error ? error.message : "خطأ غير معروف"` pattern
 * put raw English straight on an Arabic screen. Arabic messages that domain
 * code deliberately throws are still passed through untouched.
 */
export function thrownErrorText(error: unknown, context = "ui:thrown-error"): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message && containsArabic(message)) return message;
  logError(context, error);
  return getLabels().msg_unexpected_write_error;
}
