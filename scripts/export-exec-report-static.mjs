// Renders the executive deck (deck2 — the live edition) to a standalone,
// self-contained HTML file using the same synthetic demo month the live dev
// preview uses (src/dev/deckPreviewFixture.ts). No workspace folder, no
// browser, no dev server to keep running: `npm run report:static` writes one
// file you can double-click.
//
// Why Vite's SSR module loader rather than a plain node script: the deck is
// TypeScript and pulls in `?inline` font assets, so it cannot be `import`ed by
// bare node. `createServer({ middlewareMode })` + `ssrLoadModule` runs the real
// source through the real Vite pipeline (same transforms as `npm run dev`)
// without ever opening a port or building the app.
//
//   node scripts/export-exec-report-static.mjs [outPath] [--variant-preview]
//
// `--variant-preview` embeds the style-variant arrows (the dev-preview mode);
// omit it for the plain report exactly as the Reports tab exports it.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const variantPreview = args.includes("--variant-preview");
const outPath = resolve(root, args.find((a) => !a.startsWith("--")) ?? "dist-preview/executive-report.html");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const server = await createServer({
  root,
  configFile: false,
  logLevel: "warn",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});

try {
  const { buildExecutiveDeckV2 } = await server.ssrLoadModule(
    "/src/data/reporting/executive/deck2/index.ts",
  );
  const { buildPreviewInput, PREVIEW_REVIEWER_NAMES } = await server.ssrLoadModule(
    "/src/dev/deckPreviewFixture.ts",
  );

  const started = Date.now();
  const html = await buildExecutiveDeckV2(buildPreviewInput(), PREVIEW_REVIEWER_NAMES, {
    variantPreview,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  const slideCount = (html.match(/class="slide /g) ?? []).length;
  console.log(
    `executive report written: ${outPath}\n` +
      `  ${slideCount} slides · ${(html.length / 1024 / 1024).toFixed(2)} MB · ${Date.now() - started}ms` +
      (variantPreview ? " · variant-preview mode" : ""),
  );
} finally {
  await server.close();
}
