/**
 * WRITE path for a `kind: "historical"` ad-hoc import — a study the department
 * carried out BEFORE this app existed, arriving as one spreadsheet that holds
 * both the sample columns and the answers a reviewer already recorded.
 *
 * What "importing" one has to mean, or the feature is pointless: the rows must
 * end up looking exactly like work that was assigned and completed inside the
 * app — an `assigned` + `completed` pair in the distribution event log, and a
 * `submitted` `ItemAnswer` in the reviewer's own answer file. Anything less
 * produces rows that exist but that no report, KPI or employee view will ever
 * count.
 *
 * Three properties are specific to a back-fill and are deliberate everywhere
 * below:
 *
 * 1. **Partial template coverage is CORRECT, not an error.** The study predates
 *    the current inspection template, so its file cannot answer questions the
 *    template did not yet ask. `ItemAnswer.answers` is a sparse `FieldAnswer[]`
 *    keyed by `fieldId`, so an unmapped or blank field simply produces no entry
 *    and reads downstream as unanswered — which is the truth. Nothing here pads
 *    the array, and `field.required` is ignored (see `buildFieldAnswers`):
 *    required-ness is a live-form submit rule, and applying it to a back-fill
 *    would reject every honest historical file.
 * 2. **The reviewer must be a real, current account.** An answer file is named
 *    after its owner, so an answer written under a username nobody owns lands
 *    in a file that no view ever opens — durably written and permanently
 *    invisible. `planHistoricalImport` therefore resolves every distinct
 *    `answeredBy` through `findAssignableEmployee` and reports failures as
 *    `errors`, so the caller refuses the whole import BEFORE any disk write
 *    rather than discovering it half-way through one.
 * 3. **Two different clocks.** The event log records when the app LEARNED about
 *    the work (one shared `eventAt`, i.e. now), while `ItemAnswer.submittedAt`
 *    records when the reviewer actually did it (the study's own date). Stamping
 *    the historical date onto the events instead would order a `completed`
 *    years before its `assigned`, and the fold — which sorts by `eventAt` and
 *    rejects post-terminal transitions — would drop the assignment outright.
 *
 * This module is a sibling of `adhocDistributionBridge.ts` and keeps every
 * safety property `assignAdhocPlan` has: the caller's record is never trusted
 * (re-read from disk), the status gate and row filters come from the fresh
 * copy, the roster is re-validated at write time, the distribution log is the
 * authority on what already exists, sample rows are written before any event
 * names them, and the whole batch shares ONE `eventAt`.
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { FieldAnswer, ItemAnswer } from "../answers/answerTypes";
import { loadEmployeeAnswers, upsertItemAnswer } from "../answers/answerStorage";
import type { DistributionEvent } from "../distribution/distributionTypes";
import { buildAssignEvent, buildCompletedEvent } from "../distribution/distributionLog";
import {
  appendDistributionEvents,
  loadOrDeriveDistributionCurrent,
  refreshDistributionCacheAfterWrite,
} from "../distribution/distributionStorage";
import { findAssignableEmployee } from "../distribution/bulkAssignment";
import { getManagedLoginUsers, normalizeUsername } from "../../auth/userManagement";
import type { TemplateSchema } from "../templates/templateTypes";
import { adhocMonthFolder, namespacedXrayImageId } from "./adhocImportModel";
import type {
  AdhocRecord,
  AdhocRow,
  AdhocRowAssignment,
  FieldSource,
  PlannedAssignment,
} from "./adhocImportModel";
import { ensureAdhocSampleMaster } from "./adhocDistributionBridge";
import { loadAdhocRecord, saveAdhocRecord } from "./adhocImportStorage";
import { buildFieldAnswers } from "./adhocTemplateMapping";
import { foldDigits } from "./adhocTextFolding";

/**
 * One source row, resolved into everything the write path needs: who answered
 * it, when, and what they answered.
 *
 * `xrayImageId` is always the `replicaIndex 0` namespaced id. Fan-out is a
 * forward-looking distribution mode — several reviewers each answering the same
 * image independently — and a historical file records what ONE reviewer already
 * recorded, so there is never a second replica to create.
 */
