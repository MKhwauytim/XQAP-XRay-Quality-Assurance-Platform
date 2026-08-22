import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deckStyleChoicesPlugin } from "./src/dev/deckStyleChoicesPlugin";
import { simModePlugin } from "./src/dev/simModePlugin";

// Single source of truth for the app version: read it straight from package.json rather than
// hand-maintaining a separate version.ts that can drift out of sync (D7).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")
) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    // React Compiler (stable as of React 19): auto-memoizes components/hooks
    // at build time, zero runtime bundle cost -- de-risks decomposing the
    // repo's several 700-1400-line components (CLAUDE.md/W8.10) without a
    // manual useMemo/useCallback/React.memo audit pass. This "Vite 8" build is
    // rolldown-powered (@vitejs/plugin-react v6 transforms JSX via oxc, not
    // babel), so the compiler is wired in as a separate babel pass over the
    // same rolldown pipeline via @rolldown/plugin-babel + reactCompilerPreset
    // -- the officially documented route for this plugin/Vite version, not
    // the classic `react({ babel: { plugins: [...] } })` v4-era API (which
    // this version's `Options` type no longer accepts).
    babel({ presets: [reactCompilerPreset()] }),
    viteSingleFile(),
    deckStyleChoicesPlugin(),
    // Build-only: rewrites src/dev/simMode.ts to its inert production stub so the
    // writable, picker-free `?sim=1` workspace can never reach dist/index.html.
    simModePlugin(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: "./",
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
