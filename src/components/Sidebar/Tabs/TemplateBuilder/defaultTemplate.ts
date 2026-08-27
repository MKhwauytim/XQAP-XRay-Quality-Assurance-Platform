/**
 * Re-export shim. The actual definition moved to
 * `data/templates/defaultInspectionTemplate.ts` — a data-layer consumer
 * outside EmployeeWorkspace/TemplateBuilder (the demo workspace seed) needs
 * it, and `eslint.config.js`'s `no-restricted-imports` forbids importing
 * `**\/TemplateBuilder/*` from outside that boundary. Kept here so this
 * folder's own callers (`TabView.tsx`, `defaultTemplate.test.ts`) don't need
 * to change their import path.
 */
export { buildDefaultInspectionTemplate } from "../../../../data/templates/defaultInspectionTemplate";
