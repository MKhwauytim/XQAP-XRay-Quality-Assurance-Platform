/**
 * DEV-ONLY — the URL contract that mounts the simulated workspace.
 *
 * ── The contract ───────────────────────────────────────────────────────────
 *   ?sim=1                     mount the writable simulated workspace and sign
 *                              in automatically as the bootstrap admin
 *   ?sim=1&role=<role>         sign in with that role's seeded account
 *                              (guest | employee | supervisor | manager | admin;
 *                              an unknown value falls back to admin)
 *   ?sim=1&user=<username>     attribute the session to this username instead
 *                              of the role's default account, keeping `role`
 *
 * `sim=1` and `sim=true` both enable it. Any other value — including the
 * parameter being absent — leaves the app exactly as it is: picker, login form,
 * everything.
 *
 * ── Production exclusion ───────────────────────────────────────────────────
 * `src/dev/simModePlugin.ts` redirects THIS module to `simMode.prod.ts` (every
 * export inert, and importing nothing) during `vite build`, so the production
 * module graph never reaches `simWorkspace.ts` or its seed data at all. Every
 * call site is additionally wrapped in `if (import.meta.env.DEV)`. Both guards
 * are deliberate: one is structural, the other survives the plugin being
 * dropped from `vite.config.ts`.
 *
 * Keep this module's export surface identical to `simMode.prod.ts` — `tsc -b`
 * typechecks both, so a drift between them fails the build rather than shipping
 * a stub that does not substitute.
 */

import type { AuthRole } from "../auth/authTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import {
  createSimulatedWorkspace,
  SIM_ROLE_USERNAMES,
  SIM_WORKSPACE_NAME,
} from "./simWorkspace";

export type SimModeConfig = {
  /** Role the auto-created session runs as. */
  role: AuthRole;
  /** Username the session is attributed to — a real seeded managed account. */
  username: string;
};

/** Handle name of the mounted simulated workspace (`""` in the prod stub). */
export const SIM_WORKSPACE_HANDLE_NAME = SIM_WORKSPACE_NAME;

const VALID_ROLES: readonly string[] = [
  "guest",
  "employee",
  "supervisor",
  "manager",
  "admin",
];

function readSearchParams(): URLSearchParams | null {
  try {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
}

/**
 * The simulated-workspace request carried by the current URL, or `null` for an
 * ordinary app load.
 *
 * Pure and synchronous: `WorkspaceProvider` needs the answer during its FIRST
 * render, to decide whether the picker/restore path runs at all — an async
 * answer would let the picker paint first.
 */
export function readSimModeConfig(): SimModeConfig | null {
  const params = readSearchParams();
  if (!params) return null;

  const flag = (params.get("sim") ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true") return null;

  const requestedRole = (params.get("role") ?? "").trim().toLowerCase();
  const role: AuthRole = VALID_ROLES.includes(requestedRole)
    ? (requestedRole as AuthRole)
    : "admin";

  const requestedUser = (params.get("user") ?? "").trim();
  return {
    role,
    username: requestedUser.length > 0 ? requestedUser : SIM_ROLE_USERNAMES[role],
  };
}

/**
 * Build and return the writable simulated workspace handle, and mark the page
 * as simulated.
 *
 * The banner matters. The read-only demo announces itself through
 * `app_demo_banner`, which keys on `session.mode === "demo"` — and the
 * simulated session deliberately does NOT carry that mode, because it forces
 * `usePermissions().isReadOnly` true. So the one existing "this is not real
 * data" signal is exactly the one the simulation cannot use, and without this
 * the only hint is the workspace name in the sidebar. Fabricated ports,
 * declaration numbers and reviewer verdicts that look like a real month are
 * worth being loud about.
 *
 * Injected straight into the DOM rather than rendered by a component on
 * purpose: no production file gains a sim-only branch, and the banner cannot
 * exist in a build where this module has been replaced by its stub. It also
 * gives browser automation a stable hook (`[data-sim-banner]`) for asserting
 * that a page really is the simulation.
 */
export function mountSimulatedWorkspace(): Promise<DirectoryHandleLike> {
  showSimulationBanner();
  return createSimulatedWorkspace();
}

const BANNER_ATTRIBUTE = "data-sim-banner";

function showSimulationBanner(): void {
  if (typeof document === "undefined") return;
  // Idempotent: StrictMode runs the mounting effect twice.
  if (document.querySelector(`[${BANNER_ATTRIBUTE}]`)) return;

  const banner = document.createElement("div");
  banner.setAttribute(BANNER_ATTRIBUTE, "");
  banner.setAttribute("role", "status");
  banner.setAttribute("dir", "rtl");
  banner.textContent = "بيانات محاكاة للتطوير فقط — SIMULATED DATA, NOT REAL";
  banner.style.cssText = [
    "position:fixed",
    "inset-block-start:0",
    "inset-inline:0",
    "z-index:2147483647",
    "padding:2px 8px",
    "font:600 12px/1.6 system-ui,sans-serif",
    "text-align:center",
    "letter-spacing:.02em",
    "color:#000",
    "background:repeating-linear-gradient(45deg,#fde047 0 12px,#facc15 12px 24px)",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(banner);
}
