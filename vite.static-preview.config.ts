// Dev-only: a bare static server rooted at dist-preview/, so the standalone
// executive-report HTML that `npm run report:static` writes can be opened in a
// browser (and driven by tooling) without file:// restrictions. Not part of the
// app build — `vite.config.ts` is untouched and `dist/` still ships exactly one
// self-contained index.html.
import { defineConfig } from "vite";

export default defineConfig({
  root: "dist-preview",
  server: { port: 5179 },
});
