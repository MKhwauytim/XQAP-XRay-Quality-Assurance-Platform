/**
 * Headless mount point for the durable error-log sink. Installs
 * `installWorkspaceErrorSink` (`errorLogSink.ts`) once a workspace is ready
 * and a real (non-demo) username is known, and uninstalls it on unmount or
 * whenever those conditions stop holding.
 *
 * Modelled on `SyncTick.tsx`: a headless component that renders `null`, reads
 * `useWorkspace()` for readiness, and takes an `enabled` prop because only
 * `AuthGate` knows the session mode (a read-only demo/viewer session must
 * never write to a workspace it does not really have).
 */
import { useEffect } from "react";

import { useWorkspace } from "../workspace/useWorkspace";
import { installWorkspaceErrorSink } from "./errorLogSink";

type WorkspaceErrorSinkProps = {
  /** The REAL signed-in username — never an admin's previewed role's identity. */
  username: string;
  /** false for the read-only demo/viewer session. */
  enabled?: boolean;
};

export function WorkspaceErrorSink({ username, enabled = true }: WorkspaceErrorSinkProps): null {
  const { directoryHandle, status } = useWorkspace();

  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready" || !directoryHandle) return;

    return installWorkspaceErrorSink({ directoryHandle, username });
  }, [enabled, status, directoryHandle, username]);

  return null;
}
