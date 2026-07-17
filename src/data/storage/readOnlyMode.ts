// Global read-only guard for the demo/viewer account.
//
// Exports (XLSX / HTML report downloads) are unaffected because they stream
// straight to a browser download. Mutation entry points should call
// assertWritableMode() (or the UI-level mutation capability helper) rather than
// reporting success for a write that was intentionally blocked.

let readOnly = false;

export function setReadOnlyMode(enabled: boolean): void {
  readOnly = enabled;
}

export function isReadOnlyMode(): boolean {
  return readOnly;
}

export class ReadOnlyModeError extends Error {
  readonly code = "read_only" as const;

  constructor() {
    super("لا يمكن حفظ التغييرات في وضع العرض للقراءة فقط.");
    this.name = "ReadOnlyModeError";
  }
}

export function assertWritableMode(): void {
  if (readOnly) throw new ReadOnlyModeError();
}
