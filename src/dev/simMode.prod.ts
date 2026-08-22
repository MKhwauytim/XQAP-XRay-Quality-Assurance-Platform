/**
 * Production stand-in for `src/dev/simMode.ts`.
 *
 * `src/dev/simModePlugin.ts` resolves every import of `simMode` to THIS module
 * during `vite build`. It is what makes the exclusion structural rather than a
 * bet on dead-code elimination: the simulated workspace's seed data, its
 * managed-user roster and the `?sim=1` URL contract are not merely unreachable
 * in a production bundle, they are not in the module graph at all.
 *
 * Constraints, both load-bearing:
 *   • IMPORT NOTHING but types. A value import of `./simWorkspace` here would
 *     pull the whole thing back into the production build and defeat the point.
 *   • Keep the export surface byte-compatible with `simMode.ts`. `tsc -b`
 *     typechecks both files, so a signature drift fails the build instead of
 *     silently shipping a stub that does not substitute.
 *
 * `SIM_WORKSPACE_HANDLE_NAME` is the empty string on purpose: the auto-login
 * effect compares it against `directoryHandle?.name`, and no real handle is
 * ever named "", so even a caller that somehow skipped its `import.meta.env.DEV`
 * guard could not match.
 */

import type { AuthRole } from "../auth/authTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";

export type SimModeConfig = {
  role: AuthRole;
  username: string;
};

export const SIM_WORKSPACE_HANDLE_NAME = "";

export function readSimModeConfig(): SimModeConfig | null {
  return null;
}

export function mountSimulatedWorkspace(): Promise<DirectoryHandleLike> {
  return Promise.reject(
    new Error("The simulated workspace is not available in a production build.")
  );
}
