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
import { migrateMonthToPerAssignee } from "../../data/answers/migration/flatToPerAssignee";
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
type Phase = { kind: "idle" } | { kind: "prompt" } | { kind: "running"; text: string } | { kind: "done"; text: string };

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), template);
}

export function AnswersLayoutMigrationPrompt({ session, directoryHandle, workspaceReady, holdWhile = false }: Props) {
  const labels = useLabels();
  const queryClient = useQueryClient();
  const { allLoaded } = useBootProgress();
  const [needs, setNeeds] = useState<MonthMigrationNeed[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const probedFor = useRef<string | null>(null);
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
    for (const [index, need] of needs.entries()) {
      setPhase({ kind: "running", text: fill(labels.answers_layout_migration_running, { month: need.monthFolderName, done: index + 1, total: needs.length }) });
      try {
        const result = await migrateMonthToPerAssignee(directoryHandle, need.monthFolderName, { actor: session.username });
        if (result.status === "locked-elsewhere") problems.push(fill(labels.answers_layout_migration_busy, { month: need.monthFolderName }));
      } catch (error) {
        logError("answersMigrationPrompt:migrate", error, { action: need.monthFolderName });
        problems.push(fill(labels.answers_layout_migration_failed, { month: need.monthFolderName }));
      }
    }
    broadcastDataRefresh("manual");
    setPhase({ kind: "done", text: problems.length === 0 ? labels.answers_layout_migration_done : problems.join(" ") });
  }

  if (phase.kind === "idle") return null;
  // Never hide a migration that is already running or reporting its result.
  if (phase.kind === "prompt" && holdWhile) return null;
  const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
  const message: ReactNode =
    phase.kind === "prompt" ? (
      <div dir="rtl">
        <p>{fill(labels.answers_layout_migration_body, { monthCount: needs.length })}</p>
        <ul>
          {needs.map((need) => (
            <li key={need.monthFolderName}>
              {fill(labels.answers_layout_migration_month_row, { month: need.monthFolderName, segments: need.flatSegments, assignees: need.assignees, minutes: minutes(need.estimateMs) })}
              {need.kind !== "flat" ? ` — ${labels.answers_layout_migration_incomplete}` : null}
            </li>
          ))}
        </ul>
      </div>
    ) : (
      <p role="status" dir="rtl">{phase.text}</p>
    );
  return (
    <ConfirmDialog
      open
      title={labels.answers_layout_migration_title}
      message={message}
      confirmLabel={labels.answers_layout_migration_confirm}
      cancelLabel={phase.kind === "prompt" ? labels.answers_layout_migration_later : labels.answers_layout_migration_close}
      hideConfirm={phase.kind !== "prompt"}
      onConfirm={() => void runMigration()}
      onCancel={() => {
        if (phase.kind !== "running") setPhase({ kind: "idle" });
      }}
    />
  );
}
