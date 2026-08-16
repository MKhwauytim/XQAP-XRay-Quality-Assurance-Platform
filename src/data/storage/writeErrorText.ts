import { codedMessage, logCodedError, resolveErrorCode } from "./errorCodes";

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
  // A plain string carries no error object to classify, so the generic
  // XQ-IO-028 is the honest code here: "something failed and we could not tell
  // what". It still gives the user something quotable and pins the log entry.
  logCodedError(context, "XQ-IO-028", new Error(error));
  // Same wording as before — XQ-IO-028's label IS `msg_unexpected_write_error`
  // — routed through `codedMessage` so both exits of this module format
  // identically.
  return codedMessage("XQ-IO-028");
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
  const code = resolveErrorCode(error);
  if (message && containsArabic(message)) {
    // Deliberate Arabic domain text. Codes produced by `formatUserError` are
    // already embedded in it, so only an externally classified code is added.
    return code && !message.includes(code) ? `${message} (${code})` : message;
  }
  // Internal English (a DOMException, safeWrite's own validation text) still
  // never reaches the screen — but the code that identifies it does, so the
  // user can quote it and we can find the exact throw site.
  //
  // The message is the CODE'S OWN label, not a hard-coded generic sentence.
  // Previously every classified failure still rendered "خطأ غير متوقع أثناء
  // الحفظ" with a correct code bolted on, which threw away the one thing the
  // code was for: XQ-IO-030 means "your workspace folder moved — re-pick it"
  // and XQ-IO-020 means "the disk is full". Neither is "unexpected", and
  // neither is fixed by the retry the generic sentence advises.
  //
  // XQ-IO-028's own label IS `msg_unexpected_write_error`, so the unclassified
  // path lands on exactly the same wording as before via the `??`.
  const resolved = code ?? "XQ-IO-028";
  logCodedError(context, resolved, error);
  return codedMessage(resolved);
}
