/**
 * The ad-hoc import assignment PLANNER — pure, no I/O, no React.
 *
 * It answers one question: given an import's rows, a distribution mode and a
 * set of employees, *which* row goes to *whom* under *which* xrayImageId. It
 * never writes anything; `adhocDistributionBridge.ts` turns the returned plan
 * into distribution events. Keeping the decision separate from the write is
 * what makes the four modes testable and what lets the UI preview a plan
 * (counts, leftovers, complaints) before anyone commits to it.
 *
 * Two properties the rest of the feature relies on:
 *
 * 1. **Deterministic.** The row order is a seeded Fisher-Yates shuffle
 *    (`createRng(hashSeedString(seed ?? importId))`), so the same inputs always
 *    produce a byte-identical plan. Re-running a preview, or replaying a plan
 *    for an audit, cannot drift.
 * 2. **Unbiased by spreadsheet order.** The shuffle exists precisely *because*
 *    the input is a human-sorted spreadsheet: a file sorted by port would hand
 *    the first employee every row of one port, which is exactly the reviewer
 *    bias the sampling layer works to avoid. Shuffling first makes each
 *    employee's slice a random cross-section of the import.
 *
 * The caller's `rows` array is never mutated — the shuffle runs on a copy.
 */

import { hamiltonApportionment } from "../sampling/apportionment";
import { createRng, hashSeedString, shuffleInPlace } from "../sampling/rng";
import { namespacedXrayImageId } from "./adhocImportModel";
import type {
  AdhocRow,
  AssignmentMode,
  AssignmentPlan,
  AssignmentTarget,
  PlannedAssignment
} from "./adhocImportModel";

export type PlanAdhocAssignmentParams = {
  rows: AdhocRow[];
  mode: AssignmentMode;
  targets: AssignmentTarget[];
  /** `explicit` mode only — the rows the admin ticked, in the order they were ticked. */
  explicitRowKeys?: string[];
  importId: string;
  /** Overrides `importId` as the shuffle seed. Same seed ⇒ same plan. */
  seed?: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Eligibility, targets, ordering
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The pool every mode operates on. `assignments.length === 0` is part of it so
 * planning twice over the same import can never hand an already-assigned row
 * to a second employee — the planner is safe to re-run after a partial commit.
 */
function eligibleRows(rows: AdhocRow[]): AdhocRow[] {
  return rows.filter(
    (row) => row.validation.valid && !row.excludedByAdmin && row.assignments.length === 0
  );
}

/**
 * The same employee listed twice is a UI mistake, not an instruction to give
 * them a double share — and under fan-out it would hand them two replicas of
 * every row (two independent answers from one reviewer, which is not what
 * inter-rater review means). First occurrence wins, so the admin's ordering and
 * any `count` / `weight` they typed on it are preserved.
 */
function dedupeTargets(targets: AssignmentTarget[], errors: string[]): AssignmentTarget[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unique: AssignmentTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.username)) {
      duplicates.add(target.username);
      continue;
    }
    seen.add(target.username);
    unique.push(target);
  }
  if (duplicates.size > 0) {
    errors.push(
      `تم تكرار الموظف في قائمة التوزيع وتم اعتماد أول إدراج فقط: ${[...duplicates].join("، ")}.`
    );
  }
  return unique;
}

function shuffledPool(pool: AdhocRow[], seedSource: string): AdhocRow[] {
  const ordered = pool.slice();
  shuffleInPlace(ordered, createRng(hashSeedString(seedSource)));
  return ordered;
}

/**
 * Validation already requires a non-empty `xrayImageId`, so a pool row without
 * one is a contract violation upstream. Emitting `ADHOC-{importId}-` with
 * nothing after it would create a plausible-looking id that collides with every
 * other broken row, so the row is skipped and reported instead.
 */
function resolveOriginalId(row: AdhocRow, errors: string[]): string | null {
  const raw = row.mapped.xrayImageId;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed === "") {
    errors.push(`تم تخطي الصف "${row.rowKey}": لا يوجد معرّف أشعة (xrayImageId).`);
    return null;
  }
  return trimmed;
}

