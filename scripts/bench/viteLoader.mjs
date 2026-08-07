// Loads real modules from src/ into a plain Node process without a build step
// and without adding any new dependency: `vite` is already a devDependency
// (this repo's own dev server), and its `ssrLoadModule` performs exactly the
// module resolution these scripts need — extensionless TypeScript imports
// ("./foo", not "./foo.ts"), path aliases, and the vendored `xlsx` package —
// the same resolution Vitest itself relies on (vitest wraps this exact
// mechanism). Node's own `--experimental-strip-types` only strips type
// syntax; it does not resolve extensionless specifiers, so it cannot load
// this codebase's source files directly. This is the smallest correct option
// that satisfies "no new dependencies" and "call the app's own code, don't
// reimplement it".
//
// Usage:
//   const { loadModule, close } = await createSrcLoader();
//   const { processPopulation } = await loadModule("src/components/.../populationProcessor.ts");
//   ...
//   await close();

import { createServer } from "vite";

export async function createSrcLoader() {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "warn",
  });

  async function loadModule(repoRelativePath) {
    const specifier = repoRelativePath.startsWith("/") ? repoRelativePath : `/${repoRelativePath}`;
    return server.ssrLoadModule(specifier);
  }

  async function close() {
    await server.close();
  }

  return { loadModule, close, server };
}
