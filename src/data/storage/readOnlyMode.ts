// Global read-only guard for the demo/viewer account.
//
// When enabled, the safe-write layer (safeWriteJson / safeWriteJsonText) becomes
// a no-op so the seeded in-memory demo workspace stays pristine while the user
// navigates and "edits". Exports (XLSX / HTML report downloads) are unaffected
// because they don't go through this layer — they stream straight to a browser
// download. The demo workspace is in-memory anyway, so this is belt-and-suspenders.

let readOnly = false;

export function setReadOnlyMode(enabled: boolean): void {
  readOnly = enabled;
}

export function isReadOnlyMode(): boolean {
  return readOnly;
}
