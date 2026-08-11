# Hosting for Install

The app is a single self-contained static `index.html` file. There is no server component, API, or database. All business data lives in a workspace folder the user selects on their own machine via the File System Access API.

## Local usage (file://)

Opening the file by double-click (`file://` origin) works fully:
- All sampling, distribution, and reporting features are available.
- The workspace folder picker works.
- The app cannot be installed to the home screen.

Installation can never be offered on `file://`: Chrome requires a secure origin (HTTPS or `localhost`) to install a PWA, and `file://` is not one — each `file:` URL is its own unique opaque origin, so even the manifest's `data:` URI icons cannot load there. Because there is no possible benefit, the app deliberately skips injecting the `<link rel="manifest">` element at all on a `file://` origin (`registerAppManifest()` in `src/branding/appManifest.ts`), rather than injecting one the browser can never honor.

## Installable hosting (HTTPS or localhost)

To make the app installable as a progressive web app (PWA):
- Serve it over **HTTPS** (or `http://localhost` for local development and testing).
- Use Content-Type `text/html` on the response.
- Keep the serving path **stable** — do not move the file to a different path after users have installed it.

### Why path stability matters

The manifest's `scope` is automatically derived from the document URL: the origin plus the pathname truncated at the last `/`. Moving the file changes the app's install identity. Users who have already installed from the original path will see the moved copy as a different app and may end up with duplicates.

## Content-Security-Policy

If you serve the app with a `Content-Security-Policy` header, it must allow `blob:` in the `manifest-src` directive. The manifest is registered at runtime as a `blob:` URL (because the app is distributed as a single file, not multiple files):

```
Content-Security-Policy: … manifest-src 'self' blob: …
```

If `manifest-src` does not allow `blob:`, the manifest will not load. The browser will then not offer an install option, and the app will function fully but without the ability to be installed.

## Browser requirement

Chrome or Edge is required regardless of hosting method — whether on `file://`, `localhost`, or a production HTTPS origin. The workspace features depend on the File System Access API (`showDirectoryPicker`), which is currently supported only in Chromium-based browsers.

Other browsers will receive the `unsupported_browser` state and cannot access the workspace folder picker.
