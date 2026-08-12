# Running the app from a `file://` URL

**Status: verified 2026-08-10 (v67.0 build). No code changes required.**

`dist/index.html` is distributed as a single file that users open by double-clicking it
(typically out of `Downloads/`). That makes `file://` a supported deployment origin, not
an accident. This note records what was measured, so the question does not get re-opened
from first principles.

## The console error is not ours

Opening the app from `file://` in Chrome logs:

```
Unsafe attempt to load URL file:///…/index.html from frame with URL file:///…/index.html.
'file:' URLs are treated as unique security origins.
```

A **blank HTML file containing no scripts at all** reproduces this message identically.
It is emitted by Chrome for `file://` documents and is unrelated to anything the app does.
Nothing is blocked, nothing degrades. Ignore it.

(Two things make the message look self-referential and therefore alarming. Every `file://`
document is its own opaque origin, so Chrome describes the page as untrusted relative to
itself. And `window.open("", "_blank")` — used by `openReportWindow` in
`src/data/reporting/htmlReport.ts` — resolves the empty URL *relative to the current
document*, so the child window reports the parent's URL as its own.)

## Capabilities measured under `file://`

Probed in Chrome against a real `file://` load of a production build. Every row is an
observed result, not an inference from the spec.

| Capability | Used by | Result |
|---|---|---|
| `isSecureContext` | gate for the rest | `true` |
| Inline blob `Worker` | Excel import (`workbookWorker`), Population Browse paging (`populationQueryWorker`) — both `?worker&inline` | works — constructed and round-tripped a message |
| `navigator.locks.request` | `safeWrite.ts` write serialisation | works — fallback path not needed |
| `WebAssembly.instantiate` | hash-wasm Argon2id login | works |
| `crypto.subtle` PBKDF2 | legacy password verification | works |
| `localStorage` / `sessionStorage` | auth session, labels, device id, month selection | works — but see the caveat below |
| `window.open("", "_blank")` + `document.write` | report/deck tabs | works **with a user gesture**; without one it returns `null` and the code correctly falls back to a blob download |
| `<a download>` blob click | XLSX/CSV export | works |
| `showDirectoryPicker` | the entire workspace layer | present; exercised daily in real use |
| `srcdoc` iframe | `DeckDesignCustomizer` preview | works, same-origin readable |

## The one real caveat: shared storage

Chrome gives **every** `file://` page a single shared `localStorage` / `sessionStorage`
area. Consequences:

- Two copies of the app in different folders share one auth session and one set of label
  overrides.
- Any other local HTML file the user opens can read the stored session.

This does not change the trust boundary — `docs/architecture/SECURITY_MODEL.md` already
records that the auth layer is a UX/role-routing guard rather than a defence against a
user with local file access, and business data is plain JSON on disk regardless. It is
noted here because it is specific to the `file://` deployment and is not obvious.
