import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same package.json-sourced version define as vite.config.ts, so components that read
// __APP_VERSION__ (e.g. Settings' AboutSection) can render under Testing Library too.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    setupFiles: ["src/test-setup.ts"],
  }
});
