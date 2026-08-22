/**
 * DEV-ONLY — a WRITABLE, picker-free simulated workspace for browser automation.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The app gates on `showDirectoryPicker()`, which needs a real user gesture and
 * a real folder. Neither is available to a headless browser, so until now the
 * entire app was unreachable to automated UI testing and every change was only
 * ever verified in jsdom. This module mounts an in-memory workspace instead:
 * same `DirectoryHandleLike` contract, same domain writers, no picker.
 *
 * ── Writable, unlike the demo/viewer workspace ─────────────────────────────
 * `WorkspaceProvider.enterDemoWorkspace` finishes with `setReadOnlyMode(true)`,
 * which is exactly what makes the demo useless for driving a real flow: every
 * answer, reassignment and import is rejected. The simulated workspace is
 * mounted WITHOUT that call, so a full flow (answer → submit → reassign →
 * report) actually executes against the in-memory tree.
 *
 * ── Production exclusion ───────────────────────────────────────────────────
 * Nothing here may ever reach a production build: it is a writable, no-auth
 * back door. Two independent guards:
 *   1. every call site is wrapped in `if (import.meta.env.DEV)`, which the
 *      bundler constant-folds to `false` and dead-code-eliminates; and
 *   2. `src/dev/simModePlugin.ts` rewrites `src/dev/simMode.ts` to the inert
 *      `src/dev/simMode.prod.ts` stub for `vite build`, so THIS module is never
 *      even reachable from the production module graph.
 * See `docs/development/SIMULATED_WORKSPACE.md`.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 * No `Math.random()`, no `Date.now()` in any seeded value. The draw runs off a
 * fixed RNG seed string and every seeded timestamp comes from `SIM_SEEDED_AT`,
 * so "employee X holds N rows" stays true tomorrow.
 */

import { createWorkspaceStructure, type DirectoryHandleLike } from "../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import { formatMonthFolderName } from "../data/population/monthFolder";
import { seedSimulatedActionLog } from "./simActionLog";
import {
  seedWorkspaceMonth,
  type WorkspaceSeedPort,
  type WorkspaceSeedProfile,
} from "../data/workspace/demoWorkspace";
import { syncUserManagementToDisk } from "../data/workspace/userSync";
import {
  createDefaultManagedUsers,
  createEmptyUserManagementState,
  normalizeUsername,
  type ManagedLoginUser,
  type UserManagementState,
} from "../auth/userManagement";
import type { EmployeeStageAllocation, StageSamplingRule } from "../data/population/populationConfig";
import type { AuthRole } from "../auth/authTypes";
import { BOOTSTRAP_ADMIN_USERNAME } from "../auth/authConfig";

/**
 * Directory-handle name of the simulated workspace. Deliberately distinct from
 * `DEMO_WORKSPACE_NAME` so nothing can confuse the read-only viewer demo with
 * this writable one, and so the sim auto-login keys on its own handle.
 */
export const SIM_WORKSPACE_NAME = "Simulated-Workspace";

/** The one fixed timestamp every seeded value is stamped with. */
export const SIM_SEEDED_AT = "2026-07-01T08:00:00.000Z";

export const SIM_MONTH = 6;
export const SIM_YEAR = 2026;

export const SIM_TEMPLATE_ID = "sim-inspection-template";

/**
 * Username of the seeded `guest` account.
 *
 * The six shipped default users cover employee/supervisor/manager but not
 * `guest`, and a non-bootstrap session whose username has no matching ACTIVE
 * managed user is cleared by AuthGate's `stillHasManagedUser` re-validation the
 * moment the workspace hydrates. Driving guest-role UI therefore needs a real
 * managed guest account on disk, not just `?role=guest`.
 */
export const SIM_GUEST_USERNAME = "simguest";

/**
 * Which managed account each `?role=` value signs in as.
 *
 * `admin` maps to the bootstrap admin, which is exempt from managed-user
 * validation by design (it never appears in the managed roster). The rest are
 * real, active accounts in the seeded roster, so the session survives
 * hydration.
 */
export const SIM_ROLE_USERNAMES: Readonly<Record<AuthRole, string>> = {
  admin: BOOTSTRAP_ADMIN_USERNAME,
  manager: "amonem",
  supervisor: "malrogi",
  employee: "jalgahamdi",
  guest: SIM_GUEST_USERNAME,
};

// Four ports summing to 320 rows — large enough that the Hamilton apportionment
// splits unevenly across ports (a real stratification, not a round number) and
// that paging/virtualization in Population Browse actually has something to
// page, while still seeding in well under a second.
const SIM_PORTS: WorkspaceSeedPort[] = [
  { name: "ميناء جدة الإسلامي", code: "JED", portType: "بحري", sheetName: "بحري", count: 120 },
  { name: "ميناء الدمام",       code: "DMM", portType: "بحري", sheetName: "بحري", count: 90 },
  { name: "منفذ البطحاء",       code: "BTH", portType: "بري",  sheetName: "بري",  count: 70 },
  { name: "مطار الملك خالد",    code: "RUH", portType: "جوي",  sheetName: "جوي",  count: 40 },
];

