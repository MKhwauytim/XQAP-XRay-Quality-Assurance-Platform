/**
 * Whether the app is running from a `file://` origin — the app's primary
 * deployment mode, a double-clicked `dist/index.html` rather than something
 * served over http(s). Split into its own module (instead of a private
 * helper inside WorkspaceGate.tsx) so tests can mock it directly: jsdom's
 * `window.location` is not freely reassignable, but a mocked module import
 * is.
 */
export function isFileOrigin(): boolean {
  return typeof location !== "undefined" && location.protocol === "file:";
}
