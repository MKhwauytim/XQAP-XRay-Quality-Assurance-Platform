/// <reference types="vite/client" />

declare module "*.woff?inline" {
  const src: string;
  export default src;
}

/** App version string, injected at build time from `package.json` via Vite's `define`
 *  (see `vite.config.ts` / `vitest.config.ts`) — single source of truth, no hand-maintained
 *  version.ts to drift out of sync. */
declare const __APP_VERSION__: string;

/** True total count of `## vX` headings in `docs/EDIT_LOG.md`, injected at build time (see
 *  `vite.config.ts` / `vitest.config.ts`) — computed from the full, untruncated file so the
 *  ChangeLog tab's "إجمالي الإصدارات" stat stays correct even when the bundled `?raw` import
 *  is truncated to the most recent N entries (`editLogTruncatePlugin.ts`). */
declare const __EDIT_LOG_TOTAL_VERSIONS__: number;