const SIM_SAMPLING_RULES: StageSamplingRule[] = [
  {
    stageKey: "first",
    method: "percentage",
    value: 30,
    isLocked: false,
    minRequiredCount: 0,
    certScanPercentage: 0,
    certScanExactCount: 0,
    certScanMethod: "percentage",
    certScanStrategy: "preferred",
  },
];

// Four assignable reviewers with deliberately UNEQUAL shares, so a test that
// asserts per-employee counts is asserting the apportionment, not a division
// by four that any bug would still satisfy.
const SIM_ALLOCATIONS: EmployeeStageAllocation[] = [
  { username: "jalgahamdi",  stageKey: "first", method: "percentage", value: 35, isActive: true },
  { username: "hihaloraini", stageKey: "first", method: "percentage", value: 30, isActive: true },
  { username: "saalhijji",   stageKey: "first", method: "percentage", value: 20, isActive: true },
  { username: "malrogi",     stageKey: "first", method: "percentage", value: 15, isActive: true },
];

export const SIM_SEED_PROFILE: WorkspaceSeedProfile = {
  month: SIM_MONTH,
  year: SIM_YEAR,
  username: BOOTSTRAP_ADMIN_USERNAME,
  riskFileName: "sim-risk-data.xlsx",
  rngSeed: "xray-sim-fixed-seed-v1",
  templateId: SIM_TEMPLATE_ID,
  templateName: "نموذج فحص الجودة (محاكاة)",
  ports: SIM_PORTS,
  samplingRules: SIM_SAMPLING_RULES,
  allocations: SIM_ALLOCATIONS,
  seededAt: SIM_SEEDED_AT,
  // The whole point of the simulated workspace is to exercise the real screens:
  // «مستهدف المؤشر» is only meaningfully filterable when the column carries all
  // four categories `engineVerdictOf` distinguishes, not just نعم/لا.
  riskEngineSpread: "vocabulary",
};

/**
 * The managed roster written to `3-user-data/users.permissions.json`: the six
 * shipped defaults plus one `guest`. Deterministic — the password hash is the
 * shipped default-user hash, so every seeded account signs in with the same
 * default password a fresh workspace ships with.
 */
export function buildSimManagedUsers(): ManagedLoginUser[] {
  const defaults = createDefaultManagedUsers();
  const guest: ManagedLoginUser = {
    id: "sim-user-guest",
    username: normalizeUsername(SIM_GUEST_USERNAME),
    displayName: "زائر المحاكاة",
    role: "guest",
    // Same shipped default-user hash as every other seeded account. Cloned from
    // the defaults rather than re-derived: hashing is async, and a seed must not
    // depend on WASM Argon2 being available.
    passwordHash: { ...defaults[0].passwordHash },
    isActive: true,
    hasCertScanLicense: false,
    createdAt: SIM_SEEDED_AT,
    updatedAt: SIM_SEEDED_AT,
  };
  return [...defaults, guest];
}

function buildSimUserManagementState(): UserManagementState {
  return { ...createEmptyUserManagementState(), users: buildSimManagedUsers() };
}

/**
 * Build the complete simulated workspace: folder structure, extended managed
 * roster, and one fully seeded month (population → sample → distribution →
 * answers) plus the inspection template those answers reference.
 *
 * Deliberately does NOT call `setReadOnlyMode(true)` — see the module header.
 */
export async function createSimulatedWorkspace(): Promise<DirectoryHandleLike> {
  const handle = createMemoryDirectory(SIM_WORKSPACE_NAME);
  await createWorkspaceStructure(handle, BOOTSTRAP_ADMIN_USERNAME);
  // Overwrites the default roster written by createWorkspaceStructure with the
  // same six users plus the guest account. Runs BEFORE the month seed so a
  // failure here surfaces before the (much longer) population write.
  await syncUserManagementToDisk(
    handle,
    buildSimUserManagementState(),
    BOOTSTRAP_ADMIN_USERNAME
  );
  await seedWorkspaceMonth(handle, SIM_SEED_PROFILE);
  // Last, and reading back what the month seed wrote: every row an action entry
  // names has to already exist on disk. See `simActionLog.ts` for why this one
  // block does not go through `appendWorkspaceAction`.
  await seedSimulatedActionLog(handle, {
    monthFolderName: formatMonthFolderName(SIM_MONTH, SIM_YEAR),
    reviewers: SIM_ALLOCATIONS.map((allocation) => allocation.username),
    templateId: SIM_TEMPLATE_ID,
    rngSeed: SIM_SEED_PROFILE.rngSeed,
  });
  return handle;
}