function assignmentFor(
  row: AdhocRow,
  originalId: string,
  username: string,
  replicaIndex: number,
  importId: string
): PlannedAssignment {
  return {
    rowKey: row.rowKey,
    username,
    replicaIndex,
    xrayImageId: namespacedXrayImageId(importId, originalId, replicaIndex)
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Modes
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The admin ticked specific rows for one employee, so the shuffle is
 * meaningless here: the plan follows `explicitRowKeys` in the order the caller
 * gave them. Keys that are not in the eligible pool (already assigned,
 * excluded, invalid, unknown) are skipped silently — the review table is what
 * tells the admin which rows are eligible.
 */
function planExplicit(
  pool: AdhocRow[],
  targets: AssignmentTarget[],
  explicitRowKeys: string[] | undefined,
  importId: string,
  errors: string[]
): PlannedAssignment[] {
  if (targets.length !== 1) {
    errors.push("التوزيع اليدوي يتطلب اختيار موظف واحد فقط.");
    return [];
  }
  if (!explicitRowKeys || explicitRowKeys.length === 0) {
    errors.push("التوزيع اليدوي يتطلب تحديد صف واحد على الأقل.");
    return [];
  }

  const username = targets[0].username;
  const byRowKey = new Map(pool.map((row) => [row.rowKey, row]));
  const used = new Set<string>();
  const plan: PlannedAssignment[] = [];

  for (const rowKey of explicitRowKeys) {
    const row = byRowKey.get(rowKey);
    if (!row || used.has(rowKey)) continue;
    used.add(rowKey);
    const originalId = resolveOriginalId(row, errors);
    if (originalId === null) continue;
    plan.push(assignmentFor(row, originalId, username, 0, importId));
  }
  return plan;
}

/**
 * Sequential slices of the shuffled pool, in target order. A row is consumed at
 * most once: when the pool runs short the remaining targets simply get less,
 * and the shortfall is reported. Padding or reusing a row would mean two
 * employees reviewing the same image without either of them being told.
 */
function planCount(
  pool: AdhocRow[],
  targets: AssignmentTarget[],
  importId: string,
  errors: string[]
): PlannedAssignment[] {
  const requested = targets.map((target) =>
    Number.isFinite(target.count) ? Math.max(0, Math.floor(target.count ?? 0)) : 0
  );
  if (requested.reduce((sum, n) => sum + n, 0) === 0) {
    errors.push("لم يتم تحديد عدد صفوف لأي موظف؛ لم يتم إنشاء أي تخصيص.");
    return [];
  }

  const plan: PlannedAssignment[] = [];
  let cursor = 0;
  targets.forEach((target, index) => {
    const want = requested[index];
    let placed = 0;
    while (placed < want && cursor < pool.length) {
      const row = pool[cursor];
      cursor += 1;
      const originalId = resolveOriginalId(row, errors);
      if (originalId === null) continue;
      plan.push(assignmentFor(row, originalId, target.username, 0, importId));
      placed += 1;
    }
    if (placed < want) {
      errors.push(
        `تعذّر تخصيص العدد المطلوب للموظف "${target.username}": المطلوب ${want} صفًا، وتم تخصيص ${placed}.`
      );
    }
  });
  return plan;
}

/**
 * Weights are RELATIVE — 1/2/1 and 25/50/25 mean the same split, and nothing
 * has to add up to 100. A target with no weight gets the average of the weights
 * that *were* given (1 when none were), which is the "equal weight by default"
 * the contract promises: all-blank weights split evenly, and a blank next to
 * explicit weights gets a fair share instead of being silently starved.
 */
function resolveWeights(targets: AssignmentTarget[], errors: string[]): number[] {
  const specified: number[] = [];
  for (const target of targets) {
    if (target.weight === undefined) continue;
    if (!Number.isFinite(target.weight) || target.weight < 0) {
      errors.push(`نسبة غير صالحة للموظف "${target.username}"؛ تم اعتبارها صفرًا.`);
      specified.push(0);
    } else {
      specified.push(target.weight);
    }
  }
  const fallback =
    specified.length > 0 ? specified.reduce((sum, w) => sum + w, 0) / specified.length : 1;

  return targets.map((target) => {
    if (target.weight === undefined) return fallback;
    return Number.isFinite(target.weight) && target.weight > 0 ? target.weight : 0;
  });
}

/**
 * Hamilton's largest-remainder method over the whole pool — the same
 * apportionment the real sample draw uses per port, so the rounding behaviour
 * (and its alphabetical tie-break) is consistent across the app. Hamilton
 * always distributes every seat, so this mode leaves nothing over.
 */
function planPercentage(
  pool: AdhocRow[],
  targets: AssignmentTarget[],
  importId: string,
  errors: string[]
): PlannedAssignment[] {
  const weights = resolveWeights(targets, errors);
  if (weights.every((weight) => weight === 0)) {
    errors.push("جميع النسب تساوي صفرًا؛ لم يتم إنشاء أي تخصيص.");
    return [];
  }

  const allocations = hamiltonApportionment(
    targets.map((target, index) => ({ key: target.username, size: weights[index] })),
    pool.length
  );
  const allocatedFor = new Map(allocations.map((entry) => [entry.key, entry.allocated]));

  const plan: PlannedAssignment[] = [];
  let cursor = 0;
  for (const target of targets) {
    const take = allocatedFor.get(target.username) ?? 0;
    for (let i = 0; i < take && cursor < pool.length; i += 1) {
      const row = pool[cursor];
      cursor += 1;
      const originalId = resolveOriginalId(row, errors);
      if (originalId === null) continue;
      plan.push(assignmentFor(row, originalId, target.username, 0, importId));
    }
  }
  return plan;
}

/**
 * Inter-rater duplicate review: every eligible row goes to every reviewer, each
 * under their own replica id, so each of them answers independently instead of
 * the fold treating the second assignment as a reassignment. The replica index
 * is the reviewer's position in `targets`, which keeps the first reviewer on the
 * plain (v1-shaped) id.
 */
function planFanout(
  pool: AdhocRow[],
  targets: AssignmentTarget[],
  importId: string,
  errors: string[]
): PlannedAssignment[] {
  const plan: PlannedAssignment[] = [];
  for (const row of pool) {
    const originalId = resolveOriginalId(row, errors);
    if (originalId === null) continue;
    targets.forEach((target, replicaIndex) => {
      plan.push(assignmentFor(row, originalId, target.username, replicaIndex, importId));
    });
  }
  return plan;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entry point
 * ──────────────────────────────────────────────────────────────────────────── */

function planForMode(
  params: PlanAdhocAssignmentParams,
  pool: AdhocRow[],
  targets: AssignmentTarget[],
  errors: string[]
): PlannedAssignment[] {
  switch (params.mode) {
    case "explicit":
      return planExplicit(pool, targets, params.explicitRowKeys, params.importId, errors);
    case "count":
      return planCount(pool, targets, params.importId, errors);
    case "percentage":
      return planPercentage(pool, targets, params.importId, errors);
    case "fanout":
      return planFanout(pool, targets, params.importId, errors);
    default:
      errors.push(`وضع توزيع غير معروف: ${String(params.mode)}.`);
      return [];
  }
}

/**
 * Defensive last gate. `DistributionEntry` is keyed by `xrayImageId` and the
 * fold keeps one live owner per id, so two planned assignments sharing an id
 * would silently collapse into one on write — losing an assignment with no
 * error anywhere. The only realistic source is a duplicate id inside the
 * imported file itself, so the duplicate is dropped (it becomes leftover) and
 * reported rather than thrown.
 */
function dropDuplicateXrayImageIds(
  plan: PlannedAssignment[],
  errors: string[]
): PlannedAssignment[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unique: PlannedAssignment[] = [];
  for (const entry of plan) {
    if (seen.has(entry.xrayImageId)) {
      duplicates.add(entry.xrayImageId);
      continue;
    }
    seen.add(entry.xrayImageId);
    unique.push(entry);
  }
  if (duplicates.size > 0) {
    const sample = [...duplicates].slice(0, 5).join("، ");
    errors.push(
      `تم استبعاد تخصيصات بمعرّفات أشعة مكرّرة (${duplicates.size}): ${sample}${duplicates.size > 5 ? " …" : ""}.`
    );
  }
  return unique;
}

export function planAdhocAssignment(params: PlanAdhocAssignmentParams): AssignmentPlan {
  const errors: string[] = [];
  const pool = eligibleRows(params.rows ?? []);
  const targets = dedupeTargets(params.targets ?? [], errors);

  if (targets.length === 0) {
    errors.push("لم يتم اختيار أي موظف للتوزيع.");
    return { plan: [], leftover: pool.length, errors };
  }
  if (pool.length === 0) {
    errors.push("لا توجد صفوف مؤهلة للتوزيع.");
    return { plan: [], leftover: 0, errors };
  }

  const ordered = shuffledPool(pool, params.seed ?? params.importId);
  const plan = dropDuplicateXrayImageIds(
    planForMode(params, ordered, targets, errors),
    errors
  );

  // `leftover` means the same thing in every mode: eligible rows the plan did
  // not place. Counted over distinct rowKeys so fan-out's replicas don't
  // inflate it.
  const placedRows = new Set(plan.map((entry) => entry.rowKey)).size;
  return { plan, leftover: pool.length - placedRows, errors };
}
