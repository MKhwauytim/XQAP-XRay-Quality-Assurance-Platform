// src/components/AnswersLayoutMigrationPrompt/AnswersLayoutMigrationPrompt.tsx
//
// Spec 2026-10-13 §6: after an ADMIN signs in and the boot checklist has
// settled, offer the flat→per-assignee answers migration for every month that
// needs it. Never automatic, never for another role (CLAUDE.md migration policy).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { useBootProgress } from "../../data/workspace/bootProgress";
import { useLabels } from "../../data/labels/useLabels";
import { monthFoldersQueryOptions } from "../../data/query/monthFoldersQuery";
import { probeAnswerLayoutMigrations, type MonthMigrationNeed } from "../../data/answers/migration/answerLayoutMigrationProbe";
import { migrateMonthToPerAssignee, type MigrationProgress, type UnreadableDecision } from "../../data/answers/migration/flatToPerAssignee";
import { classifyMigrationFailure } from "../../data/answers/migration/migrationFailureReason";
import type { LabelKey } from "../../data/labels/labelsStore";
import "./AnswersLayoutMigrationPrompt.css";
import { broadcastDataRefresh } from "../../data/workspace/dataRefreshSignal";
import { logError } from "../../data/storage/errorLogger";

type Props = {
  session: AuthSession;
  directoryHandle: DirectoryHandleLike | null;
  workspaceReady: boolean;
  /**
   * True while another admin sign-in dialog owns the screen — the boot
   * integrity report (whose `.tmp` sibling heal runs in the same sign-in).
   * The probe still runs; the prompt waits instead of stacking a second modal.
   */
  holdWhile?: boolean;
};
type Phase =
  | { kind: "idle" }
  | { kind: "prompt" }
  | { kind: "running"; text: string }
  /** Option C: unreadable flat segments found before the first write — the admin decides. */
  | { kind: "ask"; month: string; names: readonly string[]; resolve: (decision: UnreadableDecision) => void }
  /** Round 7: a fresh lock is this admin's own, from this device (an earlier run that died) — take it over? */
  | { kind: "takeover"; text: string; resolve: (takeOver: boolean) => void }
  | { kind: "done"; text: string; details: readonly string[] };

/** UI updates from the per-file progress callback, at most ~4 per second (a phase change always shows at once). */
const PROGRESS_THROTTLE_MS = 250;

const PHASE_LABEL: Record<MigrationProgress["phase"], LabelKey> = {
  lock: "answers_layout_migration_phase_lock",
  read: "answers_layout_migration_phase_read",
  archive: "answers_layout_migration_phase_archive",
  snapshot: "answers_layout_migration_phase_snapshot",
  move: "answers_layout_migration_phase_move",
  stragglers: "answers_layout_migration_phase_stragglers",
  commit: "answers_layout_migration_phase_commit",
  verify: "answers_layout_migration_phase_verify",
};

/** Closing the tab mid-run asks first (the run itself is crash-safe, but it would have to start over). */
function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

function throttledProgress(onText: (progress: MigrationProgress) => void): (progress: MigrationProgress) => void {
  let lastAt = 0;
  let lastPhase: MigrationProgress["phase"] | null = null;
  return (progress) => {
    const nowMs = Date.now();
    if (progress.phase === lastPhase && progress.done < progress.total && nowMs - lastAt < PROGRESS_THROTTLE_MS) return;
    lastAt = nowMs;
    lastPhase = progress.phase;
    onText(progress);
  };
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

/** Placeholders for the lock-holder messages: who, since when, and how long the heartbeat has been silent. */
function lockValues(month: string, held: { by: string; startedAt: string; lastSeenAt: string }): Record<string, string | number> {
  const at = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString("ar"));
  const age = Math.max(0, Math.round((Date.now() - (Date.parse(held.lastSeenAt) || Date.now())) / 60_000));
  return { month, by: held.by, startedAt: at(held.startedAt), age };
}

