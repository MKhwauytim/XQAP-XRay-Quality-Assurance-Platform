/**
 * The simulated workspace's pinned numbers, in one place.
 *
 * Every value here is asserted by `src/dev/simWorkspace.test.ts` as well, and
 * documented in `docs/development/SIMULATED_WORKSPACE.md`. If a seed change
 * makes a browser test fail, that is the seed doing its job — update
 * `SIM_SEED_PROFILE`, the unit test's pinned counts, and this file together.
 */

/** Month the simulation seeds: June 2026, folder `6-june-2026`. */
export const SEED_MONTH_LABEL = "يونيو 2026";
export const SEED_MONTH_FOLDER = "6-june-2026";

/** Population rows written to `population.final.json`. */
export const POPULATION_ROWS = 320;
/** Rows the 30 % stage-1 rule draws into the sample. */
export const SAMPLE_ROWS = 96;

/** Assignment counts per employee — these sum to SAMPLE_ROWS. */
export const ASSIGNMENTS = [
  { username: "jalgahamdi", displayName: "جميلة الغامدي", count: 34 },
  { username: "hihaloraini", displayName: "حاتم العريني", count: 29 },
  { username: "saalhijji", displayName: "سلمان الحجي", count: 19 },
  { username: "malrogi", displayName: "محمد العتيبي", count: 14 },
] as const;

/**
 * Answer records on disk: per employee the assignment order cycles
 * `2 submitted → 1 draft → 2 untouched`, so an employee holding `n` rows has
 * `floor(n/5)*2 + min(n%5, 2)` submitted and `floor(n/5) + (n%5 > 2 ? 1 : 0)`
 * drafts. Summed over the four employees that is 40 submitted + 20 drafts.
 */
export const SUBMITTED_ANSWERS = 40;
export const ANSWER_RECORDS = 60;
export const PENDING_ROWS = SAMPLE_ROWS - SUBMITTED_ANSWERS;

/** Managed users in the seeded roster: 6 shipped defaults + `simguest`. */
export const MANAGED_USERS = 7;

/**
 * Rows of `jalgahamdi` picked out by their position in her assignment order,
 * which is also the queue's default row order. Position `i` maps to
 * `i % 5`: 0,1 submitted · 2 draft · 3,4 untouched.
 *
 * These are looked up by the queue's free-text search rather than by row
 * index, so a change in default sort cannot silently re-point them at a row
 * in a different state — the state assertion in each spec would fail first.
 */
export const JALGAHAMDI_ROWS = {
  /** index 0 — submitted, locked to anyone but a reopen. */
  submitted: "DEMO-JED-0038",
  /** index 2 — a saved draft: both required fields already carry a value. */
  draft: "DEMO-JED-0066",
  /** index 3 — untouched: no answer record at all. */
  untouched: "DEMO-JED-0058",
  /** index 4 — untouched, second one, for a test that consumes the first. */
  untouchedSecond: "DEMO-JED-0017",
} as const;

/** The one inspection template the seed writes and marks active. */
export const TEMPLATE_NAME = "نموذج فحص الجودة (محاكاة)";

/** Role → seeded account, per the `?sim=1&role=` contract. */
export const ROLE_ACCOUNTS = {
  admin: { username: "admin", displayName: "admin" },
  manager: { username: "amonem", displayName: "عبدالاله المنعم" },
  supervisor: { username: "malrogi", displayName: "محمد العتيبي" },
  employee: { username: "jalgahamdi", displayName: "جميلة الغامدي" },
  guest: { username: "simguest", displayName: "زائر المحاكاة" },
} as const;
