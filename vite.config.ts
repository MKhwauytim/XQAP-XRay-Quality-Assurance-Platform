import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { deckStyleChoicesPlugin } from "./src/dev/deckStyleChoicesPlugin";

export default defineConfig({
  plugins: [react(), viteSingleFile(), deckStyleChoicesPlugin()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
  },
});
