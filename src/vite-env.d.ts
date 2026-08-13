/// <reference types="vite/client" />

declare module "*.woff?inline" {
  const src: string;
  export default src;
}

/** App version string, injected at build time from `package.json` via Vite's `define`
 *  (see `vite.config.ts` / `vitest.config.ts`) — single source of truth, no hand-maintained
 *  version.ts to drift out of sync. */
declare const __APP_VERSION__: string;
