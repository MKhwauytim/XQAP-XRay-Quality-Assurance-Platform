// Builds the port report tool (port-report-tool.html) as one self-contained
// file in dist-tool/, separate from the app's dist/index.html.
//   npm run build:port-tool
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string };

export default defineConfig({
  plugins: [viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: "./",
  build: {
    outDir: "dist-tool",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: { input: fileURLToPath(new URL("./port-report-tool.html", import.meta.url)) },
  },
});