/** Review finding 3: a migration that left segments behind must say which, never report a clean success. */
function leftoverProblems(labels: ReturnType<typeof useLabels>, month: string, unfolded: readonly string[], unmovable: readonly string[]): string[] {
  const unfoldedSet = new Set(unfolded);
  const stuck = unmovable.filter((name) => !unfoldedSet.has(name));
  const out: string[] = [];
  if (unfolded.length > 0) out.push(fill(labels.answers_layout_migration_unfolded, { month, names: unfolded.join("، ") }));
  if (stuck.length > 0) out.push(fill(labels.answers_layout_migration_unmovable, { month, names: stuck.join("، ") }));
  return out;
}

export function AnswersLayoutMigrationPrompt({ session, directoryHandle, workspaceReady, holdWhile = false }: Props) {
  const labels = useLabels();
  const queryClient = useQueryClient();
  const { allLoaded } = useBootProgress();
  const [needs, setNeeds] = useState<MonthMigrationNeed[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const probedFor = useRef<string | null>(null);
  useLeaveGuard(phase.kind === "running" || phase.kind === "ask" || phase.kind === "takeover");
  const eligible = session.role === "admin" && session.mode !== "demo" && directoryHandle !== null && workspaceReady;
  const sessionKey = `${session.username}:${session.loginAt}:${directoryHandle?.name ?? ""}`;

  useEffect(() => {
    if (!eligible || !allLoaded || !directoryHandle || probedFor.current === sessionKey) return;
    probedFor.current = sessionKey;
    void (async () => {
      try {
        const months = await queryClient.fetchQuery(monthFoldersQueryOptions(directoryHandle));
        const found = await probeAnswerLayoutMigrations(directoryHandle, months.map((month) => month.folderName));
        if (found.length > 0) {
          setNeeds(found);
          setPhase({ kind: "prompt" });
        }
      } catch (error) {
        logError("answersMigrationPrompt:probe", error);
      }
    })();
  }, [eligible, allLoaded, directoryHandle, sessionKey, queryClient]);

  async function runMigration(): Promise<void> {
    if (!directoryHandle) return;
    const problems: string[] = [];
    const details: string[] = [];
    for (const [index, need] of needs.entries()) {
      const monthValues = { month: need.monthFolderName, done: index + 1, total: needs.length };
      let runningText = fill(labels.answers_layout_migration_running, monthValues);
      setPhase({ kind: "running", text: runningText });
      const onProgress = throttledProgress((progress) => {
        runningText = fill(labels.answers_layout_migration_running_phase, { ...monthValues, phase: labels[PHASE_LABEL[progress.phase]], n: progress.done, m: progress.total });
        setPhase((current) => (current.kind === "running" ? { kind: "running", text: runningText } : current));
      });
      try {
        const runOnce = (takeOverLockToken?: string) => migrateMonthToPerAssignee(directoryHandle, need.monthFolderName, {
          takeOverLockToken,
          actor: session.username,
          onProgress,
          // Asked after the read-only phase, before the first write: "postpone" moves nothing.
          onUnreadable: (names) =>
            new Promise<UnreadableDecision>((resolve) => {
              setPhase({
                kind: "ask",
                month: need.monthFolderName,
                names,
                resolve: (decision) => {
                  setPhase({ kind: "running", text: runningText });
                  resolve(decision);
                },
              });
            }),
        });
        let result = await runOnce();
        if (result.status === "locked-elsewhere" && result.takeoverAllowed) {
          const held = result;
          const takeOver = await new Promise<boolean>((resolve) => {
            const template = held.self ? labels.answers_layout_migration_takeover_ask : labels.answers_layout_migration_takeover_other_ask;
            setPhase({ kind: "takeover", text: fill(template, lockValues(need.monthFolderName, held)), resolve: (yes) => {
              setPhase({ kind: "running", text: runningText });
              resolve(yes);
            } });
          });
          if (takeOver) result = await runOnce(held.token);
        }
        if (result.status === "postponed") problems.push(fill(labels.answers_layout_migration_postponed, { month: need.monthFolderName }));
        if (result.status === "locked-elsewhere") problems.push(fill(labels.answers_layout_migration_busy, lockValues(need.monthFolderName, result)));
        if (result.status === "migrated") problems.push(...leftoverProblems(labels, need.monthFolderName, result.unfolded ?? [], result.unmovable ?? []));
      } catch (error) {
        logError("answersMigrationPrompt:migrate", error, { action: need.monthFolderName });
        const reason = classifyMigrationFailure(error);
        problems.push(fill(labels.answers_layout_migration_failed_reason, { month: need.monthFolderName, reason: labels[reason.labelKey] }));
        details.push(`${need.monthFolderName} — ${reason.detail}`);
      }
    }
    broadcastDataRefresh("manual");
    setPhase({ kind: "done", text: problems.length === 0 ? labels.answers_layout_migration_done : problems.join(" "), details });
  }

  if (phase.kind === "idle") return null;
  // Never hide a migration that is already running or reporting its result.
  if (phase.kind === "prompt" && holdWhile) return null;
  if (phase.kind === "ask") {
    return (
      <ConfirmDialog
        open
        title={labels.answers_layout_migration_title}
        message={<p dir="rtl">{fill(labels.answers_layout_migration_unreadable_ask, { month: phase.month, count: phase.names.length, names: phase.names.join("، ") })}</p>}
        confirmLabel={labels.answers_layout_migration_finish_anyway}
        cancelLabel={labels.answers_layout_migration_postpone}
        danger
        onConfirm={() => phase.resolve("finish")}
        onCancel={() => phase.resolve("postpone")}
      />
    );
  }
  if (phase.kind === "takeover") {
    return (
      <ConfirmDialog
        open
        title={labels.answers_layout_migration_title}
        message={<p dir="rtl">{phase.text}</p>}
        confirmLabel={labels.answers_layout_migration_takeover_confirm}
        cancelLabel={labels.answers_layout_migration_later}
        onConfirm={() => phase.resolve(true)}
        onCancel={() => phase.resolve(false)}
      />
    );
  }
  const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
  const message: ReactNode =
    phase.kind === "prompt" ? (
      <div dir="rtl">
        <p>{fill(labels.answers_layout_migration_body, { monthCount: needs.length })}</p>
        <ul>
          {needs.map((need) => (
            <li key={need.monthFolderName}>
              {need.kind === "incomplete"
                ? fill(labels.answers_layout_migration_resume_row, { month: need.monthFolderName, n: need.flatSegments, total: need.flatSegments + need.archivedSegments, assignees: need.assignees, minutes: minutes(need.estimateMs) })
                : fill(labels.answers_layout_migration_month_row, { month: need.monthFolderName, segments: need.flatSegments, assignees: need.assignees, minutes: minutes(need.estimateMs) })}
              {need.kind === "stragglers" ? ` — ${labels.answers_layout_migration_incomplete}` : null}
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <div>
        <p role="status" dir="rtl">{phase.text}</p>
        {phase.kind === "done" && phase.details.length > 0 ? (
          <div className="answers-migration__detail" data-testid="answers-migration-detail" dir="ltr">
            {phase.details.map((detail) => (
              <code key={detail}>{detail}</code>
            ))}
          </div>
        ) : null}
      </div>
    );
  return (
    <ConfirmDialog
      open
      title={labels.answers_layout_migration_title}
      message={message}
      confirmLabel={needs.length > 0 && needs.every((need) => need.kind === "incomplete") ? labels.answers_layout_migration_resume_confirm : labels.answers_layout_migration_confirm}
      cancelLabel={phase.kind === "prompt" ? labels.answers_layout_migration_later : labels.answers_layout_migration_close}
      hideConfirm={phase.kind !== "prompt"}
      onConfirm={() => void runMigration()}
      onCancel={() => {
        if (phase.kind !== "running") setPhase({ kind: "idle" });
      }}
    />
  );
}
