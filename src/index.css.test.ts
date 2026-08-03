// Regression guard for the §Q Somar Sans font-dedup fix (see
// `docs/edit logs/2026-08-03.md`, v59.153). The brand font used to be
// embedded TWICE in the built bundle: once via static `@font-face` rules
// here in index.css (independently base64-inlined by Vite's CSS asset
// pipeline), and once via `src/data/reporting/executive/theme.ts`'s
// `?inline` imports of the same 4 `.woff` files. Both are now single-sourced
// through `src/branding/somarFonts.ts` and injected into the live app at
// runtime by `src/main.tsx` (mirroring how `ARABIC_FONT_FACE_CSS` is already
// injected there) — index.css itself carries no font-face rule anymore.
//
// Nothing else (typecheck, lint, or the bundle-size budget, which currently
// has far more headroom than one duplicate font copy costs) would catch a
// future `@font-face` rule silently reappearing here and recreating the
// exact ~240KB duplication that was just removed. This test is that guard.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./index.css", import.meta.url)),
  "utf8"
);

test("index.css defines no @font-face rule (fonts are injected at runtime via src/branding, not embedded in CSS)", () => {
  expect(css).not.toContain("@font-face");
});