export type HistoricalRowPlan = {
  rowKey: string;
  xrayImageId: string;
  answeredBy: string;
  submittedAt: string;
  answers: FieldAnswer[];
  /** Per-row, operator-facing Arabic notes about cells that were not imported. */
  warnings: string[];
};

export type HistoricalImportPlan = {
  plan: HistoricalRowPlan[];
  /** Blocking. A non-empty list means the caller must not call `applyHistoricalImport`. */
  errors: string[];
  /** Whole-import observations. Per-cell detail stays on the row it came from. */
  warnings: string[];
};

export type ApplyHistoricalImportResult =
  | { ok: true; importedCount: number; skippedCount: number; record: AdhocRecord }
  | { ok: false; error: string };

const NO_ELIGIBLE_ROWS = "لا توجد صفوف صالحة قابلة للاستيراد ضمن هذا الملف.";
const ALREADY_IMPORTED = "كل الصفوف المحددة مستوردة بالفعل — لم تتم إضافة أي بيانات جديدة.";
const IMPORT_CLOSED = "هذا الاستيراد مغلق — لا يمكن استيراد إجابات إضافية منه.";
const MISSING_TEMPLATE =
  "لم يحدد قالب الفحص لهذا الاستيراد — لا يمكن حفظ الإجابات دون معرفة القالب وإصداره.";
const UNASSIGNABLE_REVIEWER =
  "أحد المراجعين المذكورين في الملف غير موجود، أو غير نشط، أو لا يملك صلاحية استلام العينات.";

