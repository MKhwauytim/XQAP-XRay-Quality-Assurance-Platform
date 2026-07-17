import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deckStyleChoicesPlugin } from "./src/dev/deckStyleChoicesPlugin";
import { editLogTruncatePlugin } from "./src/build/editLogTruncatePlugin";

// Single source of truth for the app version: read it straight from package.json rather than
// hand-maintaining a separate version.ts that can drift out of sync (D7).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")
) as { version: string };

export default defineConfig({
  plugins: [react(), viteSingleFile(), deckStyleChoicesPlugin(), editLogTruncatePlugin()],
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
