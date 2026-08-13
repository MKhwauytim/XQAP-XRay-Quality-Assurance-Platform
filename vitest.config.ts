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
    // Vitest's default is 5000ms — the SAME value as the `asyncUtilTimeout`
    // configured in `src/test-setup.ts`. That equality was the direct cause of
    // an intermittent, order-dependent suite failure:
    //
    //   * a `waitFor` that needs to wait can consume the entire test budget, so
    //     the test dies with a bare "Test timed out in 5000ms" instead of the
    //     waitFor's own (informative) assertion error — which is why earlier
    //     attempts to diagnose this kept coming back with nothing useful; and
    //   * under parallel-worker CPU contention across 206 files, a legitimate
    //     render that would have settled in ~1s can genuinely exceed 5s, turning
    //     a correct test into a hard failure depending on which files happened
    //     to run alongside it.
    //
    // The test budget must be comfortably LARGER than the async-utility budget
    // so a failing `waitFor` always reports its own error first. Raising it does
    // not hide real failures — a genuinely broken test still fails, it just
    // fails with a message that says why.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  }
});