function quote(value: string): string {
  return `"${value}"`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1 — Reading one cell
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One field's raw text out of a source row, or null when it has none.
 *
 * A near-copy of the private reader in `adhocTemplateMapping.ts` on purpose:
 * that module owns the TEMPLATE half of the mapping, and `answeredBy` /
 * `submittedAt` are not template fields — they are the two columns this module
 * needs and nobody else does. Exporting the reader from there to share six
 * lines would couple the two files for no benefit.
 *
 * Non-string cells are stringified rather than rejected, because SheetJS yields
 * numbers for anything that looks numeric — including the date serials
 * `resolveHistoricalTimestamp` below is built to recognize.
 */
function readSourceText(source: FieldSource, values: Record<string, unknown>): string | null {
  if (source.kind === "none") return null;
  const raw = source.kind === "constant" ? source.value : values[source.header];
  if (raw === null || raw === undefined) return null;
  const text = (typeof raw === "string" ? raw : String(raw)).trim();
  return text === "" ? null : text;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2 — The study's own timestamp
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Excel's 1900 date system, in UTC. Same constants and the same reasoning as
 * `adhocMonthBinding.ts` (which keeps its own copies private): serial 1 is
 * 1900-01-01, so the epoch is 1899-12-30 once Excel's phantom 1900-02-29 is
 * absorbed, and the serial window is narrow enough that an ordinary quantity or
 * ID number cannot be mistaken for a date.
 */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const MIN_EXCEL_SERIAL = 20_000;
const MAX_EXCEL_SERIAL = 80_000;

/**
 * An operator-supplied review date as an ISO timestamp, or null when the value
 * cannot be read as a date at all.
 *
 * Unlike a template `date` field — which the rest of the app treats as opaque
 * display text and this module never reformats — `ItemAnswer.submittedAt` is
 * arithmetic input: KPI windows, "answered within N days" and every date-sorted
 * view do `new Date(...)` on it. A value that survived as the operator typed it
 * would therefore read as `Invalid Date` downstream, so it is normalized here
 * or refused here.
 *
 * KNOWN LIMITATION, accepted rather than papered over: a locale-formatted
 * numeric date (`05/03/2024`) is handed to `Date.parse`, which reads it in
 * month-first order. There is no way to tell that apart from a day-first file by
 * value alone, and both readings are real dates, so no warning can fire. A file
 * whose dates matter to the day should be mapped from an ISO (`YYYY-MM-DD`)
 * column, or via the Excel serial a real date cell produces.
 */
export function resolveHistoricalTimestamp(raw: string): string | null {
  const text = foldDigits(raw).trim();
  if (text === "") return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial < MIN_EXCEL_SERIAL || serial > MAX_EXCEL_SERIAL) return null;
    return new Date(EXCEL_EPOCH_UTC_MS + serial * MS_PER_DAY).toISOString();
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

type TimestampResolution = { submittedAt: string; warning: string | null; usedFallback: boolean };

/**
 * The row's `submittedAt`, falling back to the record's `importedAt`.
 *
 * THE FALLBACK IS DELIBERATE AND IS THE ONLY ONE IN THIS MODULE. Everywhere
 * else a missing value is either omitted (a template field) or fatal (the
 * reviewer's name), because inventing a clinical result or an owner would put
 * words in a person's mouth. A timestamp is different: `ItemAnswer.submittedAt`
 * is typed `string | null`, but a null there reads downstream as "submitted,
 * date unknown" and silently drops the row out of every date-windowed count.
 * The import date is a defensible stand-in — it is a real moment, it is never
 * earlier than the study, and it is the moment this record demonstrably existed
 * — and it is reported: `usedFallback` drives an explicit warning so no one
 * mistakes it for the study's own date.
 */
function resolveRowTimestamp(
  source: FieldSource,
  values: Record<string, unknown>,
  importedAt: string
): TimestampResolution {
  const raw = readSourceText(source, values);
  if (raw === null) {
    // An unmapped column is an import-wide fact, already reported once in the
    // plan's summary warnings; repeating it per row on a 5,000-row file would
    // bury the warnings that are actually row-specific. A mapped column with a
    // BLANK cell is row-specific, and does warn.
    const warning =
      source.kind === "none"
        ? null
        : "لا يوجد تاريخ مراجعة في هذا الصف — استخدم تاريخ استيراد الملف بدلا منه.";
    return { submittedAt: importedAt, warning, usedFallback: true };
  }

  const resolved = resolveHistoricalTimestamp(raw);
  if (resolved === null) {
    return {
      submittedAt: importedAt,
      warning: `تعذرت قراءة تاريخ المراجعة ${quote(raw)} — استخدم تاريخ استيراد الملف بدلا منه.`,
      usedFallback: true,
    };
  }
  return { submittedAt: resolved, warning: null, usedFallback: false };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3 — Planning (pure)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every distinct reviewer in the plan that the LIVE roster cannot resolve to an
 * active, sample-assignable account.
 *
 * Same rule and same reason as `assignAdhocPlan`'s target check, one step
 * earlier: there it stops an assignment nobody can work, here it stops an
 * answer file nobody will read. Whole-import, not per-row — a study half of
 * whose reviewers resolved is not the study.
 */
function unknownReviewerErrors(plan: HistoricalRowPlan[]): string[] {
  const roster = getManagedLoginUsers();
  const distinct = [...new Set(plan.map((entry) => entry.answeredBy))];
  return distinct
    .filter((username) => findAssignableEmployee(username, roster) === null)
    .map(
      (username) =>
        `المراجع ${quote(username)} غير موجود في قائمة المستخدمين، أو غير نشط، أو لا يملك صلاحية استلام العينات.`
    );
}

function summarizeCoverage(params: {
  schema: TemplateSchema;
  templateFields: Record<string, FieldSource>;
  submittedAtSource: FieldSource;
  importedAt: string;
  fallbackRows: number;
  coercionRows: number;
}): string[] {
  const { schema, templateFields, submittedAtSource, importedAt } = params;
  const warnings: string[] = [];

  // `empty` fields are layout spacers in the inspection form and carry no
  // answer, so they are not part of what a file could have covered.
  const answerable = schema.fields.filter((field) => field.type !== "empty");
  const mapped = answerable.filter(
    (field) => (templateFields[field.fieldId]?.kind ?? "none") !== "none"
  ).length;
  if (mapped < answerable.length) {
    // Stated as expected, not as a defect: a study older than the template
    // cannot have answered questions the template did not yet ask.
    warnings.push(
      `يغطي الملف ${mapped} من ${answerable.length} حقلا في القالب — ستبقى بقية الحقول بلا إجابة، وهذا متوقع في دراسة أجريت قبل اعتماد القالب.`
    );
  }

  if (submittedAtSource.kind === "none") {
    warnings.push(
      `لم يربط عمود تاريخ المراجعة — سيسجل تاريخ استيراد الملف (${importedAt}) تاريخا للمراجعة في كل الصفوف.`
    );
  } else if (params.fallbackRows > 0) {
    warnings.push(
      `${params.fallbackRows} صفا بلا تاريخ مراجعة صالح — استخدم تاريخ استيراد الملف فيها.`
    );
  }

  if (params.coercionRows > 0) {
    warnings.push(
      `${params.coercionRows} صفا يحتوي على قيم لم يفهمها القالب — تم تجاهل تلك الحقول وحدها، والتفاصيل مرفقة بكل صف.`
    );
  }

  return warnings;
}

/**
 * Turns a historical record plus its raw cells into the exact set of answers
 * that would be written, without touching disk.
 *
 * PURE in the sense that matters: no reads, no writes, no events, and the same
 * inputs always produce the same plan. It does consult the in-memory managed
 * roster (`getManagedLoginUsers`) — deliberately, and exactly as
 * `assignAdhocPlan` does before committing — because the one check that must
 * not happen mid-write is the one that decides whether the reviewer exists.
 *
 * `rawValuesByRowKey` carries the ORIGINAL cells rather than `row.mapped`,
 * because `mapped` only holds the population field catalog's keys; the template
 * answers, the reviewer name and the review date all come from columns the
 * catalog knows nothing about. A row missing from it is treated as an empty
 * row, which surfaces as the blank-reviewer error below rather than as silence.
 */
export function planHistoricalImport(params: {
  record: AdhocRecord;
  schema: TemplateSchema;
  /**
   * Optional overrides. Normally BOTH come off the record's snapshotted
   * mapping, which is where the admin's choice is durably recorded — passing
   * them here is for a caller re-planning with a correction it has not saved
   * yet. Taking the record's value as the default is what stops the reviewer
   * and date columns from being the one part of the mapping that lives only in
   * someone's memory (defect G8).
   */
  answeredBySource?: FieldSource;
  submittedAtSource?: FieldSource;
  rawValuesByRowKey: Record<string, Record<string, unknown>>;
}): HistoricalImportPlan {
  const { record, schema, rawValuesByRowKey } = params;
  const answeredBySource: FieldSource =
    params.answeredBySource ?? record.mapping.answeredBySource ?? { kind: "none" };
  const submittedAtSource: FieldSource =
    params.submittedAtSource ?? record.mapping.submittedAtSource ?? { kind: "none" };
  const templateFields = record.mapping.templateFields ?? {};

  const plan: HistoricalRowPlan[] = [];
  const errors: string[] = [];
  const blankReviewerRows: string[] = [];
  let fallbackRows = 0;
  let coercionRows = 0;

  // A mapping authored against a different template would coerce every cell
  // against the wrong field list. Checked here rather than at write time: it is
  // an authoring mistake, and the operator can still fix it.
  if (record.templateId !== undefined && record.templateId !== schema.templateId) {
    errors.push(
      `القالب المرتبط بهذا الاستيراد (${record.templateId}) يختلف عن القالب المستخدم في الربط (${schema.templateId}).`
    );
  }

  const eligible = record.rows.filter((row) => row.validation.valid && !row.excludedByAdmin);
  if (eligible.length === 0) errors.push(NO_ELIGIBLE_ROWS);

  for (const row of eligible) {
    const values = rawValuesByRowKey[row.rowKey] ?? {};
    const originalId = row.mapped.xrayImageId;
    if (!originalId) {
      // Unreachable for a row the projector marked valid (the catalog requires
      // xrayImageId); reported instead of thrown so one malformed row cannot
      // take the operator's whole review screen down with it.
      errors.push(`الصف ${quote(row.rowKey)} بلا رقم صورة — لا يمكن استيراده.`);
      continue;
    }

    const answeredBy = normalizeUsername(readSourceText(answeredBySource, values) ?? "");
    if (answeredBy === "") {
      // Fatal, never defaulted: attributing a review to a person who did not do
      // it is the one mistake this import cannot walk back.
      blankReviewerRows.push(row.rowKey);
      continue;
    }

    const timestamp = resolveRowTimestamp(submittedAtSource, values, record.importedAt);
    if (timestamp.usedFallback) fallbackRows += 1;

    const { answers, warnings: coercionWarnings } = buildFieldAnswers({
      schema,
      templateFields,
      values,
    });
    if (coercionWarnings.length > 0) coercionRows += 1;

    plan.push({
      rowKey: row.rowKey,
      xrayImageId: namespacedXrayImageId(record.importId, originalId, 0),
      answeredBy,
      submittedAt: timestamp.submittedAt,
      answers,
      warnings:
        timestamp.warning === null ? coercionWarnings : [timestamp.warning, ...coercionWarnings],
    });
  }

  if (blankReviewerRows.length > 0) {
    const shown = blankReviewerRows.slice(0, 5).join("، ");
    const more = blankReviewerRows.length > 5 ? "، ..." : "";
    errors.push(
      `${blankReviewerRows.length} صفا بلا اسم مراجع (${shown}${more}) — لا يمكن نسب مراجعة إلى مجهول.`
    );
  }
  // Rows whose reviewer is merely UNKNOWN stay in the plan so the review table
  // can show the row and the name that failed; the error below is what stops
  // the import, and `applyHistoricalImport` re-checks the roster anyway.
  errors.push(...unknownReviewerErrors(plan));

  return {
    plan,
    errors,
    warnings: summarizeCoverage({
      schema,
      templateFields,
      submittedAtSource,
      importedAt: record.importedAt,
      fallbackRows,
      coercionRows,
    }),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4 — Committing
 * ──────────────────────────────────────────────────────────────────────────── */

function toPlannedAssignment(entry: HistoricalRowPlan): PlannedAssignment {
  return {
    rowKey: entry.rowKey,
    username: entry.answeredBy,
    replicaIndex: 0,
    xrayImageId: entry.xrayImageId,
  };
}

function allReviewersAssignable(plan: HistoricalRowPlan[]): boolean {
  return unknownReviewerErrors(plan).length === 0;
}

function answerKey(username: string, xrayImageId: string): string {
  return `${username} ${xrayImageId}`;
}

/**
 * `answeredBy`/`xrayImageId` for every answer this import already wrote.
 *
 * The second half of idempotency, and the half that also REPAIRS: the events
 * and the answers are separate writes, so a run interrupted between them leaves
 * rows assigned+completed with no answer attached. Asking the answer files
 * directly (rather than inferring "answered" from the distribution state) lets a
 * re-run finish exactly the part that is missing instead of either skipping it
 * forever or rewriting answers that are already correct.
 *
 * One read per distinct reviewer, not per row.
 */
async function loadExistingAnswerKeys(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string,
  plan: HistoricalRowPlan[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const username of new Set(plan.map((entry) => entry.answeredBy))) {
    const file = await loadEmployeeAnswers(directoryHandle, monthFolderName, username);
    for (const item of file.items) {
      keys.add(answerKey(username, item.xrayImageId));
    }
  }
  return keys;
}

/**
 * The `assigned` + `completed` pair for one back-filled row.
 *
 * `buildCompletedEvent` takes no `eventAt` override (only `buildAssignEvent`
 * does), so the shared timestamp is applied by spreading over it. That keeps
 * the batch on ONE clock — as `assignAdhocPlan` does, so a fold can never order
 * a bulk write by clock jitter — and keeps the pair itself orderable:
 * `sortDistributionEventsForFold` sorts by `eventAt` and leaves ties in the
 * order supplied, and both events are appended in this order, so `assigned`
 * always folds first.
 */
function buildHistoricalEvents(
  entry: HistoricalRowPlan,
  eventBy: string,
  eventAt: string,
  fileName: string
): DistributionEvent[] {
  return [
    buildAssignEvent({
      xrayImageId: entry.xrayImageId,
      assignedTo: entry.answeredBy,
      eventBy,
      notes: `استيراد دراسة سابقة: ${fileName}`,
      eventAt,
    }),
    {
      ...buildCompletedEvent({
        xrayImageId: entry.xrayImageId,
        assignedTo: entry.answeredBy,
        eventBy,
      }),
      eventAt,
    },
  ];
}

function historicalItemAnswer(
  entry: HistoricalRowPlan,
  templateId: string,
  templateVersion: number
): ItemAnswer {
  return {
    xrayImageId: entry.xrayImageId,
    templateId,
    templateVersion,
    // Sparse by design: a field the study did not answer is simply absent. See
    // this module's header note 1.
    answers: entry.answers,
    // A back-fill has no separate "saved, then submitted" moment — the study was
    // finished once, at this timestamp — so both fields carry it, matching what
    // the live inspection form writes on submit.
    lastSavedAt: entry.submittedAt,
    submittedAt: entry.submittedAt,
    answeredBy: entry.answeredBy,
    status: "submitted",
  };
}

function withHistoricalAssignments(
  rows: AdhocRow[],
  committed: HistoricalRowPlan[],
  assignedAt: string
): AdhocRow[] {
  const added = new Map<string, AdhocRowAssignment[]>();
  for (const entry of committed) {
    const list = added.get(entry.rowKey) ?? [];
    list.push({
      username: entry.answeredBy,
      replicaIndex: 0,
      xrayImageId: entry.xrayImageId,
      assignedAt,
    });
    added.set(entry.rowKey, list);
  }
  return rows.map((row) => {
    const extra = added.get(row.rowKey);
    return extra === undefined ? row : { ...row, assignments: [...row.assignments, ...extra] };
  });
}

type HistoricalWork = {
  events: DistributionEvent[];
  /** Rows whose events this run appends — the record's new bookkeeping. */
  committed: HistoricalRowPlan[];
  /** Rows whose answer file has no entry for them yet. */
  answersToWrite: HistoricalRowPlan[];
  /** Distinct rows this run touches at all. */
  importedCount: number;
  skippedCount: number;
};

/**
 * Decides what is left to do, given what is already on disk.
 *
 * Two independent "already done" signals, because the two writes can be
 * interrupted independently: the distribution state (plus the record's own
 * bookkeeping, which another machine may have updated before this one's derived
 * cache caught up) answers "are the events there", and the answer files answer
 * "is the answer there". A row where both are true is skipped entirely, so a
 * plain re-run writes nothing at all.
 */
function planRemainingWork(params: {
  eligible: HistoricalRowPlan[];
  rowsByKey: Map<string, AdhocRow>;
  ownedIds: Set<string>;
  answeredKeys: Set<string>;
  eventBy: string;
  eventAt: string;
  fileName: string;
}): HistoricalWork {
  const { eligible, rowsByKey, ownedIds, answeredKeys, eventBy, eventAt, fileName } = params;
  const events: DistributionEvent[] = [];
  const committed: HistoricalRowPlan[] = [];
  const answersToWrite: HistoricalRowPlan[] = [];
  const seen = new Set<string>();
  let importedCount = 0;

  for (const entry of eligible) {
    // A plan naming the same id twice would fold as a reassignment of the id to
    // itself, and would write the same answer twice.
    if (seen.has(entry.xrayImageId)) continue;
    seen.add(entry.xrayImageId);

    const bookkept =
      rowsByKey
        .get(entry.rowKey)
        ?.assignments.some((assignment) => assignment.xrayImageId === entry.xrayImageId) ?? false;
    const needsEvents = !bookkept && !ownedIds.has(entry.xrayImageId);
    const needsAnswer = !answeredKeys.has(answerKey(entry.answeredBy, entry.xrayImageId));
    if (!needsEvents && !needsAnswer) continue;

    importedCount += 1;
    if (needsEvents) {
      committed.push(entry);
      events.push(...buildHistoricalEvents(entry, eventBy, eventAt, fileName));
    }
    if (needsAnswer) answersToWrite.push(entry);
  }

  return {
    events,
    committed,
    answersToWrite,
    importedCount,
    skippedCount: seen.size - importedCount,
  };
}

/**
 * Commits a historical plan to disk.
 *
 * Write order is fixed and is not an implementation detail:
 *
 * 1. `ensureAdhocSampleMaster` FIRST, for every planned id.
 *    `foldDistributionEvents` silently absorbs an event whose `xrayImageId` is
 *    absent from the sample rows it is handed, so an event appended before its
 *    row exists is durably written and permanently invisible — the import would
 *    report success and show nothing.
 * 2. The `assigned` + `completed` events, appended as ONE batch sharing one
 *    `eventAt`, then `refreshDistributionCacheAfterWrite` so the derived cache
 *    and the per-employee sample mirrors reflect them.
 * 3. The answers, one `upsertItemAnswer` per row into the ad-hoc month folder.
 *
 * The record is saved between 2 and 3, so its assignment bookkeeping always
 * describes events that are actually on disk. If an answer write then fails,
 * this returns `ok: false` with the events already committed — and a re-run
 * repairs exactly the missing answers, because `planRemainingWork` tests the two
 * halves separately.
 *
 * Safety properties are `assignAdhocPlan`'s, unchanged: the caller's record is
 * only a fallback (the fresh on-disk copy drives the status gate, the row
 * filters and the save base), the roster is re-validated here and not merely at
 * plan time, and the distribution log — not the record — is the authority on
 * what already exists.
 */
export async function applyHistoricalImport(
  directoryHandle: DirectoryHandleLike,
  record: AdhocRecord,
  plan: HistoricalRowPlan[],
  eventBy: string
): Promise<ApplyHistoricalImportResult> {
  const fresh = (await loadAdhocRecord(directoryHandle, record.importId)) ?? record;

  if (fresh.status === "closed") return { ok: false, error: IMPORT_CLOSED };
  if (plan.length === 0) return { ok: false, error: NO_ELIGIBLE_ROWS };
  if (fresh.templateId === undefined || fresh.templateVersion === undefined) {
    // The record snapshots which template — and which VERSION of it — the
    // answers were mapped against. Without it an ItemAnswer cannot say what its
    // fieldIds mean, and a later template edit would silently re-interpret it.
    return { ok: false, error: MISSING_TEMPLATE };
  }
  if (!allReviewersAssignable(plan)) return { ok: false, error: UNASSIGNABLE_REVIEWER };

  const rowsByKey = new Map(fresh.rows.map((row) => [row.rowKey, row]));
  const eligible = plan.filter((entry) => {
    const row = rowsByKey.get(entry.rowKey);
    return row !== undefined && row.validation.valid && !row.excludedByAdmin;
  });
  if (eligible.length === 0) return { ok: false, error: NO_ELIGIBLE_ROWS };

  const monthFolderName = adhocMonthFolder(fresh.importId);
  const sampleRows = await ensureAdhocSampleMaster(
    directoryHandle,
    fresh,
    eligible.map(toPlannedAssignment)
  );

  const current = await loadOrDeriveDistributionCurrent(
    directoryHandle,
    monthFolderName,
    sampleRows
  );
  const answeredKeys = await loadExistingAnswerKeys(directoryHandle, monthFolderName, eligible);
  // ONE timestamp for the whole batch. This is when the app LEARNED about the
  // work; when the reviewer did it lives in `ItemAnswer.submittedAt` (header
  // note 3).
  const sharedEventAt = new Date().toISOString();
  const work = planRemainingWork({
    eligible,
    rowsByKey,
    ownedIds: new Set((current?.entries ?? []).map((entry) => entry.xrayImageId)),
    answeredKeys,
    eventBy,
    eventAt: sharedEventAt,
    fileName: fresh.fileName,
  });

  if (work.importedCount === 0) return { ok: false, error: ALREADY_IMPORTED };

  if (work.events.length > 0) {
    const appendResult = await appendDistributionEvents(
      directoryHandle,
      monthFolderName,
      work.events
    );
    if (!appendResult.ok) return { ok: false, error: appendResult.error };
    // Swallows its own failure by contract — the cache is rebuildable.
    await refreshDistributionCacheAfterWrite(directoryHandle, monthFolderName, sampleRows);
  }

  // Rebuilt from the FRESH rows, so another machine's bookkeeping survives this
  // whole-document save.
  const saved = await saveAdhocRecord(directoryHandle, {
    ...fresh,
    rows: withHistoricalAssignments(fresh.rows, work.committed, sharedEventAt),
  });

  const failures: string[] = [];
  for (const entry of work.answersToWrite) {
    const result = await upsertItemAnswer(
      directoryHandle,
      monthFolderName,
      entry.answeredBy,
      historicalItemAnswer(entry, fresh.templateId, fresh.templateVersion)
    );
    if (!result.ok) failures.push(result.error);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: `تعذر حفظ إجابات ${failures.length} صفا بعد تسجيل التوزيع — أعد تشغيل الاستيراد لإكمال الناقص وحده. (${failures[0]})`,
    };
  }

  return {
    ok: true,
    importedCount: work.importedCount,
    skippedCount: work.skippedCount,
    record: saved,
  };
}
